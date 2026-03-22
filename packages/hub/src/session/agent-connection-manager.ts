/**
 * AgentConnectionManager — agent wiring, startup, daemon attach, warm restart.
 * Handles the low-level lifecycle of AgentConnection instances:
 *   - _wireAgentEvents: event dispatch from agent → session/channel handlers
 *   - daemon connect/reconnect
 *   - warm restart for local agents
 *   - session/host bootstrap (ensureLocalHost, startup, _getOrCreateSession)
 */

import type {
	AgentBellMessage,
	AgentChannelStateMessage,
	AgentLogMessage,
	AgentNotificationMessage,
	AgentProcessTitleMessage,
	AgentSnapshotResMessage,
	AgentSpawnMessage,
	AgentTitleChangeMessage,
	ChannelExitMessage,
	OutputMessage,
	ProtocolMessage,
	SessionStatus,
} from "@nexterm/shared";
import { DEFAULT_CHANNEL_NAME, generateId, getSocketPath } from "@nexterm/shared";
import { connectOrLaunch } from "./agent-launcher.js";
import { LocalAgent, resolveAgentPath } from "./local-agent.js";
import { NextermAgent } from "./nexterm-agent.js";
import type { AgentConnection } from "./agent-connection.js";
import type { SharedSessionContext, SessionState } from "./session-context.js";
import type { StateBroadcaster } from "./state-broadcaster.js";
import type { ChannelLifecycleManager } from "./channel-lifecycle-manager.js";
import type { SshConnectionManager } from "./ssh-connection-manager.js";

export class AgentConnectionManager {
	/** Lazy ref to SshConnectionManager — set after construction to break circular dep */
	sshMgr!: SshConnectionManager;

	constructor(
		private readonly ctx: SharedSessionContext,
		private readonly broadcaster: StateBroadcaster,
		private readonly lifecycle: ChannelLifecycleManager,
	) {}

	// ─── Host / session helpers ───────────────────────────────────────────────

	async ensureLocalHost(): Promise<string> {
		const existing = this.ctx.metaDal.getHostByLabel("local");
		if (existing) return existing.id;
		const host = this.ctx.metaDal.createHost({ type: "local", label: "local" });
		return host.id;
	}

	async resolveHostId(requestedId?: string): Promise<string> {
		if (!requestedId || requestedId === "local") {
			return this.ensureLocalHost();
		}
		return requestedId;
	}

	async getOrCreateSession(hostId: string, isSsh: boolean): Promise<SessionState> {
		const existing = this.ctx.sessions.get(hostId);
		if (existing && (existing.status === "active" || existing.status === "disconnected")) {
			return existing;
		}

		const sessionId = generateId();
		const initialStatus: SessionStatus = "starting";
		this.ctx.metaDal.createSession({ id: sessionId, hostId, status: initialStatus });

		const state: SessionState = { id: sessionId, hostId, status: initialStatus };
		this.ctx.sessions.set(hostId, state);
		return state;
	}

	// ─── Startup ──────────────────────────────────────────────────────────────

	/**
	 * On hub start, restore sessions that were alive before the previous shutdown.
	 */
	async startup(): Promise<void> {
		const alive = this.ctx.metaDal.listAliveChannelsWithHost();
		if (alive.length === 0) return;

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
			const sessions = this.ctx.metaDal.listSessions(hostId);
			const session = sessions.find((s) => s.status !== "closed");
			if (!session) {
				for (const ch of channels) {
					this.ctx.metaDal.updateChannelStatus(ch.id, "dead");
				}
				continue;
			}

			this.ctx.metaDal.markHostSessionDisconnected(hostId);
			this.ctx.sessions.set(hostId, {
				id: session.id,
				hostId,
				status: "disconnected",
			});

			this.ctx.metaDal.markHostChannelsOrphan(hostId);
			for (const ch of channels) {
				this.ctx.channels.set(ch.id, {
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
					await this.connectDaemonAgent(hostId, session.id);
				} catch {
					await this.warmRestartLocal(hostId, session.id);
				}
			}
		}
	}

	// ─── Event wiring ─────────────────────────────────────────────────────────

