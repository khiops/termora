import type {
	AgentSnapshotResMessage,
	AgentSpawnErrMessage,
	AgentSpawnMessage,
	AgentSpawnOkMessage,
	ChannelExitMessage,
	ChannelStateMessage,
	ErrorMessage,
	InputMessage,
	OutputMessage,
	ProtocolMessage,
	ResizeMessage,
	SessionStateMessage,
	UiAttachOkMessage,
	UiSpawnMessage,
	UiSpawnOkMessage,
} from "@nexterm/shared";
import type { ChannelStatus, SessionStatus } from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import type { DatabaseManager } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";
import { SpoolDAL } from "../storage/spool.js";
import type { AgentConnection } from "./agent-connection.js";
import { LocalAgent, resolveAgentPath } from "./local-agent.js";
import { SnapshotScheduler } from "./snapshot-scheduler.js";
import { SshAgent } from "./ssh-agent.js";

const SPAWN_TIMEOUT_MS = 10_000;

/** Reconnect backoff steps in ms (capped at 30s, total budget 5 min) */
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const RECONNECT_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

export interface WsClient {
	id: string;
	send: (msg: ProtocolMessage) => void;
	attachedChannels: Set<string>;
}

interface ChannelState {
	sessionId: string;
	hostId: string;
	status: ChannelStatus;
	/** clientId set — empty when orphan */
	clients: Set<string>;
	shell: string;
	cwd?: string;
}

interface SessionState {
	id: string;
	hostId: string;
	status: SessionStatus;
}

export class SessionManager {
	/** hostId → AgentConnection */
	private agents = new Map<string, AgentConnection>();
	/** Spool DAL for snapshot chunk storage */
	private spoolDal: SpoolDAL;
	/** hostId → SessionState */
	private sessions = new Map<string, SessionState>();
	/** channelId → ChannelState */
	private channels = new Map<string, ChannelState>();
	/** clientId → WsClient */
	private clients = new Map<string, WsClient>();
	/** hostId → pending reconnect timer */
	private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private metaDal: MetaDAL;

	/** Snapshot scheduler — tracks idle/forced/detach triggers per channel */
	private scheduler: SnapshotScheduler;

	constructor(private dbManager: DatabaseManager) {
		this.metaDal = new MetaDAL(dbManager.meta);
		this.spoolDal = new SpoolDAL(dbManager.spool);
		this.scheduler = new SnapshotScheduler((channelId) => {
			// Find the agent for this channel via the channel's hostId
			const ch = this.channels.get(channelId);
			return ch ? this.agents.get(ch.hostId) : undefined;
		});
	}

	/**
	 * Ensure the built-in "local" host exists in meta.db.
	 * Idempotent — creates on first call, returns existing id thereafter.
	 */
	async ensureLocalHost(): Promise<string> {
		const existing = this.metaDal.getHostByLabel("local");
		if (existing) return existing.id;
		const host = this.metaDal.createHost({ type: "local", label: "local" });
		return host.id;
	}

	/** Expose MetaDAL for REST API route handlers. */
	getMetaDal(): MetaDAL {
		return this.metaDal;
	}

	addClient(client: WsClient): void {
		this.clients.set(client.id, client);
	}

	removeClient(clientId: string): void {
		const client = this.clients.get(clientId);
		if (!client) return;
		// Copy set to avoid mutating while iterating
		for (const channelId of [...client.attachedChannels]) {
			this._detachClient(clientId, channelId);
		}
		this.clients.delete(clientId);
	}

