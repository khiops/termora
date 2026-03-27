/**
 * SshConnectionManager — SSH-specific connection logic:
 *   - auth prompt request/response
 *   - host key mismatch verification
 *   - reconnect with exponential backoff
 *   - test connectivity
 */

import type {
	AgentBinaryVerifyMessage,
	AuthPromptMessage,
	ErrorMessage,
	HostArch,
	HostOs,
	HostVerifyMessage,
	ProtocolMessage,
	TestConnectMessage,
} from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { Client as SshClient } from "ssh2";
import type { AgentConnectionManager } from "./agent-connection-manager.js";
import { type BinaryVerifyPromptFn, getBinaryCacheDir } from "./agent-deployer.js";
import type { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import type { SharedSessionContext } from "./session-context.js";
import type { WsClient } from "./session-manager.js";
import {
	type AuthPromptFn,
	SshAgent,
	type SshAgentDeployOptions,
	buildSshConnectConfig,
} from "./ssh-agent.js";
import type { StateBroadcaster } from "./state-broadcaster.js";

/** Reconnect backoff steps in ms (capped at 30s, total budget 5 min) */
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const RECONNECT_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes
const HOST_KEY_MISMATCH_TIMEOUT_MS = 30_000;

export class SshConnectionManager {
	constructor(
		private readonly ctx: SharedSessionContext,
		private readonly broadcaster: StateBroadcaster,
		private readonly lifecycle: ChannelLifecycleManager,
		private readonly agentMgr: AgentConnectionManager,
	) {}

	// ─── Auth prompt ─────────────────────────────────────────────────────────

	buildPromptAuth(client: WsClient): AuthPromptFn {
		return async (hostId, promptType, message) => {
			// Cache hit: return cached passphrase without prompting the UI
			if (promptType === "passphrase") {
				const cached = this.ctx.passphraseCache.get(hostId);
				if (cached) {
					if (cached.expiresAt > Date.now()) {
						return cached.secret;
					}
					// Expired — evict and fall through to prompt
					this.ctx.passphraseCache.delete(hostId);
				}
			}
			const promptMsg: AuthPromptMessage = { type: "AUTH_PROMPT", hostId, promptType, message };
			client.send(promptMsg);
			return new Promise<string | null>((resolve) => {
				this.ctx.pendingAuthPrompts.set(hostId, { resolve, timer: null, clientId: client.id });
			});
		};
	}

	handleAuthPromptResponse(
		clientId: string,
		hostId: string,
		secret: string | null,
		rememberSession?: boolean,
	): void {
		const pending = this.ctx.pendingAuthPrompts.get(hostId);
		if (!pending) return;
		// SEC-003: only the client that triggered the prompt may respond
		if (pending.clientId !== clientId) return;
		if (pending.timer !== null) clearTimeout(pending.timer);
		this.ctx.pendingAuthPrompts.delete(hostId);
		// Opt-in passphrase caching (15 min TTL)
		if (rememberSession === true && secret !== null) {
			this.ctx.passphraseCache.set(hostId, {
				secret,
				expiresAt: Date.now() + 15 * 60 * 1000,
			});
		}
		pending.resolve(secret);
	}

	// ─── Host key mismatch ────────────────────────────────────────────────────

	/**
	 * Send HOST_VERIFY to the client and wait (30 s timeout) for HOST_VERIFY_RESPONSE.
	 * Returns the action chosen by the user.
	 * @param firstConnect - true for TOFU (first connection), false for mismatch.
	 */
	async promptHostKeyVerify(
		client: WsClient,
		hostId: string,
		hostname: string,
		oldFingerprint: string,
		newFingerprint: string,
		firstConnect = false,
	): Promise<"trust_permanent" | "trust_once" | "reject"> {
		const promptId = generateId();
		const verifyMsg: HostVerifyMessage = {
			type: "HOST_VERIFY",
			hostId,
			fingerprint: newFingerprint,
			algorithm: "SHA256",
			...(oldFingerprint ? { oldFingerprint } : {}),
			promptId,
			...(firstConnect ? { firstConnect: true } : {}),
		};
		client.send(verifyMsg);

		return new Promise<"trust_permanent" | "trust_once" | "reject">((resolve) => {
			const timer = setTimeout(() => {
				this.ctx.pendingHostVerify.delete(promptId);
				this.ctx.hubLogger?.log("warn", "ssh-connection: HOST_VERIFY timeout, rejecting", {
					hostId,
					hostname,
				});
				resolve("reject");
			}, HOST_KEY_MISMATCH_TIMEOUT_MS);

			this.ctx.pendingHostVerify.set(promptId, { resolve, timer });
		});
	}

	/**
	 * Resolve a pending host-key-mismatch prompt.
	 * Called by WsHandler when HOST_VERIFY_RESPONSE arrives from the UI.
	 */
	handleHostVerifyResponse(
		promptId: string,
		action: "trust_permanent" | "trust_once" | "reject",
	): void {
		const pending = this.ctx.pendingHostVerify.get(promptId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.ctx.pendingHostVerify.delete(promptId);
		pending.resolve(action);
	}

	// ─── Agent binary verify ──────────────────────────────────────────────────

	buildBinaryVerifyPrompt(client: WsClient): BinaryVerifyPromptFn {
		return async (
			hostId: string,
			hostname: string,
			remotePath: string,
			remoteSha256: string,
			os: HostOs,
			arch: HostArch,
			mismatch: boolean,
			pinnedSha256?: string,
		): Promise<"trust_permanent" | "trust_once" | "reject"> => {
			const promptId = generateId();
			const msg: AgentBinaryVerifyMessage = {
				type: "AGENT_BINARY_VERIFY",
				promptId,
				hostId,
				hostname,
				remotePath,
				remoteSha256,
				os,
				arch,
				mismatch,
				...(pinnedSha256 ? { pinnedSha256 } : {}),
			};
			client.send(msg);

			return new Promise<"trust_permanent" | "trust_once" | "reject">((resolve) => {
				const timer = setTimeout(() => {
					this.ctx.pendingAgentVerify.delete(promptId);
					this.ctx.hubLogger?.log(
						"warn",
						"ssh-connection: AGENT_BINARY_VERIFY timeout, rejecting",
						{
							hostname,
						},
					);
					resolve("reject");
				}, 30_000);

				this.ctx.pendingAgentVerify.set(promptId, { resolve, timer });
			});
		};
	}

	handleAgentVerifyResponse(
		promptId: string,
		action: "trust_permanent" | "trust_once" | "reject",
	): void {
		const pending = this.ctx.pendingAgentVerify.get(promptId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.ctx.pendingAgentVerify.delete(promptId);
		pending.resolve(action);
	}

	// ─── Reconnect ────────────────────────────────────────────────────────────

	scheduleReconnect(
		hostId: string,
		sessionId: string,
		attemptIndex: number,
		startTime: number,
	): void {
		const elapsed = Date.now() - startTime;
		if (elapsed >= RECONNECT_TIMEOUT_MS) {
			this.lifecycle.closeSession(hostId, sessionId);
			return;
		}

		const delayMs =
			RECONNECT_BACKOFF_MS[Math.min(attemptIndex, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;

		const timer = setTimeout(async () => {
			this.ctx.reconnectTimers.delete(hostId);

			const session = this.ctx.sessions.get(hostId);
			if (!session || session.status === "closed") return;

			const host = this.ctx.metaDal.getHost(hostId);
			if (!host) {
				this.lifecycle.closeSession(hostId, sessionId);
				return;
			}

			try {
				const binaryCache = getBinaryCacheDir();
				const pinnedSha256 = this.ctx.metaDal.getHostAgentSha256(hostId);
				const sessionTrustedAgentSha = this.ctx.trustedAgentSha256.get(hostId);
				const sshHostname = host.sshHost?.includes("@")
					? (host.sshHost.split("@")[1] ?? host.sshHost)
					: (host.sshHost ?? host.label);

				const deployOpts: SshAgentDeployOptions = {
					binaryCache,
					hostname: sshHostname,
					...(pinnedSha256 != null ? { pinnedSha256 } : {}),
					...(sessionTrustedAgentSha != null
						? { sessionTrustedSha256: sessionTrustedAgentSha }
						: {}),
					onOsDetected: (hid, os, arch) => {
						this.ctx.metaDal.updateHostOsArch(hid, os, arch);
					},
					// No promptBinaryVerify — reconnect is non-interactive
					// If binary is untrusted, deploy will throw AGENT_BINARY_UNTRUSTED
					// and reconnect will retry or give up (existing retry logic)
					onAgentPinned: (hid, sha256) => {
						this.ctx.metaDal.updateHostAgentSha256(hid, sha256);
					},
					onAgentTrustOnce: (hid, sha256) => {
						this.ctx.trustedAgentSha256.set(hid, sha256);
					},
				};

				const sshAgent = new SshAgent(host, undefined, deployOpts);
				const storedFp = this.ctx.metaDal.getHostFingerprint(hostId);
				const hostKey = `${sshHostname}:${host.sshPort ?? 22}`;
				const sessionFp = this.ctx.trustedOnceFingerprints.get(hostKey);
				await sshAgent.start(storedFp, sessionFp);
				this.broadcaster.updateSessionStatus(hostId, sessionId, "active");
				this.agentMgr.wireAgentEvents(hostId, sessionId, sshAgent);
				this.ctx.agents.set(hostId, sshAgent);

				this.lifecycle.reAttachChannels(hostId, sessionId, sshAgent);
			} catch {
				const nextElapsed = Date.now() - startTime;
				if (nextElapsed >= RECONNECT_TIMEOUT_MS) {
					this.lifecycle.closeSession(hostId, sessionId);
				} else {
					this.scheduleReconnect(hostId, sessionId, attemptIndex + 1, startTime);
				}
			}
		}, delayMs);
		this.ctx.reconnectTimers.set(hostId, timer);
	}

	// ─── Test connect ─────────────────────────────────────────────────────────

	async handleTestConnect(clientId: string, msg: TestConnectMessage): Promise<void> {
		const client = this.ctx.clients.get(clientId);
		if (!client) return;

		const promptAuth = this.buildPromptAuth(client);

		try {
			const result = await this._testSshConnectivity(msg, promptAuth);
			if (result.ok) {
				client.send({ type: "TEST_CONNECT_OK", hostId: msg.hostId });
			} else {
				client.send({
					type: "TEST_CONNECT_FAIL",
					hostId: msg.hostId,
					message: result.message ?? "Connection failed",
				});
			}
		} catch (err) {
			client.send({
				type: "TEST_CONNECT_FAIL",
				hostId: msg.hostId,
				message: err instanceof Error ? err.message : "Connection test failed",
			});
		}
	}

	private async _testSshConnectivity(
		msg: TestConnectMessage,
		promptAuth: AuthPromptFn,
	): Promise<{ ok: boolean; message?: string }> {
		const sshClient = new SshClient();
		const SSH_TEST_TIMEOUT_MS = 10_000;

		const username = msg.sshUser ?? process.env.USER ?? "root";

		let connectConfig: Parameters<InstanceType<typeof SshClient>["connect"]>[0];
		try {
			connectConfig = await buildSshConnectConfig(
				{ method: msg.sshAuth ?? "key", keyPath: msg.sshKeyPath },
				msg.hostname,
				msg.port,
				username,
				promptAuth,
				msg.hostId,
			);
		} catch (err) {
			return {
				ok: false,
				message: err instanceof Error ? err.message : "Authentication error",
			};
		}
		connectConfig.readyTimeout = SSH_TEST_TIMEOUT_MS;

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				sshClient.destroy();
				resolve({ ok: false, message: "Connection timed out" });
			}, SSH_TEST_TIMEOUT_MS);

			sshClient.on("ready", () => {
				clearTimeout(timer);
				sshClient.end();
				resolve({ ok: true });
			});

			sshClient.on("error", (err: Error) => {
				clearTimeout(timer);
				const errMsg = err.message ?? "Unknown error";
				const lower = errMsg.toLowerCase();
				if (
					errMsg.includes("ECONNREFUSED") ||
					errMsg.includes("ETIMEDOUT") ||
					errMsg.includes("EHOSTUNREACH") ||
					errMsg.includes("ENOTFOUND")
				) {
					resolve({ ok: false, message: errMsg });
				} else if (
					lower.includes("authentication") ||
					lower.includes("permission denied") ||
					lower.includes("publickey") ||
					lower.includes("keyboard-interactive") ||
					lower.includes("all configured authentication methods failed")
				) {
					sshClient.end();
					resolve({ ok: false, message: "Authentication failed" });
				} else {
					sshClient.end();
					resolve({ ok: false, message: errMsg });
				}
			});

			try {
				sshClient.connect(connectConfig);
			} catch (err) {
				clearTimeout(timer);
				resolve({
					ok: false,
					message: err instanceof Error ? err.message : "Connection failed",
				});
			}
		});
	}
}