	wireAgentEvents(hostId: string, sessionId: string, agent: AgentConnection): void {
		agent.on("message", (msg: ProtocolMessage) => {
			// Dispatch pending request responses
			const rid = (msg as { requestId?: string }).requestId;
			if (rid) {
				const handler = this.ctx.pendingRequests.get(rid);
				if (handler) {
					handler(msg);
					return;
				}
			}

			// Dispatch pending attach responses (ATTACH_OK uses channelId, not requestId)
			if (msg.type === "ATTACH_OK" || msg.type === "ERROR") {
				const cid = (msg as { channelId?: string }).channelId;
				if (cid) {
					const handler = this.ctx.pendingRequests.get(`attach:${cid}`);
					if (handler) {
						handler(msg);
						return;
					}
				}
			}

			if (msg.type === "HELLO") {
				const helloMsg = msg as import("@nexterm/shared").HelloMessage;
				this.ctx.hubLogger?.log("debug", "agent-connection-manager: HELLO received", { hostId, capabilities: helloMsg.capabilities, availableShells: helloMsg.availableShells });
				if (helloMsg.availableShells !== undefined) {
					this.ctx.metaDal.updateHostDiscoveredShells(
						hostId,
						helloMsg.availableShells,
						helloMsg.defaultShell,
					);
				}
				if (Array.isArray(helloMsg.capabilities)) {
					this.ctx.agentCapabilities.set(hostId, helloMsg.capabilities);
				}
			} else if (msg.type === "OUTPUT") {
				const outputMsg = msg as OutputMessage;
				this.broadcaster.broadcastToChannel(outputMsg.channelId, outputMsg);
				this.ctx.scheduler.onOutput(outputMsg.channelId);
				this.ctx.chunker.onOutput(outputMsg.channelId, outputMsg.data);
			} else if (msg.type === "SNAPSHOT_RES") {
				const res = msg as AgentSnapshotResMessage;
				this.ctx.scheduler.onSnapshotResponse(res.channelId);
				this.lifecycle.storeSnapshot(res.channelId, res.snapshot, res.lastSeq);
			} else if (msg.type === "CHANNEL_EXIT") {
				const exitMsg = msg as ChannelExitMessage;
				const channel = this.ctx.channels.get(exitMsg.channelId);
				if (channel) {
					this.broadcaster.updateChannelStatus(exitMsg.channelId, channel.sessionId, "dead", exitMsg.exitCode);
				}
				this.ctx.scheduler.untrackChannel(exitMsg.channelId);
				this.ctx.chunker.untrackChannel(exitMsg.channelId);
				this.broadcaster.clearTitleDebounce(exitMsg.channelId);
				this.broadcaster.clearProcessTitleDebounce(exitMsg.channelId);
				// Close and remove the channel logger on exit
				const exitLogger = this.ctx.loggerRegistry?.get(exitMsg.channelId);
				if (exitLogger) {
					exitLogger.log("hub", "info", "channel exit", { exitCode: exitMsg.exitCode ?? null });
					exitLogger.close();
					this.ctx.loggerRegistry!.delete(exitMsg.channelId);
				}
			} else if (msg.type === "TITLE_CHANGE") {
				this.broadcaster.handleTitleChange(msg as AgentTitleChangeMessage);
			} else if (msg.type === "PROCESS_TITLE") {
				this.broadcaster.handleProcessTitle(msg as AgentProcessTitleMessage);
			} else if (msg.type === "BELL") {
				const bellMsg = msg as AgentBellMessage;
				if (this.broadcaster.rateLimitCheck(this.ctx.bellTimestamps, bellMsg.channelId, 10)) {
					this.broadcaster.broadcastToChannel(bellMsg.channelId, bellMsg);
				}
			} else if (msg.type === "NOTIFICATION") {
				const notifMsg = msg as AgentNotificationMessage;
				if (this.broadcaster.rateLimitCheck(this.ctx.notificationTimestamps, notifMsg.channelId, 5)) {
					this.broadcaster.broadcastToChannel(notifMsg.channelId, notifMsg);
				}
			} else if ((msg as { type: string }).type === "LOG") {
				const logMsg = msg as unknown as AgentLogMessage;
				// Validate level before casting
				const validLevels = ["trace", "debug", "info", "warn", "error"];
				const level = (validLevels.includes(logMsg.level) ? logMsg.level : "info") as import("@nexterm/shared").LogConfig["level"];
				const channelLogger = this.ctx.loggerRegistry?.get(logMsg.channelId);
				if (channelLogger) {
					channelLogger.log("agent", level, logMsg.msg);
				} else {
					this.ctx.hubLogger?.log(level, logMsg.msg, { channelId: logMsg.channelId, src: "agent" });
				}
			}
		});

		// The HELLO may have fired before we registered the "message" handler
		if (agent.helloMessage) {
			this.ctx.hubLogger?.log("debug", "agent-connection-manager: replaying cached HELLO", { hostId });
			const helloMsg = agent.helloMessage;
			if (helloMsg.availableShells !== undefined) {
				this.ctx.metaDal.updateHostDiscoveredShells(
					hostId,
					helloMsg.availableShells,
					helloMsg.defaultShell,
				);
			}
			if (Array.isArray(helloMsg.capabilities)) {
				this.ctx.agentCapabilities.set(hostId, helloMsg.capabilities);
			}
		}

		agent.on("close", () => {
			this.ctx.hubLogger?.log("info", "agent-connection-manager: agent closed", { hostId });
			const session = this.ctx.sessions.get(hostId);
			const host = this.ctx.metaDal.getHost(hostId);
			this.ctx.agents.delete(hostId);
			this.ctx.agentCapabilities.delete(hostId);

			if (!session) return;

			if (agent instanceof NextermAgent) {
				this.broadcaster.updateSessionStatus(hostId, session.id, "disconnected");
				this.reconnectDaemon(hostId, session.id).catch(() => {
					this.lifecycle.closeSession(hostId, session.id);
				});
				return;
			}

			if (host?.type === "ssh") {
				this.broadcaster.updateSessionStatus(hostId, session.id, "disconnected");
				this.sshMgr.scheduleReconnect(hostId, session.id, 0, Date.now());
			} else {
				this.warmRestartLocal(hostId, session.id).catch(() => {
					this.lifecycle.closeSession(hostId, session.id);
				});
			}
		});
	}

