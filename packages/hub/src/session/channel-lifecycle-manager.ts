/**
 * ChannelLifecycleManager — channel spawn, restart, destroy, respawn, and spool operations.
 * All channel state mutations go through StateBroadcaster for proper DB + WS sync.
 */

import type {
	AgentChannelStateMessage,
	AgentSpawnErrMessage,
	AgentSpawnMessage,
	AgentSpawnOkMessage,
	AuthPromptMessage,
	ChannelCreatedMessage,
	ChannelStateMessage,
	DestroyMessage,
	ErrorMessage,
	ProtocolMessage,
	UiAttachOkMessage,
	UiSpawnOkMessage,
} from "@termora/shared";
import { DEFAULT_CHANNEL_NAME, generateId, validateCustomCommand } from "@termora/shared";
import type { ElevationMethod } from "@termora/shared";
import type { AgentConnection } from "./agent-connection.js";
import type { ChannelState, SharedSessionContext } from "./session-context.js";
import type { WsClient } from "./session-manager.js";
import type { StateBroadcaster } from "./state-broadcaster.js";

const SPAWN_TIMEOUT_MS = 10_000;

/** Options for _sendSpawnAndWait */
export interface SendSpawnOpts {
	agent: AgentConnection;
	spawnMsg: AgentSpawnMessage;
	clientId: string;
	hostId: string;
	session: { id: string };
	client: WsClient;
	resolvedShell: string | undefined;
	resolvedArgs: string[];
	resolvedCwd: string | undefined;
	resolvedDirectProcess: boolean;
	resolvedLaunchProfileId: string | undefined;
	cols: number;
	rows: number;
	suppressClientError?: boolean;
	resolvedElevated?: boolean;
	resolvedElevationMethod?: string;
}

export class ChannelLifecycleManager {
	/** Optional callback to reconnect an SSH agent when restartChannel finds no connected agent. */
	onReconnectAgent?: (hostId: string) => Promise<boolean>;

	constructor(
		private readonly ctx: SharedSessionContext,
		private readonly broadcaster: StateBroadcaster,
	) {}

	// ─── Spawn ───────────────────────────────────────────────────────────────

