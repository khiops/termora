import type { AgentConnection } from "./agent-connection.js";

const SNAPSHOT_IDLE_MS = 3_000; // 3s idle trigger
const SNAPSHOT_FORCED_MS = 5_000; // 5s forced trigger

interface ChannelTimers {
	lastOutputAt: number;
	lastSnapshotAt: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	forcedTimer: ReturnType<typeof setInterval> | null;
}

export class SnapshotScheduler {
	private channels = new Map<string, ChannelTimers>();

	constructor(private getAgent: (channelId: string) => AgentConnection | undefined) {}

	/** Start tracking a channel for snapshot scheduling */
	trackChannel(channelId: string): void {
		if (this.channels.has(channelId)) return;

		const now = Date.now();
		const state: ChannelTimers = {
			lastOutputAt: now,
			lastSnapshotAt: 0,
			idleTimer: null,
			forcedTimer: null,
		};
		this.channels.set(channelId, state);

		state.idleTimer = setTimeout(() => this._onIdleTimeout(channelId), SNAPSHOT_IDLE_MS);
		state.forcedTimer = setInterval(() => this._onForcedTimeout(channelId), SNAPSHOT_FORCED_MS);
	}

	/** Called when OUTPUT is received for a channel — reset idle timer */
	onOutput(channelId: string): void {
		const state = this.channels.get(channelId);
		if (!state) return;

		state.lastOutputAt = Date.now();

		if (state.idleTimer !== null) {
			clearTimeout(state.idleTimer);
		}
		state.idleTimer = setTimeout(() => this._onIdleTimeout(channelId), SNAPSHOT_IDLE_MS);
	}

	/** Called when last client detaches — trigger immediate snapshot */
	onDetach(channelId: string): void {
		this._requestSnapshot(channelId);
	}

	/** Stop tracking a channel (channel DEAD or session CLOSED) */
	untrackChannel(channelId: string): void {
		const state = this.channels.get(channelId);
		if (!state) return;

		if (state.idleTimer !== null) {
			clearTimeout(state.idleTimer);
		}
		if (state.forcedTimer !== null) {
			clearInterval(state.forcedTimer);
		}
		this.channels.delete(channelId);
	}

	/** Stop all tracking (shutdown) */
	shutdown(): void {
		for (const channelId of this.channels.keys()) {
			this.untrackChannel(channelId);
		}
	}

	private _onIdleTimeout(channelId: string): void {
		const state = this.channels.get(channelId);
		if (!state) return;
		state.idleTimer = null;
		this._requestSnapshot(channelId);
	}

	private _onForcedTimeout(channelId: string): void {
		this._requestSnapshot(channelId);
	}

	private _requestSnapshot(channelId: string): void {
		const state = this.channels.get(channelId);
		if (state) {
			state.lastSnapshotAt = Date.now();
		}

		const agent = this.getAgent(channelId);
		if (!agent?.connected) return;

		agent.send({ type: "SNAPSHOT_REQ", channelId });
	}
}
