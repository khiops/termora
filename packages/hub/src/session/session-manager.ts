/**
 * SessionManager — coordinator for hub session management.
 *
 * Owns all runtime state (sessions, channels, agents, clients maps) via a
 * SharedSessionContext and delegates work to four focused sub-managers:
 *
 *   StateBroadcaster        — WS state sync, title management, rate-limiting
 *   ChannelLifecycleManager — spawn, restart, destroy, respawn, spool
 *   SshConnectionManager    — auth prompts, host-key verify, reconnect, test-connect
 *   AgentConnectionManager  — agent wiring, daemon attach, warm restart, startup
 *
 * The public API of SessionManager is unchanged — all callers (ws-handler, REST routes)
 * continue to talk to SessionManager exclusively.
 */

import type {
	AgentAttachMessage,
	AgentAttachOkMessage,
	AgentLogMessage,
	AgentSpawnMessage,
	ErrorMessage,
	InputMessage,
	ProtocolMessage,
	ResizeMessage,
	StateSyncMessage,
	TestConnectMessage,
	UiAttachOkMessage,
	UiSpawnMessage,
} from "@nexterm/shared";
import type { AgentConfig, ElevationMethod } from "@nexterm/shared";
import { DEFAULT_AGENT_CONFIG, generateId, validateCustomCommand } from "@nexterm/shared";
import type { ConfigResolver, GcConfig } from "../config.js";
import type { HubLogger } from "../logging/hub-logger.js";
import type { LoggerRegistry } from "../logging/index.js";
import type { DatabaseManager } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";
import { SpoolDAL } from "../storage/spool.js";
import { AgentConnectionManager } from "./agent-connection-manager.js";
import { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import { OutputChunker } from "./output-chunker.js";
import type { SharedSessionContext } from "./session-context.js";
import { SnapshotScheduler } from "./snapshot-scheduler.js";
import { SpoolGarbageCollector } from "./spool-gc.js";
import { SshAgent } from "./ssh-agent.js";
import { SshConnectionManager } from "./ssh-connection-manager.js";
import { StateBroadcaster } from "./state-broadcaster.js";

export interface WsClient {
	id: string;
	send: (msg: ProtocolMessage) => void;
	attachedChannels: Set<string>;
}

const ATTACH_TIMEOUT_MS = 5_000;

export class SessionManager {
	// ─── Shared runtime state ─────────────────────────────────────────────────
	private readonly ctx: SharedSessionContext;

	// ─── Sub-managers ─────────────────────────────────────────────────────────
	private readonly broadcaster: StateBroadcaster;
	private readonly lifecycle: ChannelLifecycleManager;
	private readonly sshMgr: SshConnectionManager;
	private readonly agentMgr: AgentConnectionManager;

	// ─── Spool GC (owned by coordinator) ─────────────────────────────────────
	private readonly gc: SpoolGarbageCollector;

	constructor(
		private dbManager: DatabaseManager,
		gcConfig?: GcConfig,
		agentConfig?: AgentConfig,
		configResolver?: ConfigResolver,
		hubLogger?: HubLogger,
		loggerRegistry?: LoggerRegistry,
		logsDir?: string,
	) {
		const metaDal = new MetaDAL(dbManager.meta);
		const spoolDal = new SpoolDAL(dbManager.spool);
		const resolvedAgentConfig: AgentConfig = agentConfig ?? { ...DEFAULT_AGENT_CONFIG };

		const scheduler = new SnapshotScheduler((channelId) => {
			const ch = ctx.channels.get(channelId);
			return ch ? ctx.agents.get(ch.hostId) : undefined;
		});
		const chunker = new OutputChunker(spoolDal);

		// Build the shared context — all sub-managers share these Maps
		const ctx: SharedSessionContext = {
			agents: new Map(),
			sessions: new Map(),
			channels: new Map(),
			clients: new Map(),
			reconnectTimers: new Map(),
			restartTracking: new Map(),
			pendingRequests: new Map(),
			pendingAuthPrompts: new Map(),
			pendingHostVerify: new Map(),
			trustedOnceFingerprints: new Map(),
			trustedAgentSha256: new Map(),
			pendingAgentVerify: new Map(),
			bellTimestamps: new Map(),
			notificationTimestamps: new Map(),
			elevationCache: new Map(),
			agentCapabilities: new Map(),
			titleDebounceTimers: new Map(),
			processTitleDebounceTimers: new Map(),
			getWriteLockHolder: null,
			metaDal,
			spoolDal,
			scheduler,
			chunker,
			agentConfig: resolvedAgentConfig,
			configResolver: configResolver ?? null,
			loggerRegistry: loggerRegistry ?? null,
			hubLogger: hubLogger ?? null,
			primaryToken: null,
		};
		this.ctx = ctx;

		this.broadcaster = new StateBroadcaster(ctx);
		this.lifecycle = new ChannelLifecycleManager(ctx, this.broadcaster);
		this.agentMgr = new AgentConnectionManager(ctx, this.broadcaster, this.lifecycle);
		this.sshMgr = new SshConnectionManager(ctx, this.broadcaster, this.lifecycle, this.agentMgr);
		// Break the circular reference: AgentConnectionManager needs SshConnectionManager
		this.agentMgr.sshMgr = this.sshMgr;

		this.gc = new SpoolGarbageCollector(spoolDal, metaDal, gcConfig);
		this.gc.start();
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────────

	setGetWriteLockHolder(fn: (channelId: string) => string | null): void {
		this.ctx.getWriteLockHolder = fn;
	}

	async ensureLocalHost(): Promise<string> {
		return this.agentMgr.ensureLocalHost();
	}

	async startup(): Promise<void> {
		return this.agentMgr.startup();
	}

	async shutdown(): Promise<void> {
		for (const timer of this.ctx.reconnectTimers.values()) clearTimeout(timer);
		this.ctx.reconnectTimers.clear();
		for (const timer of this.ctx.titleDebounceTimers.values()) clearTimeout(timer);
		this.ctx.titleDebounceTimers.clear();
		for (const timer of this.ctx.processTitleDebounceTimers.values()) clearTimeout(timer);
		this.ctx.processTitleDebounceTimers.clear();
		for (const [hostId, pending] of this.ctx.pendingAuthPrompts) {
			if (pending.timer !== null) clearTimeout(pending.timer);
			this.ctx.pendingAuthPrompts.delete(hostId);
			pending.resolve(null);
		}
		this.ctx.pendingAuthPrompts.clear();
		this.ctx.elevationCache.clear();
		this.ctx.agentCapabilities.clear();
		this.ctx.scheduler.shutdown();
		this.ctx.chunker.shutdown();
		this.gc.stop();
		for (const agent of this.ctx.agents.values()) agent.close();
		this.ctx.agents.clear();
		this.ctx.clients.clear();
		this.ctx.channels.clear();
		this.ctx.sessions.clear();
	}

	// ─── DAL accessors ────────────────────────────────────────────────────────

	setPrimaryToken(token: string): void {
		this.ctx.primaryToken = token;
	}

	getMetaDal(): MetaDAL {
		return this.ctx.metaDal;
	}

	getSpoolDal(): SpoolDAL {
		return this.ctx.spoolDal;
	}

	// ─── Client registry ──────────────────────────────────────────────────────

	addClient(client: WsClient): void {
		this.broadcaster.addClient(client);
	}

	removeClient(clientId: string): void {
		this.broadcaster.removeClient(clientId);
	}

	getClientsForChannel(channelId: string): WsClient[] {
		return this.broadcaster.getClientsForChannel(channelId);
	}

	// ─── State broadcast ──────────────────────────────────────────────────────

	getStateSnapshot(): StateSyncMessage {
		return this.broadcaster.getStateSnapshot();
	}

	notifyChannelRenamed(channelId: string): void {
		this.broadcaster.notifyChannelRenamed(channelId);
	}

	broadcastDisplayTitles(): void {
		this.broadcaster.broadcastDisplayTitles();
	}

	resolveDisplayTitle(channelId: string): string {
		return this.broadcaster.resolveDisplayTitle(channelId);
	}

	// ─── Channel operations ───────────────────────────────────────────────────

	destroyChannel(channelId: string): boolean {
		return this.lifecycle.destroyChannel(channelId);
	}

	async restartChannel(channelId: string, requestingClientId?: string): Promise<boolean> {
		return this.lifecycle.restartChannel(channelId, requestingClientId);
	}

	async closeSession(sessionId: string): Promise<void> {
		let hostId: string | undefined;
		for (const [hId, state] of this.ctx.sessions.entries()) {
			if (state.id === sessionId) {
				hostId = hId;
				break;
			}
		}

		if (!hostId) {
			this.ctx.metaDal.updateSessionStatus(sessionId, "closed");
			return;
		}

		const agent = this.ctx.agents.get(hostId);
		if (agent) {
			agent.close();
			this.ctx.agents.delete(hostId);
		}

		this.lifecycle.closeSession(hostId, sessionId);
	}

	// ─── WS message handlers ──────────────────────────────────────────────────

	async handleSpawn(clientId: string, msg: UiSpawnMessage): Promise<string | null> {
		this.ctx.hubLogger?.log("debug", "handleSpawn: start", { clientId, hostId: msg.hostId });
		const client = this.ctx.clients.get(clientId);
		if (!client) {
			this.ctx.hubLogger?.log("debug", "handleSpawn: client not found", { clientId });
			return null;
		}

		const hostId = await this.agentMgr.resolveHostId(msg.hostId);
		this.ctx.hubLogger?.log("debug", "handleSpawn: resolvedHostId", { hostId });
		const host = this.ctx.metaDal.getHost(hostId);
		if (!host) {
			this.ctx.hubLogger?.log("warn", "handleSpawn: host not found", { hostId });
			const errorMsg: ErrorMessage = {
				type: "ERROR",
				code: "HOST_NOT_FOUND",
				message: `Host ${hostId} not found`,
			};
			client.send(errorMsg);
			return null;
		}

		this.ctx.hubLogger?.log("debug", "handleSpawn: host found", {
			hostId,
			type: host.type,
			label: host.label,
		});
		const session = await this.agentMgr.getOrCreateSession(hostId, host.type === "ssh");
		this.ctx.hubLogger?.log("debug", "handleSpawn: session", {
			sessionId: session.id,
			status: session.status,
		});

		let agent = this.ctx.agents.get(hostId);
		this.ctx.hubLogger?.log("debug", "handleSpawn: existing agent", {
			connected: agent?.connected ?? false,
		});
		if (!agent?.connected) {
			if (host.type === "ssh") {
				const promptAuth = this.sshMgr.buildPromptAuth(client);
				const sshAgent = new SshAgent(host, promptAuth);

				const storedFingerprint = this.ctx.metaDal.getHostFingerprint(hostId);
				const sshHostname = host.sshHost?.includes("@")
					? (host.sshHost.split("@")[1] ?? host.sshHost)
					: (host.sshHost ?? host.label);
				const sshPort = host.sshPort ?? 22;
				const hostKey = `${sshHostname}:${sshPort}`;
				const sessionTrustedFp = this.ctx.trustedOnceFingerprints.get(hostKey);

				try {
					await sshAgent.start(storedFingerprint, sessionTrustedFp);
				} catch (err) {
					const kv = sshAgent.lastKeyVerification;
					if (kv.tofu || kv.mismatch) {
						const action = await this.sshMgr.promptHostKeyVerify(
							client,
							hostId,
							host.sshHost ?? host.label,
							kv.mismatch ? (storedFingerprint ?? "") : "",
							kv.capturedFingerprint,
							kv.tofu,
						);
						if (action === "reject") {
							this.broadcaster.updateSessionStatus(hostId, session.id, "closed");
							client.send({
								type: "ERROR",
								code: "SSH_HOST_KEY_REJECTED",
								message: "SSH host key rejected by user",
							} satisfies ErrorMessage);
							return null;
						}
						const retryFp = kv.capturedFingerprint;
						if (action === "trust_permanent") {
							this.ctx.metaDal.updateHostFingerprint(hostId, retryFp);
						} else {
							this.ctx.trustedOnceFingerprints.set(hostKey, retryFp);
						}
						const retryAgent = new SshAgent(host, promptAuth);
						try {
							await retryAgent.start(
								action === "trust_permanent" ? retryFp : null,
								action === "trust_once" ? retryFp : undefined,
							);
						} catch (retryErr) {
							this.broadcaster.updateSessionStatus(hostId, session.id, "closed");
							client.send({
								type: "ERROR",
								code: "SSH_CONNECT_FAILED",
								message: retryErr instanceof Error ? retryErr.message : "SSH connection failed",
							} satisfies ErrorMessage);
							return null;
						}
						this.broadcaster.updateSessionStatus(hostId, session.id, "active");
						this.agentMgr.wireAgentEvents(hostId, session.id, retryAgent);
						this.ctx.agents.set(hostId, retryAgent);
						agent = retryAgent;
					} else {
						this.broadcaster.updateSessionStatus(hostId, session.id, "closed");
						client.send({
							type: "ERROR",
							code: "SSH_CONNECT_FAILED",
							message: err instanceof Error ? err.message : "SSH connection failed",
						} satisfies ErrorMessage);
						return null;
					}
				}

				if (agent == null) {
					// First connection succeeded without TOFU/mismatch prompt
					this.broadcaster.updateSessionStatus(hostId, session.id, "active");
					this.agentMgr.wireAgentEvents(hostId, session.id, sshAgent);
					this.ctx.agents.set(hostId, sshAgent);
					agent = sshAgent;
				}
			} else {
				this.ctx.hubLogger?.log("debug", "handleSpawn: local host — connecting to daemon agent", {
					hostId,
				});
				agent = await this.agentMgr.connectDaemonAgent(hostId, session.id);
				this.ctx.hubLogger?.log("debug", "handleSpawn: daemon agent connected", { hostId });
			}
		}

		this.ctx.hubLogger?.log("debug", "handleSpawn: agent ready, building SPAWN message", {
			hostId,
		});
		const requestId = generateId();
		const cols = msg.cols ?? 80;
		const rows = msg.rows ?? 24;

		// ── Launch profile resolution ─────────────────────────────────────────
		let resolvedShell = msg.shell ?? undefined;
		let resolvedArgs = msg.args ?? [];
		let resolvedCwd = msg.cwd ?? undefined;
		let resolvedEnv: Record<string, string> = msg.env ?? {};
		let resolvedDirectProcess = msg.directProcess ?? false;
		let resolvedElevated = msg.elevated ?? false;
		let resolvedLaunchProfileId: string | undefined;

		if (msg.launchProfileId) {
			const profile = this.ctx.metaDal.getLaunchProfile(msg.launchProfileId);
			if (profile) {
				resolvedShell = msg.shell ?? profile.shell;
				resolvedArgs = msg.args ?? profile.args ?? [];
				resolvedCwd = msg.cwd ?? profile.cwd ?? resolvedCwd;
				resolvedEnv = { ...(profile.env ?? {}), ...(msg.env ?? {}) };
				resolvedDirectProcess = msg.directProcess ?? profile.mode === "process";
				resolvedElevated = msg.elevated ?? profile.elevated;
				resolvedLaunchProfileId = profile.id;
			}
		}

		// ── First-profile fallback: if no shell resolved yet, use sort_order=0 profile ──
		if (resolvedShell === undefined) {
			const firstProfile = this.ctx.metaDal.listLaunchProfiles(1)[0];
			if (firstProfile !== undefined) {
				resolvedShell = firstProfile.shell;
				if (resolvedArgs.length === 0 && firstProfile.args) {
					resolvedArgs = firstProfile.args;
				}
			}
		}

		// ── Elevation checks ──────────────────────────────────────────────────
		if (resolvedElevated) {
			if (host.type === "ssh") {
				this.ctx.hubLogger?.log(
					"warn",
					"ERR-04: elevation not supported over SSH, spawning without elevation",
					{ hostId },
				);
				resolvedElevated = false;
			}
		}

		if (resolvedElevated) {
			const caps = this.ctx.agentCapabilities.get(hostId) ?? [];
			if (!caps.includes("launch-profiles")) {
				this.ctx.hubLogger?.log(
					"warn",
					"ERR-05: agent does not advertise launch-profiles capability, spawning without elevation",
					{ hostId },
				);
				resolvedElevated = false;
			}
		}

		// ── Resolve terminal profile for env mode ─────────────────────────────
		const terminalProfile = this.ctx.configResolver
			? this.ctx.configResolver.resolve(hostId)
			: null;
		const resolvedEnvMode = terminalProfile?.envMode ?? "inherit";

		// ── Build base spawn message ──────────────────────────────────────────
		const baseSpawnMsg: AgentSpawnMessage = {
			type: "SPAWN",
			requestId,
			...(resolvedShell !== undefined ? { shell: resolvedShell } : {}),
			...(resolvedArgs.length > 0 && { args: resolvedArgs }),
			...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
			env: resolvedEnv,
			cols,
			rows,
			...(resolvedDirectProcess && { directProcess: true }),
			envMode: resolvedEnvMode,
		};

		// ── Elevated spawn ────────────────────────────────────────────────────
		if (resolvedElevated) {
			const rawMethod = this.ctx.configResolver
				? this.ctx.configResolver.resolveElevationMethod(host.elevationMethod)
				: process.platform === "win32"
					? "gsudo"
					: "sudo";
			const elevCfg = this._resolveElevationConfig(host.customCommand, rawMethod);
			if ("validationError" in elevCfg) {
				client.send(elevCfg.validationError);
				return null;
			}
			const { method, customCommand } = elevCfg;

			const agentSpawn: AgentSpawnMessage = {
				...baseSpawnMsg,
				elevated: true,
				elevationMethod: method,
				...(customCommand !== undefined && { customCommand }),
			};

			const cacheKey = `${hostId}:${clientId}`;
			const cached = this.ctx.elevationCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				agentSpawn.elevationSecret = cached.secret;
				return (
					await this.lifecycle.sendSpawnAndWait({
						agent,
						spawnMsg: agentSpawn,
						clientId,
						hostId,
						session,
						client,
						resolvedShell,
						resolvedArgs,
						resolvedCwd,
						resolvedDirectProcess,
						resolvedLaunchProfileId,
						cols,
						rows,
						suppressClientError: false,
						resolvedElevated: true,
						resolvedElevationMethod: method,
					})
				).channelId;
			}

			// Cache miss — try passwordless first
			const firstResult = await this.lifecycle.sendSpawnAndWait({
				agent,
				spawnMsg: agentSpawn,
				clientId,
				hostId,
				session,
				client,
				resolvedShell,
				resolvedArgs,
				resolvedCwd,
				resolvedDirectProcess,
				resolvedLaunchProfileId,
				cols,
				rows,
				suppressClientError: true,
				resolvedElevated: true,
				resolvedElevationMethod: method,
			});

			if (firstResult.channelId !== null || firstResult.errCode !== "ELEVATION_PASSWORD_REQUIRED") {
				return firstResult.channelId;
			}

			// Passwordless failed — prompt user
			const promptFn = this.sshMgr.buildPromptAuth(client);
			const hostname = host.sshHost ?? host.label ?? hostId;
			const secret = await promptFn(
				hostId,
				"elevation",
				`Enter password for elevated shell on ${hostname}`,
			);
			if (secret === null) {
				client.send({
					type: "ERROR",
					code: "ELEVATION_CANCELLED",
					message: "Elevation cancelled by user",
				});
				return null;
			}

			this.ctx.elevationCache.set(cacheKey, {
				secret,
				expiresAt: Date.now() + 300_000,
			});

			const retrySpawn: AgentSpawnMessage = {
				...agentSpawn,
				requestId: generateId(),
				elevationSecret: secret,
			};
			return (
				await this.lifecycle.sendSpawnAndWait({
					agent,
					spawnMsg: retrySpawn,
					clientId,
					hostId,
					session,
					client,
					resolvedShell,
					resolvedArgs,
					resolvedCwd,
					resolvedDirectProcess,
					resolvedLaunchProfileId,
					cols,
					rows,
					suppressClientError: false,
					resolvedElevated: true,
					resolvedElevationMethod: method,
				})
			).channelId;
		}

		// ── Non-elevated spawn ─────────────────────────────────────────────────
		this.ctx.hubLogger?.log("debug", "handleSpawn: sending non-elevated SPAWN", {
			requestId: baseSpawnMsg.requestId,
			shell: baseSpawnMsg.shell,
		});
		const spawnResult = await this.lifecycle.sendSpawnAndWait({
			agent,
			spawnMsg: baseSpawnMsg,
			clientId,
			hostId,
			session,
			client,
			resolvedShell,
			resolvedArgs,
			resolvedCwd,
			resolvedDirectProcess,
			resolvedLaunchProfileId,
			cols,
			rows,
		});
		this.ctx.hubLogger?.log("debug", "handleSpawn: sendSpawnAndWait returned", {
			channelId: spawnResult.channelId,
			errCode: spawnResult.errCode,
		});
		return spawnResult.channelId;
	}

	async handleAttach(clientId: string, channelId: string): Promise<boolean> {
		const client = this.ctx.clients.get(clientId);
		if (!client) return false;

		const channel = this.ctx.channels.get(channelId);
		if (!channel) {
			const dbChannel = this.ctx.metaDal.getChannel(channelId);
			if (dbChannel?.status === "dead") {
				const respawned = await this.lifecycle.respawnDeadChannel(channelId, client, clientId);
				if (respawned) return true;
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

		if (wasOrphan) {
			this.broadcaster.updateChannelStatus(channelId, channel.sessionId, "live");
		}

		const agent = this.ctx.agents.get(channel.hostId);

		const dbChannelForTitle = this.ctx.metaDal.getChannel(channelId);
		const dynamicTitle = dbChannelForTitle?.dynamicTitle;
		const processTitle = dbChannelForTitle?.processTitle;

		if (dynamicTitle !== undefined && channel.dynamicTitle === null) {
			channel.dynamicTitle = dynamicTitle;
		}
		if (processTitle !== undefined && channel.processTitle === null) {
			channel.processTitle = processTitle;
		}

		const displayTitle = this.broadcaster.resolveDisplayTitle(channelId);

		if (!agent?.connected) {
			const { snapshot, tail } = this.lifecycle.buildAttachPayload(channelId);
			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot,
				tail,
				writeLockHolder: this.ctx.getWriteLockHolder?.(channelId) ?? null,
				cached: true,
				...(dynamicTitle !== undefined && { dynamicTitle }),
				...(processTitle !== undefined && { processTitle }),
				displayTitle,
			};
			client.send(attachOk);
			return true;
		}

		const agentAttach: AgentAttachMessage = { type: "ATTACH", channelId };
		agent.send(agentAttach);

		const pendingKey = `attach:${channelId}`;
		try {
			const agentResponse = await new Promise<AgentAttachOkMessage>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.ctx.pendingRequests.delete(pendingKey);
					reject(new Error("Agent ATTACH timeout"));
				}, ATTACH_TIMEOUT_MS);

				this.ctx.pendingRequests.set(pendingKey, (incoming: ProtocolMessage) => {
					if (incoming.type === "ATTACH_OK") {
						const attachOkMsg = incoming as AgentAttachOkMessage;
						clearTimeout(timer);
						this.ctx.pendingRequests.delete(pendingKey);
						resolve(attachOkMsg);
					} else if (incoming.type === "ERROR") {
						clearTimeout(timer);
						this.ctx.pendingRequests.delete(pendingKey);
						reject(new Error("Agent ATTACH error"));
					}
				});
			});

			this.lifecycle.storeSnapshot(channelId, agentResponse.snapshot, agentResponse.lastSeq);

			const tailChunks = this.ctx.spoolDal.getChunksByChannel(channelId, {
				kind: "output",
				afterSeq: agentResponse.lastSeq,
			});
			const tail = tailChunks.map((c) => new Uint8Array(c.dataBlob));

			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot: agentResponse.snapshot,
				tail,
				writeLockHolder: this.ctx.getWriteLockHolder?.(channelId) ?? null,
				cached: false,
				...(dynamicTitle !== undefined && { dynamicTitle }),
				...(processTitle !== undefined && { processTitle }),
				displayTitle,
			};
			client.send(attachOk);
		} catch {
			const { snapshot, tail } = this.lifecycle.buildAttachPayload(channelId);
			const attachOk: UiAttachOkMessage = {
				type: "ATTACH_OK",
				channelId,
				snapshot,
				tail,
				writeLockHolder: this.ctx.getWriteLockHolder?.(channelId) ?? null,
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
		this.broadcaster.detachClient(clientId, channelId);
	}

	handleInput(clientId: string, channelId: string, data: Uint8Array): void {
		const channel = this.ctx.channels.get(channelId);
		if (!channel) return;
		const agent = this.ctx.agents.get(channel.hostId);
		if (!agent) return;
		const inputMsg: InputMessage = { type: "INPUT", channelId, data };
		agent.send(inputMsg);
	}

	handleResize(clientId: string, channelId: string, cols: number, rows: number): void {
		const channel = this.ctx.channels.get(channelId);
		if (!channel) return;
		const agent = this.ctx.agents.get(channel.hostId);
		if (!agent) return;
		const resizeMsg: ResizeMessage = { type: "RESIZE", channelId, cols, rows };
		agent.send(resizeMsg);
		channel.cols = cols;
		channel.rows = rows;
		this.ctx.metaDal.updateChannelDimensions(channelId, cols, rows);
	}

	handleAuthPromptResponse(clientId: string, hostId: string, secret: string | null): void {
		this.sshMgr.handleAuthPromptResponse(clientId, hostId, secret);
	}

	handleHostVerifyResponse(
		promptId: string,
		action: "trust_permanent" | "trust_once" | "reject",
	): void {
		this.sshMgr.handleHostVerifyResponse(promptId, action);
	}

	async handleTestConnect(clientId: string, msg: TestConnectMessage): Promise<void> {
		return this.sshMgr.handleTestConnect(clientId, msg);
	}

	// ─── Test-surface accessors (delegating to ctx / sub-managers) ───────────
	// Tests access internal state via type-casts like:
	//   (sm as unknown as { agents: Map<…> }).agents
	// These getters make those casts resolve correctly without changing behaviour.

	get agents(): SharedSessionContext["agents"] {
		return this.ctx.agents;
	}

	get sessions(): SharedSessionContext["sessions"] {
		return this.ctx.sessions;
	}

	get channels(): SharedSessionContext["channels"] {
		return this.ctx.channels;
	}

	get restartTracking(): SharedSessionContext["restartTracking"] {
		return this.ctx.restartTracking;
	}

	get pendingRequests(): SharedSessionContext["pendingRequests"] {
		return this.ctx.pendingRequests;
	}

	get pendingAuthPrompts(): SharedSessionContext["pendingAuthPrompts"] {
		return this.ctx.pendingAuthPrompts;
	}

	get agentCapabilities(): SharedSessionContext["agentCapabilities"] {
		return this.ctx.agentCapabilities;
	}

	get elevationCache(): SharedSessionContext["elevationCache"] {
		return this.ctx.elevationCache;
	}

	/** Proxy used by tests that call sm._resolveDisplayTitle(channelId) */
	_resolveDisplayTitle(channelId: string): string {
		return this.broadcaster.resolveDisplayTitle(channelId);
	}

	/** Proxy used by tests that call sm._spawnChannelsForHost(...) */
	_spawnChannelsForHost(
		hostId: string,
		agent: unknown,
		onOk: (id: string, ch: unknown) => void,
		onErr: (id: string, ch: unknown) => void,
	): Promise<void> {
		return this.lifecycle.spawnChannelsForHost(
			hostId,
			agent as Parameters<typeof this.lifecycle.spawnChannelsForHost>[1],
			onOk as Parameters<typeof this.lifecycle.spawnChannelsForHost>[2],
			onErr as Parameters<typeof this.lifecycle.spawnChannelsForHost>[3],
		);
	}

	/** Proxy used by tests that call sm._warmRestartLocal(hostId, sessionId) */
	_warmRestartLocal(hostId: string, sessionId: string): Promise<void> {
		return this.agentMgr.warmRestartLocal(hostId, sessionId);
	}

	// ─── Internal: elevation config ───────────────────────────────────────────

	private _resolveElevationConfig(
		hostCustomCommand: string | null | undefined,
		method: ElevationMethod,
	):
		| { method: ElevationMethod; customCommand: string | undefined }
		| { validationError: ErrorMessage } {
		const customCommand =
			method === "custom" && this.ctx.configResolver
				? this.ctx.configResolver.resolveCustomCommand(hostCustomCommand)
				: undefined;

		if (customCommand !== undefined) {
			try {
				validateCustomCommand(customCommand);
			} catch (err) {
				const e = err as { code: string; message: string };
				return {
					validationError: {
						type: "ERROR",
						code: "INVALID_CUSTOM_COMMAND",
						message: e.message,
					},
				};
			}
		}

		return { method, customCommand };
	}
}
