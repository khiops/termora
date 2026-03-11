import type {
	AgentAttachMessage,
	AgentAttachOkMessage,
	AgentBellMessage,
	AgentChannelStateMessage,
	AgentNotificationMessage,
	AgentProcessTitleMessage,
	AgentSnapshotResMessage,
	AgentSpawnErrMessage,
	AgentSpawnMessage,
	AgentSpawnOkMessage,
	AgentTitleChangeMessage,
	AuthPromptMessage,
	ChannelExitMessage,
	ChannelStateMessage,
	DestroyMessage,
	ErrorMessage,
	InputMessage,
	OutputMessage,
	ProtocolMessage,
	ResizeMessage,
	SessionStateMessage,
	StateSyncMessage,
	TestConnectMessage,
	UiAttachOkMessage,
	UiSpawnMessage,
	UiSpawnOkMessage,
} from "@nexterm/shared";
import type { AgentConfig, ChannelStatus, SessionStatus } from "@nexterm/shared";
import {
	DEFAULT_AGENT_CONFIG,
	DEFAULT_CHANNEL_NAME,
	generateId,
	getSocketPath,
	resolveChannelDisplayName,
} from "@nexterm/shared";
import { Client as SshClient } from "ssh2";
import type { ConfigResolver, GcConfig } from "../config.js";
import type { DatabaseManager } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";
import { SpoolDAL } from "../storage/spool.js";
import type { AgentConnection } from "./agent-connection.js";
import { connectOrLaunch } from "./agent-launcher.js";
import { LocalAgent, resolveAgentPath } from "./local-agent.js";
import { NextermAgent } from "./nexterm-agent.js";
import { OutputChunker } from "./output-chunker.js";
import { SnapshotScheduler } from "./snapshot-scheduler.js";
import { SpoolGarbageCollector } from "./spool-gc.js";
import { type AuthPromptFn, SshAgent, buildSshConnectConfig } from "./ssh-agent.js";

