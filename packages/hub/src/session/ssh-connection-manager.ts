/**
 * SshConnectionManager — SSH-specific connection logic:
 *   - auth prompt request/response
 *   - host key mismatch verification
 *   - reconnect with exponential backoff
 *   - test connectivity
 */

import type {
	AuthPromptMessage,
	ErrorMessage,
	HostVerifyMessage,
	ProtocolMessage,
	TestConnectMessage,
} from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import { Client as SshClient } from "ssh2";
import type { SharedSessionContext } from "./session-context.js";
import type { StateBroadcaster } from "./state-broadcaster.js";
import type { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import type { AgentConnectionManager } from "./agent-connection-manager.js";
import type { WsClient } from "./session-manager.js";
import {
	type AuthPromptFn,
	SshAgent,
	buildSshConnectConfig,
} from "./ssh-agent.js";

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
			const promptMsg: AuthPromptMessage = { type: "AUTH_PROMPT", hostId, promptType, message };
			client.send(promptMsg);
			return new Promise<string | null>((resolve) => {
				this.ctx.pendingAuthPrompts.set(hostId, { resolve, timer: null, clientId: client.id });
			});
		};
	}

	handleAuthPromptResponse(clientId: string, hostId: string, secret: string | null): void {
		const pending = this.ctx.pendingAuthPrompts.get(hostId);
		if (!pending) return;
		if (pending.timer !== null) clearTimeout(pending.timer);
		this.ctx.pendingAuthPrompts.delete(hostId);
		pending.resolve(secret);
	}

	// ─── Host key mismatch ────────────────────────────────────────────────────

	/**
	 * Send HOST_VERIFY to the client with mismatch details and wait (30 s timeout)
	 * for HOST_VERIFY_RESPONSE. Returns true if the user accepted the new key.
	 */
	async promptHostKeyMismatch(
		client: WsClient,
		hostId: string,
		hostname: string,
		oldFingerprint: string,
		newFingerprint: string,
	): Promise<boolean> {
		const promptId = generateId();
		const verifyMsg: HostVerifyMessage = {
			type: "HOST_VERIFY",
			hostId,
			fingerprint: newFingerprint,
			algorithm: "SHA256",
			oldFingerprint,
			promptId,
		};
		client.send(verifyMsg);

		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.ctx.pendingHostVerify.delete(promptId);
				console.warn(
					`[ssh-connection] HOST_VERIFY timeout for host ${hostId} (${hostname}) — rejecting`,
				);
				resolve(false);
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
		pending.resolve(action !== "reject");
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
				const sshAgent = new SshAgent(host);
				const storedFp = this.ctx.metaDal.getHostFingerprint(hostId);
				await sshAgent.start(storedFp);
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
