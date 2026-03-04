import { readFileSync } from "node:fs";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import type { HelloMessage } from "@nexterm/shared";
import type { Host } from "@nexterm/shared";
import { Client, type ClientChannel, type SyncHostVerifier } from "ssh2";
import { AgentConnection } from "./agent-connection.js";

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Parse the username and hostname from an sshHost string.
 * Accepts "user@hostname" or just "hostname".
 */
function parseSshHost(sshHost: string): { username: string; hostname: string } {
	const atIdx = sshHost.indexOf("@");
	if (atIdx !== -1) {
		return {
			username: sshHost.slice(0, atIdx),
			hostname: sshHost.slice(atIdx + 1),
		};
	}
	return {
		username: process.env.USER ?? process.env.USERNAME ?? "root",
		hostname: sshHost,
	};
}

/**
 * SshAgent connects to a remote host over SSH, launches `nexterm-agent --stdio`
 * on the remote side, and communicates via length-prefixed MessagePack frames
 * over the SSH channel's stdin/stdout.
 *
 * Usage:
 *   const agent = new SshAgent(host);
 *   await agent.start();           // resolves after HELLO handshake
 *   agent.send({ type: "SPAWN", ... });
 *   agent.on("message", (msg) => { ... });
 *   agent.close();
 */
export class SshAgent extends AgentConnection {
	private client: Client | null = null;
	private channel: ClientChannel | null = null;
	private channelOpen = false;

	constructor(private readonly host: Host) {
		super();
	}

	/**
	 * Connect to the remote host over SSH, exec `nexterm-agent --stdio`,
	 * and wait for the HELLO handshake.
	 * Rejects if HELLO is not received within 5 seconds.
	 */
	async start(): Promise<HelloMessage> {
		if (!this.host.sshHost) {
			throw new Error("Host has no sshHost configured");
		}

		const { username, hostname } = parseSshHost(this.host.sshHost);
		const port = this.host.sshPort ?? 22;
		const authMethod = this.host.sshAuth ?? "key";

		if (authMethod === "password") {
			throw new Error("password auth not yet supported");
		}

		const client = new Client();
		this.client = client;

		const connectConfig: Parameters<Client["connect"]>[0] = {
			host: hostname,
			port,
			username,
			// Accept all host keys for now, log the fingerprint for auditing.
			// Known-hosts verification is a planned hardening step (see docs/SECURITY.md).
			hostVerifier: ((key: Buffer) => {
				const fingerprint = key
					.toString("hex")
					.replace(/(.{2})/g, "$1:")
					.slice(0, -1);
				console.log(`[ssh-agent] Accepting host key fingerprint: ${fingerprint}`);
				return true;
			}) as SyncHostVerifier,
		};

		if (authMethod === "agent") {
			const authSock = process.env.SSH_AUTH_SOCK;
			if (!authSock) {
				throw new Error("SSH_AUTH_SOCK is not set; cannot use agent auth");
			}
			connectConfig.agent = authSock;
		} else {
			// "key" auth — read the private key file
			if (!this.host.sshKeyPath) {
				throw new Error("Host sshKeyPath is required for key auth");
			}
			connectConfig.privateKey = readFileSync(this.host.sshKeyPath);
		}

		return new Promise<HelloMessage>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.cleanup();
				reject(new Error("Agent HELLO timeout"));
			}, HELLO_TIMEOUT_MS);

			let resolved = false;
			const rejectOnce = (err: Error): void => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timeout);
				reject(err);
			};

			const resolveOnce = (msg: HelloMessage): void => {
				if (resolved) return;
				resolved = true;
				clearTimeout(timeout);
				resolve(msg);
			};

			client.once("error", (err) => {
				rejectOnce(err);
			});

			client.on("close", () => {
				this.client = null;
				this.channelOpen = false;
				this.emit("close", undefined);
			});

			client.on("ready", () => {
				// ssh2's exec() executes a command on the remote side over SSH.
				// This is the ssh2 Client API — not Node's child_process.exec().
				client.exec("nexterm-agent --stdio", (err, stream) => {
					if (err) {
						rejectOnce(err);
						return;
					}

					this.channel = stream;
					this.channelOpen = true;

					stream.on("data", (data: Buffer) => {
						this.handleData(data);
					});

					stream.on("close", () => {
						this.channel = null;
						this.channelOpen = false;
						client.end();
					});

					stream.on("error", (err: Error) => {
						this.emit("error", err);
					});

					// Wait for HELLO — emitted by AgentConnection.handleData once HELLO is decoded
					this.once("ready", (msg: HelloMessage) => {
						resolveOnce(msg);
					});
				});
			});

			client.connect(connectConfig);
		});
	}

	/** Send a protocol message to the remote agent via the SSH channel stdin. */
	send(msg: ProtocolMessage): void {
		if (!this.channel || !this.channelOpen) {
			throw new Error("SSH agent not connected");
		}
		const frame = encodeFrame(msg);
		this.channel.stdin.write(Buffer.from(frame));
	}

	/** Close the SSH channel and the underlying SSH connection. */
	close(): void {
		this.cleanup();
	}

	get connected(): boolean {
		return this.client !== null && this.channelOpen;
	}

	private cleanup(): void {
		if (this.channel) {
			try {
				this.channel.close();
			} catch {
				// ignore errors during cleanup
			}
			this.channel = null;
			this.channelOpen = false;
		}
		if (this.client) {
			try {
				this.client.end();
			} catch {
				// ignore errors during cleanup
			}
			this.client = null;
		}
	}
}