	/**
	 * Send a SPAWN message to an agent and wait for SPAWN_OK or SPAWN_ERR.
	 * On SPAWN_OK: creates the channel in DB and memory, notifies all clients, returns channelId.
	 * On SPAWN_ERR: sends ERROR to client (unless suppressClientError=true), returns null errCode.
	 */
	async sendSpawnAndWait(
		opts: SendSpawnOpts,
	): Promise<{ channelId: string | null; errCode: string | null }> {
		const {
			agent,
			spawnMsg,
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
			suppressClientError = false,
			resolvedElevated = false,
			resolvedElevationMethod = undefined,
		} = opts;
		this.ctx.hubLogger?.log("debug", "channel-lifecycle: sendSpawnAndWait entry", {
			hostId,
			requestId: spawnMsg.requestId,
			shell: spawnMsg.shell,
			agentConnected: agent.connected,
		});
		agent.send(spawnMsg);
		this.ctx.hubLogger?.log("debug", "channel-lifecycle: SPAWN sent, awaiting SPAWN_OK", {
			requestId: spawnMsg.requestId,
			timeoutMs: SPAWN_TIMEOUT_MS,
		});

		return new Promise<{ channelId: string | null; errCode: string | null }>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.ctx.pendingRequests.delete(spawnMsg.requestId);
				this.ctx.hubLogger?.log("error", "channel-lifecycle: SPAWN_OK timeout", {
					requestId: spawnMsg.requestId,
					timeoutMs: SPAWN_TIMEOUT_MS,
				});
				reject(new Error("Agent SPAWN timeout"));
			}, SPAWN_TIMEOUT_MS);

			this.ctx.pendingRequests.set(spawnMsg.requestId, (incoming: ProtocolMessage) => {
				this.ctx.hubLogger?.log("debug", "channel-lifecycle: pendingRequest handler fired", {
					msgType: incoming.type,
					requestId: spawnMsg.requestId,
				});
				if (incoming.type === "SPAWN_OK") {
					const spawnOk = incoming as AgentSpawnOkMessage;
					clearTimeout(timer);
					this.ctx.pendingRequests.delete(spawnMsg.requestId);
					this.ctx.hubLogger?.log("debug", "channel-lifecycle: SPAWN_OK received", {
						channelId: spawnOk.channelId,
					});

					const { channelId } = spawnOk;

					this.ctx.metaDal.createChannel({
						id: channelId,
						sessionId: session.id,
						status: "born",
						...(resolvedShell !== undefined ? { shell: resolvedShell } : {}),
						...(resolvedArgs.length > 0 && { args: resolvedArgs }),
						...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
						cols,
						rows,
						...(resolvedDirectProcess && { directProcess: resolvedDirectProcess }),
						...(resolvedLaunchProfileId !== undefined && {
							launchProfileId: resolvedLaunchProfileId,
						}),
						...(resolvedElevated && { elevated: true }),
						...(resolvedElevationMethod !== undefined && {
							elevationMethod: resolvedElevationMethod,
						}),
					});

					this.ctx.channels.set(channelId, {
						sessionId: session.id,
						hostId,
						status: "live",
						clients: new Set([clientId]),
						shell: resolvedShell ?? process.env.SHELL ?? "/bin/sh",
						...(resolvedArgs.length > 0 && { args: resolvedArgs }),
						...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
						cols,
						rows,
						...(resolvedDirectProcess && { directProcess: resolvedDirectProcess }),
						dynamicTitle: null,
						processTitle: null,
						displayTitle: DEFAULT_CHANNEL_NAME,
					});
					this.ctx.metaDal.updateChannelStatus(channelId, "live");
					this.ctx.scheduler.trackChannel(channelId);
					this.ctx.chunker.trackChannel(channelId);
					client.attachedChannels.add(channelId);

					const channelStateMsg: ChannelStateMessage = {
						type: "CHANNEL_STATE",
						channelId,
						sessionId: session.id,
						status: "live",
					};
					this.broadcaster.broadcastToAllClients(channelStateMsg);

					// Broadcast CHANNEL_CREATED to all clients so observers (clients
					// not involved in this spawn) learn about the new channel without
					// having to call fetchChannels.  The spawning client deduplicates
					// via addChannel's guard (no-op if channelId already present).
					const dbChannel = this.ctx.metaDal.getChannel(channelId);
					const now = dbChannel?.createdAt ?? new Date().toISOString();
					const channelCreatedMsg: ChannelCreatedMessage = {
						type: "CHANNEL_CREATED",
						hostId,
						channelId,
						sessionId: session.id,
						shell: resolvedShell ?? process.env.SHELL ?? "/bin/sh",
						...(resolvedArgs.length > 0 && { args: resolvedArgs }),
						...(resolvedCwd !== undefined && { cwd: resolvedCwd }),
						cols,
						rows,
						status: "live",
						displayTitle: DEFAULT_CHANNEL_NAME,
						createdAt: now,
						updatedAt: now,
					};
					this.broadcaster.broadcastChannelCreated(channelCreatedMsg);

					const response: UiSpawnOkMessage = {
						type: "SPAWN_OK",
						channelId,
						hostId,
						sessionId: session.id,
					};
					client.send(response);
					resolve({ channelId, errCode: null });
				} else if (incoming.type === "SPAWN_ERR") {
					const spawnErr = incoming as AgentSpawnErrMessage;
					clearTimeout(timer);
					this.ctx.pendingRequests.delete(spawnMsg.requestId);
					this.ctx.hubLogger?.log("warn", "channel-lifecycle: SPAWN_ERR received", {
						code: spawnErr.code,
						message: spawnErr.message,
					});

					if (!suppressClientError) {
						const errorMsg: ErrorMessage = {
							type: "ERROR",
							code: spawnErr.code,
							message: spawnErr.message,
						};
						client.send(errorMsg);
					}
					resolve({ channelId: null, errCode: spawnErr.code });
				}
			});
		});
	}

	// ─── Destroy ─────────────────────────────────────────────────────────────

	/**
	 * Destroy a single channel: send DESTROY to the agent, mark dead in DB,
	 * untrack from scheduler/chunker, and remove from in-memory map.
	 * Returns true if the channel was found and destroyed.
	 */
	destroyChannel(channelId: string): boolean {
		const ch = this.ctx.channels.get(channelId);
		if (!ch) return false;

		const agent = this.ctx.agents.get(ch.hostId);
		if (agent?.connected) {
			agent.send({ type: "DESTROY", channelId } as DestroyMessage);
		}

		this.broadcaster.updateChannelStatus(channelId, ch.sessionId, "dead");

		this.ctx.scheduler.untrackChannel(channelId);
		this.ctx.chunker.untrackChannel(channelId);
		this.ctx.channels.delete(channelId);

		return true;
	}

	// ─── Restart ─────────────────────────────────────────────────────────────

	/**
	 * Restart a channel: destroy the current PTY and respawn with the same config.
	 * Returns true on success.
	 */
	async restartChannel(channelId: string, requestingClientId?: string): Promise<boolean> {
		const info = this.ctx.metaDal.getChannelWithHost(channelId);
		if (!info) return false;

		const { channel, hostId } = info;
		const ch = this.ctx.channels.get(channelId);

		let agent = this.ctx.agents.get(hostId);
		if (agent?.connected && ch && ch.status !== "dead") {
			agent.send({ type: "DESTROY", channelId } as DestroyMessage);
		}

		let sessionEntry = this.ctx.sessions.get(hostId);

		// If agent not connected, try to reconnect (SSH hosts need a fresh connection)
		if (!agent?.connected && this.onReconnectAgent) {
			const reconnected = await this.onReconnectAgent(hostId);
			if (!reconnected) return false;
			// Refresh references after reconnection
			sessionEntry = this.ctx.sessions.get(hostId);
		}

		if (!sessionEntry || (sessionEntry.status !== "active" && sessionEntry.status !== "detached"))
			return false;
		agent = this.ctx.agents.get(hostId);
		if (!agent?.connected) return false;

		const shell = channel.shell ?? process.env.SHELL ?? "/bin/sh";
		const args = channel.args ?? [];
		const cwd = channel.cwd ?? process.env.HOME ?? "/";
		const cols = channel.cols;
		const rows = channel.rows;

		// ── Elevated restart ─────────────────────────────────────────────────
		if (channel.elevated && channel.elevationMethod) {
			const method = channel.elevationMethod as ElevationMethod;

			const elevCfg = this._resolveElevationConfig(
				this.ctx.metaDal.getHost(hostId)?.customCommand,
				method,
			);
			if ("validationError" in elevCfg) {
				this.ctx.hubLogger?.log(
					"warn",
					"channel-lifecycle: restartChannel invalid elevation config",
					{ hostId, message: elevCfg.validationError.message },
				);
				return false;
			}
			const { customCommand } = elevCfg;

			const baseElevatedSpawn: AgentSpawnMessage = {
				type: "SPAWN",
				requestId: generateId(),
				channelId,
				shell,
				...(args.length > 0 && { args }),
				cwd,
				env: {},
				cols,
				rows,
				elevated: true,
				elevationMethod: method,
				...(customCommand !== undefined && { customCommand }),
			};

			// Find a client to prompt
			let promptClient: WsClient | undefined;
			if (requestingClientId) {
				promptClient = this.ctx.clients.get(requestingClientId);
			}
			if (!promptClient) {
				const attachedClientId =
					ch?.clients && ch.clients.size > 0 ? [...ch.clients][0] : undefined;
				promptClient = attachedClientId ? this.ctx.clients.get(attachedClientId) : undefined;
			}
			if (!promptClient) {
				// No client for prompting — try cache or passwordless only
				// Scan for any valid cache entry for this host (composite key ${hostId}:*)
				let cached: { secret: string; expiresAt: number } | undefined;
				for (const [key, val] of this.ctx.elevationCache) {
					if (key.startsWith(`${hostId}:`) && val.expiresAt > Date.now()) {
						cached = val;
						break;
					}
				}
				if (cached) {
					const spawnWithSecret: AgentSpawnMessage = {
						...baseElevatedSpawn,
						requestId: generateId(),
						elevationSecret: cached.secret,
					};
					return await this.restartSendAndWait(
						agent,
						spawnWithSecret,
						channelId,
						hostId,
						sessionEntry,
						ch,
						shell,
						args,
						cwd,
						cols,
						rows,
						channel.directProcess,
					);
				}
				return await this.restartSendAndWait(
					agent,
					baseElevatedSpawn,
					channelId,
					hostId,
					sessionEntry,
					ch,
					shell,
					args,
					cwd,
					cols,
					rows,
					channel.directProcess,
				);
			}

			// Cache hit — SEC-004: composite key ${hostId}:${clientId}
			const cacheKey = `${hostId}:${promptClient.id}`;
			const cached = this.ctx.elevationCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				const spawnWithSecret: AgentSpawnMessage = {
					...baseElevatedSpawn,
					requestId: generateId(),
					elevationSecret: cached.secret,
				};
				return await this.restartSendAndWait(
					agent,
					spawnWithSecret,
					channelId,
					hostId,
					sessionEntry,
					ch,
					shell,
					args,
					cwd,
					cols,
					rows,
					channel.directProcess,
				);
			}

			// Cache miss — try passwordless first
			let firstErrCode: string | null = null;
			agent.send(baseElevatedSpawn);
			const firstOk = await new Promise<boolean>((resolve) => {
				const timer = setTimeout(() => {
					this.ctx.pendingRequests.delete(baseElevatedSpawn.requestId);
					resolve(false);
				}, SPAWN_TIMEOUT_MS);
				this.ctx.pendingRequests.set(baseElevatedSpawn.requestId, (incoming: ProtocolMessage) => {
					clearTimeout(timer);
					this.ctx.pendingRequests.delete(baseElevatedSpawn.requestId);
					if (incoming.type === "SPAWN_OK") {
						resolve(true);
					} else if (incoming.type === "SPAWN_ERR") {
						firstErrCode = (incoming as AgentSpawnErrMessage).code;
						resolve(false);
					} else {
						resolve(false);
					}
				});
			});

			if (firstOk) {
				this.applyRestartState(
					channelId,
					hostId,
					sessionEntry,
					ch,
					shell,
					args,
					cwd,
					cols,
					rows,
					channel.directProcess,
				);
				return true;
			}

			if (firstErrCode !== "ELEVATION_PASSWORD_REQUIRED") {
				return false;
			}

			// Prompt user
			const promptFn = this._buildPromptAuth(promptClient);
			const host = this.ctx.metaDal.getHost(hostId);
			const hostname = host?.sshHost ?? host?.label ?? hostId;
			const secret = await promptFn(
				hostId,
				"elevation",
				`Enter password for elevated shell on ${hostname}`,
			);
			if (secret === null) {
				promptClient.send({
					type: "ERROR",
					code: "ELEVATION_CANCELLED",
					message: "Elevation cancelled by user",
				} as ErrorMessage);
				return false;
			}

			this.ctx.elevationCache.set(`${hostId}:${promptClient.id}`, {
				secret,
				expiresAt: Date.now() + 900_000,
			});

			const retrySpawn: AgentSpawnMessage = {
				...baseElevatedSpawn,
				requestId: generateId(),
				elevationSecret: secret,
			};
			return await this.restartSendAndWait(
				agent,
				retrySpawn,
				channelId,
				hostId,
				sessionEntry,
				ch,
				shell,
				args,
				cwd,
				cols,
				rows,
				channel.directProcess,
			);
		}

		// ── Non-elevated restart ─────────────────────────────────────────────
		const requestId = generateId();
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
				this.ctx.pendingRequests.delete(requestId);
				resolve(false);
			}, SPAWN_TIMEOUT_MS);

			this.ctx.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				clearTimeout(timer);
				this.ctx.pendingRequests.delete(requestId);
				resolve(incoming.type === "SPAWN_OK");
			});
		});

		if (!ok) return false;

		this.applyRestartState(
			channelId,
			hostId,
			sessionEntry,
			ch,
			shell,
			args,
			cwd,
			cols,
			rows,
			channel.directProcess,
		);
		return true;
	}

	/**
	 * Send SPAWN and wait for SPAWN_OK/ERR, then apply restart state on success.
	 */
	async restartSendAndWait(
		agent: AgentConnection,
		spawnMsg: AgentSpawnMessage,
		channelId: string,
		hostId: string,
		sessionEntry: { id: string; status: string },
		ch: ChannelState | undefined,
		shell: string,
		args: string[],
		cwd: string,
		cols: number,
		rows: number,
		directProcess?: boolean,
	): Promise<boolean> {
		agent.send(spawnMsg);
		const ok = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.ctx.pendingRequests.delete(spawnMsg.requestId);
				resolve(false);
			}, SPAWN_TIMEOUT_MS);
			this.ctx.pendingRequests.set(spawnMsg.requestId, (incoming: ProtocolMessage) => {
				clearTimeout(timer);
				this.ctx.pendingRequests.delete(spawnMsg.requestId);
				resolve(incoming.type === "SPAWN_OK");
			});
		});
		if (!ok) return false;
		this.applyRestartState(
			channelId,
			hostId,
			sessionEntry,
			ch,
			shell,
			args,
			cwd,
			cols,
			rows,
			directProcess,
		);
		return true;
	}

	/**
	 * Update in-memory + DB state after a successful restart SPAWN_OK.
	 */
	applyRestartState(
		channelId: string,
		hostId: string,
		sessionEntry: { id: string; status: string },
		ch: ChannelState | undefined,
		shell: string,
		args: string[],
		cwd: string,
		cols: number,
		rows: number,
		directProcess?: boolean,
	): void {
		this.ctx.metaDal.updateChannelStatus(channelId, "live");
		this.ctx.channels.set(channelId, {
			sessionId: sessionEntry.id,
			hostId,
			status: "live",
			clients: ch?.clients ?? new Set(),
			shell,
			...(args.length > 0 && { args }),
			cwd,
			cols,
			rows,
			...(directProcess && { directProcess: true }),
			dynamicTitle: null,
			processTitle: null,
			displayTitle: DEFAULT_CHANNEL_NAME,
		});
		this.ctx.scheduler.trackChannel(channelId);
		this.ctx.chunker.trackChannel(channelId);

		const channelStateMsg: ChannelStateMessage = {
			type: "CHANNEL_STATE",
			channelId,
			sessionId: sessionEntry.id,
			status: "live",
		};
		this.broadcaster.broadcastToAllClients(channelStateMsg);

		if (sessionEntry.status === "detached") {
			this.broadcaster.updateSessionStatus(hostId, sessionEntry.id, "active");
		}
	}

	// ─── Session close ────────────────────────────────────────────────────────

	closeSession(hostId: string, sessionId: string): void {
		// Cancel any pending reconnect timer for this host
		const pendingTimer = this.ctx.reconnectTimers.get(hostId);
		if (pendingTimer !== undefined) {
			clearTimeout(pendingTimer);
			this.ctx.reconnectTimers.delete(hostId);
		}
		// Mark all channels for this session as dead
		for (const [channelId, ch] of this.ctx.channels.entries()) {
			if (ch.hostId !== hostId || ch.status === "dead") continue;
			this.broadcaster.updateChannelStatus(channelId, sessionId, "dead");
			this.ctx.scheduler.untrackChannel(channelId);
			this.ctx.chunker.untrackChannel(channelId);
		}
		this.broadcaster.updateSessionStatus(hostId, sessionId, "closed");
		this.ctx.sessions.delete(hostId);
	}

	// ─── Spool helpers ────────────────────────────────────────────────────────

	buildAttachPayload(channelId: string): {
		snapshot: UiAttachOkMessage["snapshot"];
		tail: Uint8Array[];
	} {
		let snapshot: UiAttachOkMessage["snapshot"] = null;
		let tail: Uint8Array[] = [];

		const snapshotChunk = this.ctx.spoolDal.getLatestSnapshot(channelId);
		if (snapshotChunk) {
			try {
				snapshot = JSON.parse(
					snapshotChunk.dataBlob.toString("utf8"),
				) as UiAttachOkMessage["snapshot"];
			} catch {
				snapshot = null;
			}
			const tailChunks = this.ctx.spoolDal.getChunksByChannel(channelId, {
				kind: "output",
				afterSeq: snapshotChunk.seq,
			});
			tail = tailChunks.map((c) => new Uint8Array(c.dataBlob));
		}

		return { snapshot, tail };
	}

	storeSnapshot(channelId: string, snapshot: unknown, agentLastSeq: number): string {
		const snapshotJson = JSON.stringify(snapshot);
		const dataBlob = Buffer.from(snapshotJson);
		this.ctx.chunker.flush(channelId);
		const maxSeq = this.ctx.spoolDal.getMaxSeq(channelId);
		const snapshotSeq = Math.max(maxSeq, agentLastSeq) + 1;
		const chunkId = this.ctx.spoolDal.insertChunk({
			channelId,
			seq: snapshotSeq,
			kind: "snapshot",
			dataBlob,
			uncompressedLen: dataBlob.length,
		});
		this.ctx.chunker.bumpSeq(channelId, snapshotSeq + 1);
		this.ctx.metaDal.updateCacheIndex(channelId, chunkId, snapshotSeq - 1);
		return chunkId;
	}

	// ─── Dead-channel respawn ─────────────────────────────────────────────────

	/**
	 * Attempt to transparently respawn a dead channel under the same ID.
	 */
	async respawnDeadChannel(
		deadChannelId: string,
		client: WsClient,
		clientId: string,
	): Promise<boolean> {
		const info = this.ctx.metaDal.getChannelWithHost(deadChannelId);
		if (!info) return false;
		const { channel: deadChannel, hostId } = info;

		const sessionEntry = this.ctx.sessions.get(hostId);
		if (!sessionEntry || sessionEntry.status !== "active") return false;
		const agent = this.ctx.agents.get(hostId);
		if (!agent?.connected) return false;

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

		const spawnOk = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.ctx.pendingRequests.delete(requestId);
				resolve(false);
			}, SPAWN_TIMEOUT_MS);

			this.ctx.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				if (incoming.type === "SPAWN_OK") {
					clearTimeout(timer);
					this.ctx.pendingRequests.delete(requestId);
					resolve(true);
				} else if (incoming.type === "SPAWN_ERR") {
					clearTimeout(timer);
					this.ctx.pendingRequests.delete(requestId);
					resolve(false);
				}
			});
		});

		if (!spawnOk) return false;

		this.ctx.metaDal.updateChannelStatus(deadChannelId, "live");

		this.ctx.channels.set(deadChannelId, {
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

		this.ctx.scheduler.trackChannel(deadChannelId);
		this.ctx.chunker.trackChannel(deadChannelId);
		client.attachedChannels.add(deadChannelId);

		const channelStateMsg: ChannelStateMessage = {
			type: "CHANNEL_STATE",
			channelId: deadChannelId,
			sessionId: sessionEntry.id,
			status: "live",
		};
		this.broadcaster.broadcastToAllClients(channelStateMsg);

		const { snapshot, tail } = this.buildAttachPayload(deadChannelId);

		const attachOk: UiAttachOkMessage = {
			type: "ATTACH_OK",
			channelId: deadChannelId,
			snapshot,
			tail,
			writeLockHolder: this.ctx.getWriteLockHolder?.(deadChannelId) ?? null,
			cached: false,
		};
		client.send(attachOk);

		return true;
	}

	// ─── Re-attach channels ───────────────────────────────────────────────────

	reAttachChannels(hostId: string, sessionId: string, agent: AgentConnection): void {
		this.spawnChannelsForHost(
			hostId,
			agent,
			(channelId, ch) => {
				if (ch.clients.size > 0) {
					this.broadcaster.updateChannelStatus(channelId, sessionId, "live");
				}
				this.ctx.scheduler.trackChannel(channelId);
				this.ctx.chunker.trackChannel(channelId);
			},
			(channelId, ch) => {
				this.broadcaster.updateChannelStatus(channelId, ch.sessionId, "dead");
			},
		);
	}

	/**
	 * Send SPAWN messages for every alive channel belonging to a host.
	 * The returned promise resolves once ALL SPAWN_OK/SPAWN_ERR responses (or timeouts) have fired.
	 */
	spawnChannelsForHost(
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

		for (const [channelId, ch] of this.ctx.channels.entries()) {
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
				this.ctx.pendingRequests.delete(requestId);
				this.ctx.hubLogger?.log("error", "channel-lifecycle: SPAWN timeout", {
					channelId,
					requestId,
					timeoutMs: SPAWN_TIMEOUT_MS,
				});
				onSpawnErr(channelId, ch);
				settle();
			}, SPAWN_TIMEOUT_MS);

			this.ctx.pendingRequests.set(requestId, (incoming: ProtocolMessage) => {
				clearTimeout(timeout);
				this.ctx.pendingRequests.delete(requestId);
				if (incoming.type === "SPAWN_OK") {
					onSpawnOk(channelId, ch);
				} else {
					onSpawnErr(channelId, ch);
				}
				settle();
			});
		}

		if (pending === 0) resolve?.();

		return promise;
	}

	// ─── Reconcile ────────────────────────────────────────────────────────────

	reconcileChannelState(hostId: string, states: AgentChannelStateMessage[]): void {
		const reportedIds = new Set(states.filter((s) => s.alive).map((s) => s.channelId));

		for (const [channelId, channelState] of this.ctx.channels) {
			if (channelState.hostId !== hostId) continue;

			const session = this.ctx.sessions.get(hostId);
			if (!session || channelState.sessionId !== session.id) continue;

			if (reportedIds.has(channelId)) {
				if (channelState.status === "orphan") {
					this.broadcaster.updateChannelStatus(channelId, session.id, "live");
				}
			} else {
				if (channelState.status !== "dead") {
					this.broadcaster.updateChannelStatus(channelId, session.id, "dead");
				}
			}
		}
	}

	// ─── Private elevation helpers ────────────────────────────────────────────

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

	private _buildPromptAuth(client: WsClient): import("./ssh-agent.js").AuthPromptFn {
		return async (hostId, promptType, message) => {
			const promptMsg: AuthPromptMessage = {
				type: "AUTH_PROMPT",
				hostId,
				promptType,
				message,
			};
			client.send(promptMsg);
			return new Promise<string | null>((resolve) => {
				// Race condition guard: cancel any existing pending prompt for this hostId
				// before setting a new one (e.g. concurrent SPAWNs for the same host).
				const existing = this.ctx.pendingAuthPrompts.get(hostId);
				if (existing) {
					if (existing.timer !== null) clearTimeout(existing.timer);
					existing.resolve(null);
				}

				// 60-second server-side timeout: if the client disconnects or never
				// responds, the promise resolves with null (= cancelled) instead of
				// hanging forever.
				const timer = setTimeout(() => {
					const p = this.ctx.pendingAuthPrompts.get(hostId);
					if (p) {
						this.ctx.pendingAuthPrompts.delete(hostId);
						p.resolve(null);
					}
				}, 60_000);

				this.ctx.pendingAuthPrompts.set(hostId, { resolve, timer, clientId: client.id });
			});
		};
	}

	/**
	 * Cancel all pending auth prompts for a disconnected client.
	 * Must be called from the client disconnect handler (ws-handler.ts).
	 */
	cancelPendingAuthPromptsForClient(clientId: string): void {
		for (const [hostId, pending] of this.ctx.pendingAuthPrompts.entries()) {
			if (pending.clientId === clientId) {
				if (pending.timer !== null) clearTimeout(pending.timer);
				pending.resolve(null);
				this.ctx.pendingAuthPrompts.delete(hostId);
			}
		}
	}
}