	// ─── Daemon agent ─────────────────────────────────────────────────────────

	private async attachDaemon(hostId: string, sessionId: string): Promise<NextermAgent> {
		const socketPath = getSocketPath(this.ctx.agentConfig.socketPath);
		this.ctx.hubLogger?.log("debug", "agent-connection-manager: attachDaemon", { hostId, sessionId, socketPath });
		const agent = await connectOrLaunch(socketPath, this.ctx.agentConfig);
		this.ctx.hubLogger?.log("debug", "agent-connection-manager: connectOrLaunch succeeded", { hostId, connected: agent.connected });

		this.wireAgentEvents(hostId, sessionId, agent);

		this.ctx.hubLogger?.log("debug", "agent-connection-manager: waiting for channel state", { hostId });
		const states = await agent.waitForChannelState();
		this.ctx.hubLogger?.log("debug", "agent-connection-manager: got channel states", { hostId, count: states.length });
		this.lifecycle.reconcileChannelState(hostId, states);

		this.ctx.agents.set(hostId, agent);
		this.broadcaster.updateSessionStatus(hostId, sessionId, "active");
		this.ctx.hubLogger?.log("info", "agent-connection-manager: agent active", { hostId });

		return agent;
	}

	async connectDaemonAgent(hostId: string, sessionId: string): Promise<NextermAgent> {
		this.ctx.hubLogger?.log("debug", "agent-connection-manager: connectDaemonAgent", { hostId, sessionId });
		return this.attachDaemon(hostId, sessionId);
	}

	async reconnectDaemon(hostId: string, sessionId: string): Promise<void> {
		await this.attachDaemon(hostId, sessionId);
	}

	// ─── Warm restart (local) ─────────────────────────────────────────────────

	async warmRestartLocal(hostId: string, sessionId: string): Promise<void> {
		// Crash-loop protection: max 3 restarts in 60s
		const now = Date.now();
		const tracking = this.ctx.restartTracking.get(hostId) ?? { count: 0, windowStart: now };
		if (now - tracking.windowStart > 60_000) {
			tracking.count = 0;
			tracking.windowStart = now;
		}
		tracking.count++;
		this.ctx.restartTracking.set(hostId, tracking);

		if (tracking.count > 3) {
			this.lifecycle.closeSession(hostId, sessionId);
			return;
		}

		const agent = new LocalAgent(resolveAgentPath());
		try {
			await agent.start();
		} catch {
			this.lifecycle.closeSession(hostId, sessionId);
			return;
		}

		this.wireAgentEvents(hostId, sessionId, agent);
		this.ctx.agents.set(hostId, agent);
		this.broadcaster.updateSessionStatus(hostId, sessionId, "active");

		await this.lifecycle.spawnChannelsForHost(
			hostId,
			agent,
			(channelId) => {
				this.ctx.scheduler.trackChannel(channelId);
				this.ctx.chunker.trackChannel(channelId);
			},
			(channelId, ch) => {
				this.broadcaster.updateChannelStatus(channelId, ch.sessionId, "dead");
			},
		);
	}
}