const SPAWN_TIMEOUT_MS = 10_000;
const ATTACH_TIMEOUT_MS = 5_000;
const TITLE_DEBOUNCE_MS = 100;

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
	args?: string[];
	cwd?: string;
	cols: number;
	rows: number;
	directProcess?: boolean;
	dynamicTitle: string | null;
	processTitle: string | null;
	displayTitle: string;
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
	/** Crash-loop tracking for local agent restarts: hostId → { count, windowStart } */
	private restartTracking = new Map<string, { count: number; windowStart: number }>();
	/** requestId (or keyed token like "attach:<channelId>") → callback for pending agent responses */
	private pendingRequests = new Map<string, (msg: ProtocolMessage) => void>();
	/** hostId → pending auth prompt resolve + timeout */
	private pendingAuthPrompts = new Map<
		string,
		{
			resolve: (secret: string | null) => void;
			timer: ReturnType<typeof setTimeout> | null;
			clientId: string;
		}
	>();
	private metaDal: MetaDAL;
	/** Agent daemon configuration (socket path, buffer caps) */
	private agentConfig: AgentConfig;
	/** Config resolver — used for title resolution */
	private _configResolver: ConfigResolver | null = null;

	/** Snapshot scheduler — tracks idle/forced/detach triggers per channel */
	private scheduler: SnapshotScheduler;
	/** Output chunker — buffers OUTPUT data and flushes to spool.db */
	private chunker: OutputChunker;
	/** Spool GC — periodically deletes old chunks and runs incremental vacuum */
	private gc: SpoolGarbageCollector;
	/** channelId → pending title debounce timer for DB writes */
	private titleDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** channelId → pending process title debounce timer for DB writes */
	private processTitleDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** channelId → timestamps of recent BELL messages (sliding window for rate limiting) */
	private bellTimestamps = new Map<string, number[]>();
	/** channelId → timestamps of recent NOTIFICATION messages (sliding window for rate limiting) */
	private notificationTimestamps = new Map<string, number[]>();

	/**
	 * Optional callback to resolve the current write-lock holder for a channel.
	 * Injected by ws-handler.ts after WriteLockManager is created.
	 */
	private _getWriteLockHolder: ((channelId: string) => string | null) | null = null;

	setGetWriteLockHolder(fn: (channelId: string) => string | null): void {
		this._getWriteLockHolder = fn;
	}

	constructor(
		private dbManager: DatabaseManager,
		gcConfig?: GcConfig,
		agentConfig?: AgentConfig,
		configResolver?: ConfigResolver,
	) {
		this.metaDal = new MetaDAL(dbManager.meta);
		this.spoolDal = new SpoolDAL(dbManager.spool);
		this.agentConfig = agentConfig ?? { ...DEFAULT_AGENT_CONFIG };
		this._configResolver = configResolver ?? null;
		this.scheduler = new SnapshotScheduler((channelId) => {
			// Find the agent for this channel via the channel's hostId
			const ch = this.channels.get(channelId);
			return ch ? this.agents.get(ch.hostId) : undefined;
		});
		this.chunker = new OutputChunker(this.spoolDal);
		this.gc = new SpoolGarbageCollector(this.spoolDal, this.metaDal, gcConfig);
		this.gc.start();
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

	/**
	 * On hub start, restore sessions that were alive before the previous shutdown.
	 * Local hosts get a warm restart (respawn agent + PTYs under same channel IDs).
	 * SSH hosts get their channels marked orphan (future: schedule reconnect).
	 * If no alive channels exist, this is a no-op (fresh start).
	 */
	async startup(): Promise<void> {
		const alive = this.metaDal.listAliveChannelsWithHost();
		if (alive.length === 0) return;

		// Group by hostId
		const byHost = new Map<string, typeof alive>();
		for (const ch of alive) {
			const group = byHost.get(ch.hostId) ?? [];
			group.push(ch);
			byHost.set(ch.hostId, group);
		}

		for (const [hostId, channels] of byHost) {
			const first = channels[0];
			if (!first) continue;
			const hostType = first.hostType;
			// Find the non-closed session for this host
			const sessions = this.metaDal.listSessions(hostId);
			const session = sessions.find((s) => s.status !== "closed");
			if (!session) {
				// No active session — mark channels dead
				for (const ch of channels) {
					this.metaDal.updateChannelStatus(ch.id, "dead");
				}
				continue;
			}

			// Mark session disconnected (agent is gone after hub restart)
			this.metaDal.markHostSessionDisconnected(hostId);
			this.sessions.set(hostId, {
				id: session.id,
				hostId,
				status: "disconnected",
			});

			// Mark channels orphan + restore in-memory state
			this.metaDal.markHostChannelsOrphan(hostId);
			for (const ch of channels) {
				this.channels.set(ch.id, {
					sessionId: session.id,
					hostId,
					status: "orphan",
					clients: new Set(),
					shell: ch.shell,
					...(ch.args.length > 0 && { args: ch.args }),
					cols: ch.cols,
					rows: ch.rows,
					...(ch.cwd !== null && { cwd: ch.cwd }),
					...(ch.directProcess && { directProcess: true }),
					dynamicTitle: null,
					processTitle: null,
					displayTitle: DEFAULT_CHANNEL_NAME,
				});
			}

			if (hostType === "local") {
				try {
					await this._connectDaemonAgent(hostId, session.id);
				} catch {
					// Daemon connect failed — fall back to warm restart
					await this._warmRestartLocal(hostId, session.id);
				}
			}
			// SSH: channels stay orphan — future enhancement could schedule reconnect
		}
	}

	/** Expose MetaDAL for REST API route handlers. */
	getMetaDal(): MetaDAL {
		return this.metaDal;
	}

	/** Expose SpoolDAL for REST API route handlers that need to purge chunks. */
	getSpoolDal(): SpoolDAL {
		return this.spoolDal;
	}

	/**
	 * Returns all WsClient instances currently attached to a channel.
	 * Used by WriteLockManager's broadcastToChannel callback.
	 */
	getClientsForChannel(channelId: string): WsClient[] {
		const channel = this.channels.get(channelId);
		if (!channel) return [];
		const result: WsClient[] = [];
		for (const clientId of channel.clients) {
			const client = this.clients.get(clientId);
			if (client) result.push(client);
		}
		return result;
	}

	addClient(client: WsClient): void {
		this.clients.set(client.id, client);
	}

	/** Build a STATE_SYNC payload with all current session and channel states. */
	getStateSnapshot(): StateSyncMessage {
		const sessions: StateSyncMessage["sessions"] = [];
		for (const [hostId, state] of this.sessions) {
			if (state.status !== "closed") {
				sessions.push({ sessionId: state.id, hostId, status: state.status });
			}
		}
		const channels: StateSyncMessage["channels"] = [];
		for (const [channelId, ch] of this.channels) {
			if (ch.status !== "dead") {
				channels.push({
					channelId,
					sessionId: ch.sessionId,
					status: ch.status,
					displayTitle: ch.displayTitle,
				});
			}
		}
		return { type: "STATE_SYNC", sessions, channels };
	}

	/**
	 * Called by the REST PATCH /api/channels/:id route when a channel is renamed
	 * (custom title set via F2). Recomputes displayTitle and broadcasts a
	 * TITLE_CHANGE-like update to all connected UI clients.
	 */
	notifyChannelRenamed(channelId: string): void {
		const channel = this.channels.get(channelId);
		if (!channel) return; // Channel not active in memory — nothing to broadcast

		const displayTitle = this._resolveDisplayTitle(channelId);
		const msg = {
			type: "TITLE_CHANGE" as const,
			channelId,
			title: channel.dynamicTitle ?? "",
			displayTitle,
		};
		this._broadcastToChannel(channelId, msg);
	}

	/**
	 * Re-resolves displayTitle for every active channel and broadcasts a
	 * TITLE_CHANGE message to each channel's UI clients.
	 *
	 * Called when the global title config (source, staticTitle, etc.) changes
	 * via PUT /api/config/ui so that all open tabs immediately reflect the
	 * new title format without requiring a reconnect.
	 */
	broadcastDisplayTitles(): void {
		for (const [channelId, channel] of this.channels) {
			const displayTitle = this._resolveDisplayTitle(channelId);
			const msg = {
				type: "TITLE_CHANGE" as const,
				channelId,
				title: channel.dynamicTitle ?? "",
				displayTitle,
			};
			this._broadcastToChannel(channelId, msg);
		}
	}

	removeClient(clientId: string): void {
		const client = this.clients.get(clientId);
		if (!client) return;
		// Copy set to avoid mutating while iterating
		for (const channelId of [...client.attachedChannels]) {
			this._detachClient(clientId, channelId);
		}
		// Cancel any pending auth prompts initiated by this client
		for (const [hostId, pending] of this.pendingAuthPrompts) {
			if (pending.clientId === clientId) {
				if (pending.timer !== null) clearTimeout(pending.timer);
				this.pendingAuthPrompts.delete(hostId);
				pending.resolve(null);
			}
		}
		this.clients.delete(clientId);
	}

	/**
	 * Handle a SPAWN message from a UI client.
	 * For local hosts: always active (local agent starts immediately).
	 * For SSH hosts: session starts as 'starting', transitions to 'active' on HELLO.
	 */
	async handleSpawn(clientId: string, msg: UiSpawnMessage): Promise<string | null> {
		const client = this.clients.get(clientId);
		if (!client) return null;

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
			return null;
		}

		// Get or create session for this host
		const session = await this._getOrCreateSession(hostId, host.type === "ssh");

		// Get or create agent for this host
		let agent = this.agents.get(hostId);
		if (!agent?.connected) {
			if (host.type === "ssh") {
				const promptAuth = this._buildPromptAuth(client);
				const sshAgent = new SshAgent(host, promptAuth);
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
					return null;
				}
				this._updateSessionStatus(hostId, session.id, "active");
				this._wireAgentEvents(hostId, session.id, sshAgent);
				this.agents.set(hostId, sshAgent);
				agent = sshAgent;
			} else {
				// Local: try daemon first, fall back to child-process agent
				try {
					agent = await this._connectDaemonAgent(hostId, session.id);
				} catch {
					const la = new LocalAgent(resolveAgentPath());
					await la.start();
					this._wireAgentEvents(hostId, session.id, la);
					this.agents.set(hostId, la);
					agent = la;
					this._updateSessionStatus(hostId, session.id, "active");
				}
			}
		}

		const requestId = generateId();
		const shell = msg.shell ?? process.env.SHELL ?? "/bin/sh";
		const args = msg.args ?? [];
		const cwd = msg.cwd ?? process.env.HOME ?? process.env.USERPROFILE ?? "/";
		const cols = msg.cols ?? 80;
		const rows = msg.rows ?? 24;
		const directProcess = msg.directProcess ?? false;

		const agentSpawn: AgentSpawnMessage = {
			type: "SPAWN",
			requestId,
			shell,
			...(args.length > 0 && { args }),
			cwd,
			env: msg.env ?? {},
			cols,
			rows,
		};
		agent.send(agentSpawn);

		return new Promise<string | null>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				reject(new Error("Agent SPAWN timeout"));
			}, SPAWN_TIMEOUT_MS);

			this.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				if (incoming.type === "SPAWN_OK") {
					const spawnOk = incoming as AgentSpawnOkMessage;
					clearTimeout(timer);
					this.pendingRequests.delete(requestId);

					const { channelId } = spawnOk;

					// Persist channel as 'born' then immediately 'live' (first client attaches).
					// title is null (no custom title) — the UI falls back to dynamicTitle
					// then DEFAULT_CHANNEL_NAME. Setting title = "Terminal" here would
					// prevent dynamic titles (OSC 0/2) from ever showing.
					this.metaDal.createChannel({
						id: channelId,
						sessionId: session.id,
						status: "born",
						shell,
						...(args.length > 0 && { args }),
						cwd,
						cols,
						rows,
						...(directProcess && { directProcess }),
					});

					this.channels.set(channelId, {
						sessionId: session.id,
						hostId,
						status: "live",
						clients: new Set([clientId]),
						shell,
						...(args.length > 0 && { args }),
						cwd,
						cols,
						rows,
						...(directProcess && { directProcess }),
						dynamicTitle: null,
						processTitle: null,
						displayTitle: DEFAULT_CHANNEL_NAME,
					});
					this.metaDal.updateChannelStatus(channelId, "live");
					this.scheduler.trackChannel(channelId);
					this.chunker.trackChannel(channelId);
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
					resolve(channelId);
				} else if (incoming.type === "SPAWN_ERR") {
					const spawnErr = incoming as AgentSpawnErrMessage;
					clearTimeout(timer);
					this.pendingRequests.delete(requestId);

					const errorMsg: ErrorMessage = {
						type: "ERROR",
						code: spawnErr.code,
						message: spawnErr.message,
					};
					client.send(errorMsg);
					reject(new Error(`SPAWN_ERR [${spawnErr.code}]: ${spawnErr.message}`));
				}
			});
		});
	}

	async handleAttach(clientId: string, channelId: string): Promise<boolean> {
		const client = this.clients.get(clientId);
		if (!client) return false;

		const channel = this.channels.get(channelId);
		if (!channel) {
			// Channel not in memory — check DB for dead/not-found
			const dbChannel = this.metaDal.getChannel(channelId);
			if (dbChannel?.status === "dead") {
				// Dead channel — attempt transparent respawn under the same ID
				const respawned = await this._respawnDeadChannel(channelId, client, clientId);
				if (respawned) return true;
				// Respawn failed — fall through to error
			}
			const code = dbChannel?.status === "dead" ? "CHANNEL_DEAD" : "CHANNEL_NOT_FOUND";
			const errorMsg: ErrorMessage = {
				type: "ERROR",
				code,
				message: `Channel ${channelId} ${code === "CHANNEL_DEAD" ? "is dead" : "not found"}`,
			};
			client.send(errorMsg);
			return false;
		}

		const wasOrphan = channel.status === "orphan";
		channel.clients.add(clientId);
		client.attachedChannels.add(channelId);

		// orphan → live on first reattach
		if (wasOrphan) {
			this._updateChannelStatus(channelId, channel.sessionId, "live");
		}

		const agent = this.agents.get(channel.hostId);

		// handleAttach is only called for RE-attaches (tab switch, reconnect,
		// sidebar click). The initial attach after SPAWN goes through
		// handleSpawn + attachChannel. So every call here needs a snapshot.
		//
		// Case 1: agent connected — request fresh snapshot via ATTACH
		// Case 2: agent disconnected — serve cached snapshot from spool.db

		// Look up dynamic_title and process_title from DB once — used in all ATTACH_OK responses
		const dbChannelForTitle = this.metaDal.getChannel(channelId);
		const dynamicTitle = dbChannelForTitle?.dynamicTitle;
		const processTitle = dbChannelForTitle?.processTitle;

		// Backfill in-memory state from DB if not yet populated (e.g. on first attach after hub restart)
		if (dynamicTitle !== undefined && channel.dynamicTitle === null) {
			channel.dynamicTitle = dynamicTitle;
		}
		if (processTitle !== undefined && channel.processTitle === null) {
			channel.processTitle = processTitle;
		}

		// Resolve displayTitle using current in-memory state (now backfilled from DB)
		const displayTitle = this._resolveDisplayTitle(channelId);

		if (!agent?.connected) {
			// Agent disconnected — serve cached snapshot from spool.db
			const { snapshot, tail } = this._buildAttachPayload(channelId);
			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot,
				tail,
				writeLockHolder: this._getWriteLockHolder?.(channelId) ?? null,
				cached: true,
				...(dynamicTitle !== undefined && { dynamicTitle }),
				...(processTitle !== undefined && { processTitle }),
				displayTitle,
			};
			client.send(attachOk);
			return true;
		}

		// Agent connected — request fresh snapshot via ATTACH
		const agentAttach: AgentAttachMessage = { type: "ATTACH", channelId };
		agent.send(agentAttach);

		const pendingKey = `attach:${channelId}`;
		try {
			const agentResponse = await new Promise<AgentAttachOkMessage>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.pendingRequests.delete(pendingKey);
					reject(new Error("Agent ATTACH timeout"));
				}, ATTACH_TIMEOUT_MS);

				this.pendingRequests.set(pendingKey, (incoming: ProtocolMessage) => {
					if (incoming.type === "ATTACH_OK") {
						const attachOkMsg = incoming as AgentAttachOkMessage;
						clearTimeout(timer);
						this.pendingRequests.delete(pendingKey);
						resolve(attachOkMsg);
					} else if (incoming.type === "ERROR") {
						clearTimeout(timer);
						this.pendingRequests.delete(pendingKey);
						reject(new Error("Agent ATTACH error"));
					}
				});
			});

			// Store the fresh snapshot in spool.db (flush + seq coordination)
			this._storeSnapshot(channelId, agentResponse.snapshot, agentResponse.lastSeq);

			// Tail = output chunks after the snapshot's lastSeq
			const tailChunks = this.spoolDal.getChunksByChannel(channelId, {
				kind: "output",
				afterSeq: agentResponse.lastSeq,
			});
			const tail = tailChunks.map((c) => new Uint8Array(c.dataBlob));

			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot: agentResponse.snapshot,
				tail,
				writeLockHolder: this._getWriteLockHolder?.(channelId) ?? null,
				cached: false,
				...(dynamicTitle !== undefined && { dynamicTitle }),
				...(processTitle !== undefined && { processTitle }),
				displayTitle,
			};
			client.send(attachOk);
		} catch {
			// Agent ATTACH failed — fall back to cached snapshot
			const { snapshot, tail } = this._buildAttachPayload(channelId);
			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot,
				tail,
				writeLockHolder: this._getWriteLockHolder?.(channelId) ?? null,
				cached: true,
				...(dynamicTitle !== undefined && { dynamicTitle }),
				...(processTitle !== undefined && { processTitle }),
				displayTitle,
			};
			client.send(attachOk);
		}
		return true;
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
		// Persist last-known dimensions for warm restart
		channel.cols = cols;
		channel.rows = rows;
		this.metaDal.updateChannelDimensions(channelId, cols, rows);
	}

	/**
	 * Resolve a pending auth prompt for a host.
	 * Called by WsHandler when AUTH_PROMPT_RESPONSE arrives from the client.
	 */
	handleAuthPromptResponse(clientId: string, hostId: string, secret: string | null): void {
		const pending = this.pendingAuthPrompts.get(hostId);
		if (!pending) return;
		if (pending.timer !== null) clearTimeout(pending.timer);
		this.pendingAuthPrompts.delete(hostId);
		pending.resolve(secret);
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

	/**
	 * Destroy a single channel: send DESTROY to the agent, mark dead in DB,
	 * untrack from scheduler/chunker, and remove from in-memory map.
	 * Returns true if the channel was found and destroyed.
	 */
	destroyChannel(channelId: string): boolean {
		const ch = this.channels.get(channelId);
		if (!ch) return false;

		// Send DESTROY to the agent (if connected)
		const agent = this.agents.get(ch.hostId);
		if (agent?.connected) {
			agent.send({ type: "DESTROY", channelId } as DestroyMessage);
		}

		// Mark dead in DB + broadcast CHANNEL_STATE to clients
		this._updateChannelStatus(channelId, ch.sessionId, "dead");

		// Untrack from scheduler and chunker
		this.scheduler.untrackChannel(channelId);
		this.chunker.untrackChannel(channelId);

		// Remove from in-memory map
		this.channels.delete(channelId);

		return true;
	}

	/**
	 * Restart a channel: destroy the current PTY and respawn with the same config.
	 * Used by POST /api/channels/:id/restart. Returns true on success.
	 */
	async restartChannel(channelId: string): Promise<boolean> {
		// Load latest config from DB (may have been updated via PATCH)
		const info = this.metaDal.getChannelWithHost(channelId);
		if (!info) return false;

		const { channel, hostId } = info;
		const ch = this.channels.get(channelId);

		// Kill existing PTY if alive
		const agent = this.agents.get(hostId);
		if (agent?.connected && ch && ch.status !== "dead") {
			agent.send({ type: "DESTROY", channelId } as DestroyMessage);
		}

		// Find active session
		const sessionEntry = this.sessions.get(hostId);
		if (!sessionEntry || sessionEntry.status !== "active") return false;
		if (!agent?.connected) return false;

		// Build SPAWN from DB config
		const requestId = generateId();
		const shell = channel.shell ?? process.env.SHELL ?? "/bin/sh";
		const args = channel.args ?? [];
		const cwd = channel.cwd ?? process.env.HOME ?? "/";
		const cols = channel.cols;
		const rows = channel.rows;

		agent.send({
			type: "SPAWN",
			requestId,
			channelId,
			shell,
			...(args.length > 0 && { args }),
			cwd,
			env: {},
			cols,
			rows,
		});

		const ok = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				resolve(false);
			}, SPAWN_TIMEOUT_MS);

			this.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				clearTimeout(timer);
				this.pendingRequests.delete(requestId);
				resolve(incoming.type === "SPAWN_OK");
			});
		});

		if (!ok) return false;

		// Restore in-memory state
		this.metaDal.updateChannelStatus(channelId, "live");
		this.channels.set(channelId, {
			sessionId: sessionEntry.id,
			hostId,
			status: "live",
			clients: ch?.clients ?? new Set(),
			shell,
			...(args.length > 0 && { args }),
			cwd,
			cols,
			rows,
			...(channel.directProcess && { directProcess: true }),
			dynamicTitle: null,
			processTitle: null,
			displayTitle: DEFAULT_CHANNEL_NAME,
		});
		this.scheduler.trackChannel(channelId);
		this.chunker.trackChannel(channelId);

		// Broadcast new state
		const channelStateMsg: ChannelStateMessage = {
			type: "CHANNEL_STATE",
			channelId,
			sessionId: sessionEntry.id,
			status: "live",
		};
		this._broadcastToAllClients(channelStateMsg);

		return true;
	}

	async shutdown(): Promise<void> {
		for (const timer of this.reconnectTimers.values()) {
			clearTimeout(timer);
		}
		this.reconnectTimers.clear();
		for (const timer of this.titleDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.titleDebounceTimers.clear();
		for (const timer of this.processTitleDebounceTimers.values()) {
			clearTimeout(timer);
		}
		this.processTitleDebounceTimers.clear();
		// Cancel all pending auth prompts on shutdown
		for (const [hostId, pending] of this.pendingAuthPrompts) {
			if (pending.timer !== null) clearTimeout(pending.timer);
			this.pendingAuthPrompts.delete(hostId);
			pending.resolve(null);
		}
		this.pendingAuthPrompts.clear();
		this.scheduler.shutdown();
		this.chunker.shutdown();
		this.gc.stop();
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
			// Dispatch pending request responses (SPAWN_OK, SPAWN_ERR, etc.)
			const rid = (msg as { requestId?: string }).requestId;
			if (rid) {
				const handler = this.pendingRequests.get(rid);
				if (handler) {
					handler(msg);
					return;
				}
			}

			// Dispatch pending attach responses (ATTACH_OK uses channelId, not requestId)
			if (msg.type === "ATTACH_OK" || msg.type === "ERROR") {
				const cid = (msg as { channelId?: string }).channelId;
				if (cid) {
					const handler = this.pendingRequests.get(`attach:${cid}`);
					if (handler) {
						handler(msg);
						return;
					}
				}
			}

			if (msg.type === "OUTPUT") {
				const outputMsg = msg as OutputMessage;
				// Broadcast to clients first (real-time, no delay)
				this._broadcastToChannel(outputMsg.channelId, outputMsg);
				// Then notify scheduler and chunker (persistence, async)
				this.scheduler.onOutput(outputMsg.channelId);
				this.chunker.onOutput(outputMsg.channelId, outputMsg.data);
			} else if (msg.type === "SNAPSHOT_RES") {
				const res = msg as AgentSnapshotResMessage;
				this.scheduler.onSnapshotResponse(res.channelId);
				this._storeSnapshot(res.channelId, res.snapshot, res.lastSeq);
			} else if (msg.type === "CHANNEL_EXIT") {
				const exitMsg = msg as ChannelExitMessage;
				const channel = this.channels.get(exitMsg.channelId);
				if (channel) {
					this._updateChannelStatus(exitMsg.channelId, channel.sessionId, "dead", exitMsg.exitCode);
				}
				this.scheduler.untrackChannel(exitMsg.channelId);
				this.chunker.untrackChannel(exitMsg.channelId);
				this._clearTitleDebounce(exitMsg.channelId);
				this._clearProcessTitleDebounce(exitMsg.channelId);
			} else if (msg.type === "TITLE_CHANGE") {
				const titleMsg = msg as AgentTitleChangeMessage;
				this._handleTitleChange(titleMsg);
			} else if (msg.type === "PROCESS_TITLE") {
				const processTitleMsg = msg as AgentProcessTitleMessage;
				this._handleProcessTitle(processTitleMsg);
			} else if (msg.type === "BELL") {
				const bellMsg = msg as AgentBellMessage;
				if (this._rateLimitCheck(this.bellTimestamps, bellMsg.channelId, 10)) {
					this._broadcastToChannel(bellMsg.channelId, bellMsg);
				}
			} else if (msg.type === "NOTIFICATION") {
				const notifMsg = msg as AgentNotificationMessage;
				if (this._rateLimitCheck(this.notificationTimestamps, notifMsg.channelId, 5)) {
					this._broadcastToChannel(notifMsg.channelId, notifMsg);
				}
			}
		});

		agent.on("close", () => {
			const session = this.sessions.get(hostId);
			const host = this.metaDal.getHost(hostId);
			this.agents.delete(hostId);

			if (!session) return;

			if (agent instanceof NextermAgent) {
				// Daemon agent: attempt reconnect (daemon may still be alive)
				this._updateSessionStatus(hostId, session.id, "disconnected");
				this._reconnectDaemon(hostId, session.id).catch(() => {
					this._closeSession(hostId, session.id);
				});
				return;
			}

			if (host?.type === "ssh") {
				// SSH: attempt reconnect with exponential backoff
				this._updateSessionStatus(hostId, session.id, "disconnected");
				this._scheduleReconnect(hostId, session.id, 0, Date.now());
			} else {
				// Local: warm restart (respawn agent + PTYs)
				this._warmRestartLocal(hostId, session.id).catch(() => {
					this._closeSession(hostId, session.id);
				});
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
		this._spawnChannelsForHost(
			hostId,
			agent,
			(channelId, ch) => {
				if (ch.clients.size > 0) {
					this._updateChannelStatus(channelId, sessionId, "live");
				}
				this.scheduler.trackChannel(channelId);
				this.chunker.trackChannel(channelId);
			},
			(channelId, ch) => {
				this._updateChannelStatus(channelId, ch.sessionId, "dead");
			},
		);
	}

	/**
	 * Send SPAWN messages for every alive channel belonging to a host.
	 * Extracted from _reAttachChannels and _warmRestartLocal to eliminate duplication.
	 * The returned promise resolves once ALL SPAWN_OK/SPAWN_ERR responses (or timeouts) have fired.
	 */
	private _spawnChannelsForHost(
		hostId: string,
		agent: AgentConnection,
		onSpawnOk: (channelId: string, ch: ChannelState) => void,
		onSpawnErr: (channelId: string, ch: ChannelState) => void,
	): Promise<void> {
		let pending = 0;
		let resolve: (() => void) | undefined;
		const promise = new Promise<void>((r) => {
			resolve = r;
		});

		const settle = (): void => {
			pending--;
			if (pending === 0) resolve?.();
		};

		for (const [channelId, ch] of this.channels.entries()) {
			if (ch.hostId !== hostId || ch.status === "dead") continue;

			pending++;
			const requestId = generateId();
			agent.send({
				type: "SPAWN",
				requestId,
				channelId,
				shell: ch.shell,
				...(ch.args !== undefined && ch.args.length > 0 && { args: ch.args }),
				cwd: ch.cwd ?? process.env.HOME ?? process.env.USERPROFILE ?? "/",
				env: {},
				cols: ch.cols,
				rows: ch.rows,
			});

			const timeout = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				console.warn(
					`[session-manager] SPAWN timeout for channel ${channelId} (request ${requestId})`,
				);
				onSpawnErr(channelId, ch);
				settle();
			}, SPAWN_TIMEOUT_MS);

			this.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				clearTimeout(timeout);
				this.pendingRequests.delete(requestId);
				if (incoming.type === "SPAWN_OK") {
					onSpawnOk(channelId, ch);
				} else {
					onSpawnErr(channelId, ch);
				}
				settle();
			});
		}

		// No channels to spawn — resolve immediately
		if (pending === 0) resolve?.();

		return promise;
	}

	private async _attachDaemon(hostId: string, sessionId: string): Promise<NextermAgent> {
		const socketPath = getSocketPath(this.agentConfig.socketPath);
		const agent = await connectOrLaunch(socketPath, this.agentConfig);

		this._wireAgentEvents(hostId, sessionId, agent);

		const states = await agent.waitForChannelState();
		this._reconcileChannelState(hostId, states);

		this.agents.set(hostId, agent);
		this._updateSessionStatus(hostId, sessionId, "active");

		return agent;
	}

	/**
	 * Connect to (or launch) a local agent daemon.
	 * Returns a NextermAgent that's ready to receive commands.
	 * Performs channel state reconciliation after connecting.
	 */
	private async _connectDaemonAgent(hostId: string, sessionId: string): Promise<NextermAgent> {
		return this._attachDaemon(hostId, sessionId);
	}

	/**
	 * Reconcile hub's channel tracking with agent's reported channel state.
	 * Called after daemon connect/reconnect to sync which channels are alive/dead.
	 */
	private _reconcileChannelState(hostId: string, states: AgentChannelStateMessage[]): void {
		const reportedIds = new Set(states.filter((s) => s.alive).map((s) => s.channelId));

		for (const [channelId, channelState] of this.channels) {
			if (channelState.hostId !== hostId) continue;

			const session = this.sessions.get(hostId);
			if (!session || channelState.sessionId !== session.id) continue;

			if (reportedIds.has(channelId)) {
				// Agent says alive — mark live if currently orphan
				if (channelState.status === "orphan") {
					this._updateChannelStatus(channelId, session.id, "live");
				}
			} else {
				// Agent doesn't know about this channel — mark dead
				if (channelState.status !== "dead") {
					this._updateChannelStatus(channelId, session.id, "dead");
				}
			}
		}
	}

	/**
	 * Attempt to reconnect to a daemon agent after disconnect.
	 * If the daemon is still running, reconnect. If not, connectOrLaunch will spawn a new one.
	 */
	private async _reconnectDaemon(hostId: string, sessionId: string): Promise<void> {
		await this._attachDaemon(hostId, sessionId);
	}

	/**
	 * Warm restart for local agent: respawn the agent process and re-create
	 * PTYs under the SAME channel IDs so clients can reattach seamlessly.
	 */
	private async _warmRestartLocal(hostId: string, sessionId: string): Promise<void> {
		// Crash-loop protection: max 3 restarts in 60s
		const now = Date.now();
		const tracking = this.restartTracking.get(hostId) ?? { count: 0, windowStart: now };
		if (now - tracking.windowStart > 60_000) {
			// Reset window
			tracking.count = 0;
			tracking.windowStart = now;
		}
		tracking.count++;
		this.restartTracking.set(hostId, tracking);

		if (tracking.count > 3) {
			this._closeSession(hostId, sessionId);
			return;
		}

		const agent = new LocalAgent(resolveAgentPath());
		try {
			await agent.start();
		} catch {
			this._closeSession(hostId, sessionId);
			return;
		}

		this._wireAgentEvents(hostId, sessionId, agent);
		this.agents.set(hostId, agent);
		this._updateSessionStatus(hostId, sessionId, "active");

		// Re-spawn PTYs for each orphan channel, using the SAME channel ID
		await this._spawnChannelsForHost(
			hostId,
			agent,
			(channelId) => {
				this.scheduler.trackChannel(channelId);
				this.chunker.trackChannel(channelId);
			},
			(channelId, ch) => {
				this._updateChannelStatus(channelId, ch.sessionId, "dead");
			},
		);
	}

	/**
	 * Attempt to transparently respawn a dead channel under the same ID.
	 * Spawns a new PTY reusing deadChannelId, loads old spool snapshot,
	 * and sends ATTACH_OK. Returns true on success, false if not possible.
	 */
	private async _respawnDeadChannel(
		deadChannelId: string,
		client: WsClient,
		clientId: string,
	): Promise<boolean> {
		// 1. Look up dead channel in DB
		const info = this.metaDal.getChannelWithHost(deadChannelId);
		if (!info) return false;
		const { channel: deadChannel, hostId } = info;

		// 2. Find active session + agent
		const sessionEntry = this.sessions.get(hostId);
		if (!sessionEntry || sessionEntry.status !== "active") return false;
		const agent = this.agents.get(hostId);
		if (!agent?.connected) return false;

		// 3. Send SPAWN to agent reusing the same channel ID
		const requestId = generateId();
		const shell = deadChannel.shell ?? process.env.SHELL ?? "/bin/sh";
		const args = deadChannel.args ?? [];
		const cwd = deadChannel.cwd ?? process.env.HOME ?? "/";
		const cols = deadChannel.cols;
		const rows = deadChannel.rows;
		const agentSpawn: AgentSpawnMessage = {
			type: "SPAWN",
			requestId,
			channelId: deadChannelId,
			shell,
			...(args.length > 0 && { args }),
			cwd,
			env: {},
			cols,
			rows,
		};
		agent.send(agentSpawn);

		// 4. Wait for SPAWN_OK
		const spawnOk = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(requestId);
				resolve(false);
			}, SPAWN_TIMEOUT_MS);

			this.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				if (incoming.type === "SPAWN_OK") {
					clearTimeout(timer);
					this.pendingRequests.delete(requestId);
					resolve(true);
				} else if (incoming.type === "SPAWN_ERR") {
					clearTimeout(timer);
					this.pendingRequests.delete(requestId);
					resolve(false);
				}
			});
		});

		if (!spawnOk) return false;

		// 5. Update existing channel — no new channel created, same ID reused
		this.metaDal.updateChannelStatus(deadChannelId, "live");

		this.channels.set(deadChannelId, {
			sessionId: sessionEntry.id,
			hostId,
			status: "live",
			clients: new Set([clientId]),
			shell,
			...(args.length > 0 && { args }),
			cwd,
			cols,
			rows,
			...(deadChannel.directProcess && { directProcess: true }),
			dynamicTitle: null,
			processTitle: null,
			displayTitle: DEFAULT_CHANNEL_NAME,
		});

		this.scheduler.trackChannel(deadChannelId);
		this.chunker.trackChannel(deadChannelId);
		client.attachedChannels.add(deadChannelId);

		// 6. Broadcast CHANNEL_STATE for the same channel ID
		const channelStateMsg: ChannelStateMessage = {
			type: "CHANNEL_STATE",
			channelId: deadChannelId,
			sessionId: sessionEntry.id,
			status: "live",
		};
		this._broadcastToAllClients(channelStateMsg);

		// 7. Load snapshot from spool (same channel ID — no change needed)
		const { snapshot, tail } = this._buildAttachPayload(deadChannelId);

		// 8. Send ATTACH_OK with same channel ID (no respawnedFrom needed)
		// Note: dynamic_title is intentionally omitted here — fresh PTY has no title yet
		const attachOk: UiAttachOkMessage = {
			type: "ATTACH_OK",
			channelId: deadChannelId,
			snapshot,
			tail,
			writeLockHolder: this._getWriteLockHolder?.(deadChannelId) ?? null,
			cached: false,
		};
		client.send(attachOk);

		return true;
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
			this.chunker.untrackChannel(channelId);
		}
		this._updateSessionStatus(hostId, sessionId, "closed");
		this.sessions.delete(hostId);
	}

	/**
	 * Handle TITLE_CHANGE from agent: debounce DB writes (100ms, last-write-wins)
	 * and forward to connected UI clients immediately.
	 */

	/**
	 * Resolve the display title for a channel using the configured title source.
	 * Updates state.displayTitle in place and returns the resolved string.
	 * Returns DEFAULT_CHANNEL_NAME if the channel is not tracked.
	 */
	private _resolveDisplayTitle(channelId: string): string {
		const state = this.channels.get(channelId);
		if (!state) return DEFAULT_CHANNEL_NAME;

		const titleConfig = this._configResolver?.uiConfig.title ?? {};
		const source = titleConfig.source ?? "dynamic";
		const staticTitle = titleConfig.staticTitle ?? "";

		// Custom title (F2 rename) from DB — always wins
		const dbChannel = this.metaDal.getChannel(channelId);
		const customTitle = dbChannel?.title ?? null;

		const resolved = resolveChannelDisplayName(
			{ title: customTitle, dynamicTitle: state.dynamicTitle, processTitle: state.processTitle },
			source,
			staticTitle,
		);
		state.displayTitle = resolved;
		return resolved;
	}

	private _handleTitleChange(msg: AgentTitleChangeMessage): void {
		const channel = this.channels.get(msg.channelId);
		if (!channel) {
			console.warn(`[session-manager] TITLE_CHANGE for unknown channel ${msg.channelId} — ignored`);
			return;
		}

		// Update in-memory state before resolving displayTitle
		channel.dynamicTitle = msg.title;

		// Resolve displayTitle and broadcast enriched message to UI clients
		const displayTitle = this._resolveDisplayTitle(msg.channelId);
		this._broadcastToChannel(msg.channelId, { ...msg, displayTitle });

		// Debounce DB writes
		this._clearTitleDebounce(msg.channelId);
		this.titleDebounceTimers.set(
			msg.channelId,
			setTimeout(() => {
				this.titleDebounceTimers.delete(msg.channelId);
				this.metaDal.updateDynamicTitle(msg.channelId, msg.title);
			}, TITLE_DEBOUNCE_MS),
		);
	}

	private _clearTitleDebounce(channelId: string): void {
		const timer = this.titleDebounceTimers.get(channelId);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.titleDebounceTimers.delete(channelId);
		}
	}

	private _clearProcessTitleDebounce(channelId: string): void {
		const timer = this.processTitleDebounceTimers.get(channelId);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.processTitleDebounceTimers.delete(channelId);
		}
	}

	/**
	 * Handle PROCESS_TITLE from agent: debounce DB writes (100ms, last-write-wins)
	 * and forward to connected UI clients immediately.
	 */
	private _handleProcessTitle(msg: AgentProcessTitleMessage): void {
		const channel = this.channels.get(msg.channelId);
		if (!channel) {
			console.warn(
				`[session-manager] PROCESS_TITLE for unknown channel ${msg.channelId} — ignored`,
			);
			return;
		}

		// Update in-memory state before resolving displayTitle
		channel.processTitle = msg.title;

		// Resolve displayTitle and broadcast enriched message to UI clients
		const displayTitle = this._resolveDisplayTitle(msg.channelId);
		this._broadcastToChannel(msg.channelId, { ...msg, displayTitle });

		// Debounce DB writes
		this._clearProcessTitleDebounce(msg.channelId);
		this.processTitleDebounceTimers.set(
			msg.channelId,
			setTimeout(() => {
				this.processTitleDebounceTimers.delete(msg.channelId);
				this.metaDal.updateProcessTitle(msg.channelId, msg.title);
			}, TITLE_DEBOUNCE_MS),
		);
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

	/**
	 * Sliding-window rate limiter: returns true if the event is allowed.
	 * Keeps at most `maxPerSecond` timestamps within the last 1000ms per channel.
	 */
	private _rateLimitCheck(
		store: Map<string, number[]>,
		channelId: string,
		maxPerSecond: number,
	): boolean {
		const now = Date.now();
		const cutoff = now - 1000;
		let timestamps = store.get(channelId);
		if (!timestamps) {
			timestamps = [];
			store.set(channelId, timestamps);
		}
		// Evict entries older than 1 second
		while (timestamps.length > 0 && (timestamps[0] ?? 0) < cutoff) {
			timestamps.shift();
		}
		if (timestamps.length >= maxPerSecond) {
			return false;
		}
		timestamps.push(now);
		return true;
	}

	/**
	 * Build the snapshot + tail payload for ATTACH_OK from spool.db.
	 * Used by handleAttach (cached path, agent-error fallback) and _respawnDeadChannel.
	 */
	private _buildAttachPayload(channelId: string): {
		snapshot: UiAttachOkMessage["snapshot"];
		tail: Uint8Array[];
	} {
		let snapshot: UiAttachOkMessage["snapshot"] = null;
		let tail: Uint8Array[] = [];

		const snapshotChunk = this.spoolDal.getLatestSnapshot(channelId);
		if (snapshotChunk) {
			try {
				snapshot = JSON.parse(
					snapshotChunk.dataBlob.toString("utf8"),
				) as UiAttachOkMessage["snapshot"];
			} catch {
				snapshot = null;
			}
			const tailChunks = this.spoolDal.getChunksByChannel(channelId, {
				kind: "output",
				afterSeq: snapshotChunk.seq,
			});
			tail = tailChunks.map((c) => new Uint8Array(c.dataBlob));
		}

		return { snapshot, tail };
	}

	/**
	 * Persist a snapshot to spool.db with correct seq coordination.
	 * Flushes the chunker first, computes next seq, inserts the snapshot,
	 * bumps the chunker past it, and updates the cache index.
	 * Returns the assigned chunkId.
	 */
	private _storeSnapshot(channelId: string, snapshot: unknown, agentLastSeq: number): string {
		const snapshotJson = JSON.stringify(snapshot);
		const dataBlob = Buffer.from(snapshotJson);
		this.chunker.flush(channelId);
		const maxSeq = this.spoolDal.getMaxSeq(channelId);
		const snapshotSeq = Math.max(maxSeq, agentLastSeq) + 1;
		const chunkId = this.spoolDal.insertChunk({
			channelId,
			seq: snapshotSeq,
			kind: "snapshot",
			dataBlob,
			uncompressedLen: dataBlob.length,
		});
		this.chunker.bumpSeq(channelId, snapshotSeq + 1);
		this.metaDal.updateCacheIndex(channelId, chunkId, snapshotSeq - 1);
		return chunkId;
	}

	/**
	 * Build an AuthPromptFn that sends AUTH_PROMPT to the given client and
	 * registers the response in pendingAuthPrompts.
	 * No server-side timeout — the client dismisses the dialog when ready.
	 * Extracted to avoid duplicating this pattern in handleSpawn and handleTestConnect.
	 */
	private _buildPromptAuth(client: WsClient): AuthPromptFn {
		return async (hostId, promptType, message) => {
			const promptMsg: AuthPromptMessage = { type: "AUTH_PROMPT", hostId, promptType, message };
			client.send(promptMsg);
			// No server-side timeout — the user dismisses the dialog when ready
			return new Promise<string | null>((resolve) => {
				this.pendingAuthPrompts.set(hostId, { resolve, timer: null, clientId: client.id });
			});
		};
	}

	/**
	 * Handle a TEST_CONNECT message: lightweight SSH test with AUTH_PROMPT support.
	 * Does NOT spawn an agent — just tests ssh2 connectivity (reach "ready" event).
	 */
	async handleTestConnect(clientId: string, msg: TestConnectMessage): Promise<void> {
		const client = this.clients.get(clientId);
		if (!client) return;

		const promptAuth = this._buildPromptAuth(client);

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

		// Build connect config using shared utility (throws on config errors or cancellation)
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

		// Connect and wait for ready/error
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