	/**
	 * Handle a SPAWN message from a UI client.
	 * For local hosts: always active (local agent starts immediately).
	 * For SSH hosts: session starts as 'starting', transitions to 'active' on HELLO.
	 */
	async handleSpawn(clientId: string, msg: UiSpawnMessage): Promise<void> {
		const client = this.clients.get(clientId);
		if (!client) return;

		// Resolve host: if hostId is "local" or missing, use the local host
		const hostId = await this._resolveHostId(msg.hostId);
		const host = this.metaDal.getHost(hostId);
		if (!host) {
			const errorMsg: ErrorMessage = {
				type: "ERROR",
				code: "HOST_NOT_FOUND",
				message: `Host ${hostId} not found`,
			};
			client.send(errorMsg);
			return;
		}

		// Get or create session for this host
		const session = await this._getOrCreateSession(hostId, host.type === "ssh");

		// Get or create agent for this host
		let agent = this.agents.get(hostId);
		if (!agent?.connected) {
			if (host.type === "ssh") {
				const sshAgent = new SshAgent(host);
				// Connect and wait for HELLO — session transitions to 'active' on success
				try {
					await sshAgent.start();
				} catch (err) {
					// Session failed to start — close it
					this._updateSessionStatus(hostId, session.id, "closed");
					const errorMsg: ErrorMessage = {
						type: "ERROR",
						code: "SSH_CONNECT_FAILED",
						message: err instanceof Error ? err.message : "SSH connection failed",
					};
					client.send(errorMsg);
					return;
				}
				this._updateSessionStatus(hostId, session.id, "active");
				this._wireAgentEvents(hostId, session.id, sshAgent);
				this.agents.set(hostId, sshAgent);
				agent = sshAgent;
			} else {
				const la = new LocalAgent(resolveAgentPath());
				await la.start();
				this._wireAgentEvents(hostId, session.id, la);
				this.agents.set(hostId, la);
				agent = la;
				// Local agents are immediately active
				this._updateSessionStatus(hostId, session.id, "active");
			}
		}

		const requestId = generateId();
		const shell = msg.shell ?? process.env.SHELL ?? "/bin/sh";
		const cwd = msg.cwd ?? process.env.HOME ?? "/";

		const agentSpawn: AgentSpawnMessage = {
			type: "SPAWN",
			requestId,
			shell,
			cwd,
			env: msg.env ?? {},
			cols: 80,
			rows: 24,
		};
		agent.send(agentSpawn);

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				agent?.off("message", handler);
				reject(new Error("Agent SPAWN timeout"));
			}, SPAWN_TIMEOUT_MS);

			const handler = (incoming: ProtocolMessage) => {
				if (incoming.type === "SPAWN_OK") {
					const spawnOk = incoming as AgentSpawnOkMessage;
					if (spawnOk.requestId !== requestId) return;
					clearTimeout(timer);
					agent?.off("message", handler);

					const { channelId } = spawnOk;

					// Persist channel as 'born' then immediately 'live' (first client attaches)
					this.metaDal.createChannel({
						id: channelId,
						sessionId: session.id,
						status: "born",
						shell,
						cwd,
					});

					this.channels.set(channelId, {
						sessionId: session.id,
						hostId,
						status: "live",
						clients: new Set([clientId]),
						shell,
						cwd,
					});
					this.metaDal.updateChannelStatus(channelId, "live");
					this.scheduler.trackChannel(channelId);
					client.attachedChannels.add(channelId);

					// Notify all clients of the channel state change
					const channelStateMsg: ChannelStateMessage = {
						type: "CHANNEL_STATE",
						channelId,
						sessionId: session.id,
						status: "live",
					};
					this._broadcastToAllClients(channelStateMsg);

					const response: UiSpawnOkMessage = {
						type: "SPAWN_OK",
						channelId,
						hostId,
						sessionId: session.id,
					};
					client.send(response);
					resolve();
				} else if (incoming.type === "SPAWN_ERR") {
					const spawnErr = incoming as AgentSpawnErrMessage;
					if (spawnErr.requestId !== requestId) return;
					clearTimeout(timer);
					agent?.off("message", handler);

					const errorMsg: ErrorMessage = {
						type: "ERROR",
						code: spawnErr.code,
						message: spawnErr.message,
					};
					client.send(errorMsg);
					reject(new Error(`SPAWN_ERR [${spawnErr.code}]: ${spawnErr.message}`));
				}
			};
			agent?.on("message", handler);
		});
	}

	handleAttach(clientId: string, channelId: string): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		const channel = this.channels.get(channelId);
		if (!channel) {
			const errorMsg: ErrorMessage = {
				type: "ERROR",
				code: "CHANNEL_NOT_FOUND",
				message: `Channel ${channelId} not found`,
			};
			client.send(errorMsg);
			return;
		}

		const wasOrphan = channel.status === "orphan";
		channel.clients.add(clientId);
		client.attachedChannels.add(channelId);

		// orphan → live on first reattach
		if (wasOrphan) {
			this._updateChannelStatus(channelId, channel.sessionId, "live");
		}

		// M1: no snapshot, no tail, no write-lock
		const attachOk: UiAttachOkMessage = {
			type: "ATTACH_OK",
			channelId,
			snapshot: null,
			tail: [],
			writeLockHolder: null,
			cached: false,
		};
		client.send(attachOk);
	}

	handleDetach(clientId: string, channelId: string): void {
		this._detachClient(clientId, channelId);
	}

	handleInput(clientId: string, channelId: string, data: Uint8Array): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		const agent = this.agents.get(channel.hostId);
		if (!agent) return;
		const inputMsg: InputMessage = { type: "INPUT", channelId, data };
		agent.send(inputMsg);
	}

	handleResize(clientId: string, channelId: string, cols: number, rows: number): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		const agent = this.agents.get(channel.hostId);
		if (!agent) return;
		const resizeMsg: ResizeMessage = { type: "RESIZE", channelId, cols, rows };
		agent.send(resizeMsg);
	}

	/**
	 * Explicitly close a session by its ID. Called by the REST DELETE /api/sessions/:id endpoint.
	 * Marks all channels dead, transitions session to 'closed', and closes the agent connection.
	 */
	async closeSession(sessionId: string): Promise<void> {
		// Find which host owns this session
		let hostId: string | undefined;
		for (const [hId, state] of this.sessions.entries()) {
			if (state.id === sessionId) {
				hostId = hId;
				break;
			}
		}

		if (!hostId) {
			// Session not in memory — still clean up DB state via metaDal
			this.metaDal.updateSessionStatus(sessionId, "closed");
			return;
		}

		// Close the agent connection for this host
		const agent = this.agents.get(hostId);
		if (agent) {
			agent.close();
			this.agents.delete(hostId);
		}

		this._closeSession(hostId, sessionId);
	}

	async shutdown(): Promise<void> {
		for (const timer of this.reconnectTimers.values()) {
			clearTimeout(timer);
		}
		this.reconnectTimers.clear();
		this.scheduler.shutdown();
		for (const agent of this.agents.values()) {
			agent.close();
		}
		this.agents.clear();
		this.clients.clear();
		this.channels.clear();
		this.sessions.clear();
	}

	// ─── Private helpers ────────────────────────────────────────────────────

	private async _resolveHostId(requestedId?: string): Promise<string> {
		if (!requestedId || requestedId === "local") {
			return this.ensureLocalHost();
		}
		return requestedId;
	}

	private async _getOrCreateSession(hostId: string, isSsh: boolean): Promise<SessionState> {
		// Reuse existing session that is active or disconnected
		const existing = this.sessions.get(hostId);
		if (existing && (existing.status === "active" || existing.status === "disconnected")) {
			return existing;
		}

		// Create a new session
		const sessionId = generateId();
		const initialStatus: SessionStatus = "starting";
		this.metaDal.createSession({ id: sessionId, hostId, status: initialStatus });

		const state: SessionState = { id: sessionId, hostId, status: initialStatus };
		this.sessions.set(hostId, state);
		return state;
	}

	private _updateSessionStatus(hostId: string, sessionId: string, status: SessionStatus): void {
		const state = this.sessions.get(hostId);
		if (state && state.id === sessionId) {
			state.status = status;
		}
		this.metaDal.updateSessionStatus(sessionId, status);

		const stateMsg: SessionStateMessage = {
			type: "SESSION_STATE",
			sessionId,
			hostId,
			status,
		};
		this._broadcastToAllClients(stateMsg);
	}

	private _updateChannelStatus(
		channelId: string,
		sessionId: string,
		status: ChannelStatus,
		exitCode?: number,
	): void {
		const ch = this.channels.get(channelId);
		if (ch) {
			ch.status = status;
		}
		this.metaDal.updateChannelStatus(channelId, status, exitCode);

		const stateMsg: ChannelStateMessage = {
			type: "CHANNEL_STATE",
			channelId,
			sessionId,
			status,
			...(exitCode !== undefined && { exitCode }),
		};
		// Broadcast to attached clients first; fall back to all clients for orphan/dead
		// when the channel has no more clients (they just detached).
		if (ch && ch.clients.size > 0) {
			this._broadcastToChannel(channelId, stateMsg);
		} else {
			this._broadcastToAllClients(stateMsg);
		}
	}

	private _detachClient(clientId: string, channelId: string): void {
		const channel = this.channels.get(channelId);
		if (channel) {
			channel.clients.delete(clientId);
			// live → orphan when last client detaches (and channel is still live)
			if (channel.clients.size === 0 && channel.status === "live") {
				this._updateChannelStatus(channelId, channel.sessionId, "orphan");
				this.scheduler.onDetach(channelId);
				this._checkSessionDetached(channel.hostId);
			}
		}
		this.clients.get(clientId)?.attachedChannels.delete(channelId);
	}

	/** If all clients detached from all channels of a host, session → detached */
	private _checkSessionDetached(hostId: string): void {
		const session = this.sessions.get(hostId);
		if (!session || session.status !== "active") return;

		// Check if any channel for this session is still live
		for (const ch of this.channels.values()) {
			if (ch.hostId === hostId && ch.status === "live") return;
		}

		this._updateSessionStatus(hostId, session.id, "detached");
	}

	private _wireAgentEvents(hostId: string, sessionId: string, agent: AgentConnection): void {
		agent.on("message", (msg: ProtocolMessage) => {
			if (msg.type === "OUTPUT") {
				const outputMsg = msg as OutputMessage;
				this.scheduler.onOutput(outputMsg.channelId);
				this._broadcastToChannel(outputMsg.channelId, outputMsg);
			} else if (msg.type === "SNAPSHOT_RES") {
				const res = msg as AgentSnapshotResMessage;
				const snapshotJson = JSON.stringify(res.snapshot);
				const dataBlob = Buffer.from(snapshotJson);
				const chunkId = this.spoolDal.insertChunk({
					channelId: res.channelId,
					seq: res.lastSeq + 1,
					kind: "snapshot",
					dataBlob,
					uncompressedLen: dataBlob.length,
				});
				this.metaDal.updateCacheIndex(res.channelId, chunkId, res.lastSeq);
			} else if (msg.type === "CHANNEL_EXIT") {
				const exitMsg = msg as ChannelExitMessage;
				const channel = this.channels.get(exitMsg.channelId);
				if (channel) {
					this._updateChannelStatus(exitMsg.channelId, channel.sessionId, "dead", exitMsg.exitCode);
				}
				this.scheduler.untrackChannel(exitMsg.channelId);
			}
		});

		agent.on("close", () => {
			const session = this.sessions.get(hostId);
			const host = this.metaDal.getHost(hostId);
			this.agents.delete(hostId);

			if (!session) return;

			if (host?.type === "ssh") {
				// SSH: attempt reconnect with exponential backoff
				this._updateSessionStatus(hostId, session.id, "disconnected");
				this._scheduleReconnect(hostId, session.id, 0, Date.now());
			} else {
				// Local: close immediately
				this._closeSession(hostId, session.id);
			}
		});
	}

	private _scheduleReconnect(
		hostId: string,
		sessionId: string,
		attemptIndex: number,
		startTime: number,
	): void {
		const elapsed = Date.now() - startTime;
		if (elapsed >= RECONNECT_TIMEOUT_MS) {
			this._closeSession(hostId, sessionId);
			return;
		}

		const delayMs =
			RECONNECT_BACKOFF_MS[Math.min(attemptIndex, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;

		const timer = setTimeout(async () => {
			this.reconnectTimers.delete(hostId);

			// Check if session was explicitly closed in the meantime
			const session = this.sessions.get(hostId);
			if (!session || session.status === "closed") return;

			const host = this.metaDal.getHost(hostId);
			if (!host) {
				this._closeSession(hostId, sessionId);
				return;
			}

			try {
				const sshAgent = new SshAgent(host);
				await sshAgent.start();
				this._updateSessionStatus(hostId, sessionId, "active");
				this._wireAgentEvents(hostId, sessionId, sshAgent);
				this.agents.set(hostId, sshAgent);

				// Re-ATTACH all live/orphan channels for this session
				this._reAttachChannels(hostId, sessionId, sshAgent);
			} catch {
				// Reconnect failed — try again
				const nextElapsed = Date.now() - startTime;
				if (nextElapsed >= RECONNECT_TIMEOUT_MS) {
					this._closeSession(hostId, sessionId);
				} else {
					this._scheduleReconnect(hostId, sessionId, attemptIndex + 1, startTime);
				}
			}
		}, delayMs);
		this.reconnectTimers.set(hostId, timer);
	}

	private _reAttachChannels(hostId: string, sessionId: string, agent: AgentConnection): void {
		for (const [channelId, ch] of this.channels.entries()) {
			if (ch.hostId !== hostId || ch.status === "dead") continue;

			// Re-spawn channels that were alive before disconnect
			const requestId = generateId();
			const agentSpawn: AgentSpawnMessage = {
				type: "SPAWN",
				requestId,
				shell: ch.shell,
				cwd: ch.cwd ?? process.env.HOME ?? "/",
				env: {},
				cols: 80,
				rows: 24,
			};
			agent.send(agentSpawn);

			// Listen for SPAWN_OK matching this requestId to re-map the channel
			const handler = (incoming: ProtocolMessage): void => {
				if (incoming.type === "SPAWN_OK") {
					const spawnOk = incoming as AgentSpawnOkMessage;
					if (spawnOk.requestId !== requestId) return;
					agent.off("message", handler);

					// Map the new channelId back to the old one isn't straightforward;
					// for now re-attach under the new channelId and notify clients
					const newChannelId = spawnOk.channelId;
					this.channels.set(newChannelId, {
						...ch,
						status: ch.clients.size > 0 ? "live" : "orphan",
					});
					this.channels.delete(channelId);

					// Notify clients about the new channel
					const stateMsg: ChannelStateMessage = {
						type: "CHANNEL_STATE",
						channelId: newChannelId,
						sessionId,
						status: "live",
					};
					for (const clientId of ch.clients) {
						const client = this.clients.get(clientId);
						if (client) {
							client.attachedChannels.delete(channelId);
							client.attachedChannels.add(newChannelId);
							client.send(stateMsg);
						}
					}
				}
			};
			agent.on("message", handler);
		}
	}

	private _closeSession(hostId: string, sessionId: string): void {
		// Cancel any pending reconnect timer for this host
		const pendingTimer = this.reconnectTimers.get(hostId);
		if (pendingTimer !== undefined) {
			clearTimeout(pendingTimer);
			this.reconnectTimers.delete(hostId);
		}
		// Mark all channels for this session as dead and stop tracking them
		for (const [channelId, ch] of this.channels.entries()) {
			if (ch.hostId !== hostId || ch.status === "dead") continue;
			this._updateChannelStatus(channelId, sessionId, "dead");
			this.scheduler.untrackChannel(channelId);
		}
		this._updateSessionStatus(hostId, sessionId, "closed");
		this.sessions.delete(hostId);
	}

	private _broadcastToChannel(channelId: string, msg: ProtocolMessage): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		for (const clientId of channel.clients) {
			this.clients.get(clientId)?.send(msg);
		}
	}

	private _broadcastToAllClients(msg: ProtocolMessage): void {
		for (const client of this.clients.values()) {
			client.send(msg);
		}
	}
}
