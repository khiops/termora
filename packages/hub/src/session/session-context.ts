/**
 * SharedSessionContext — mutable runtime state shared across all sub-managers.
 * Each sub-manager receives a reference to this context in its constructor
 * so they can read/write the same Maps without circular constructor deps.
 */

import type { AgentConfig, ChannelStatus, SessionStatus } from "@nexterm/shared";
import type { ConfigResolver } from "../config.js";
import type { HubLogger } from "../logging/hub-logger.js";
import type { LoggerRegistry } from "../logging/index.js";
import type { MetaDAL } from "../storage/meta.js";
import type { SpoolDAL } from "../storage/spool.js";
import type { AgentConnection } from "./agent-connection.js";
import type { OutputChunker } from "./output-chunker.js";
import type { SnapshotScheduler } from "./snapshot-scheduler.js";
import type { WsClient } from "./session-manager.js";

export interface ChannelState {
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

export interface SessionState {
	id: string;
	hostId: string;
	status: SessionStatus;
}

export interface SharedSessionContext {
	/** hostId → AgentConnection */
	agents: Map<string, AgentConnection>;
	/** hostId → SessionState */
	sessions: Map<string, SessionState>;
	/** channelId → ChannelState */
	channels: Map<string, ChannelState>;
	/** clientId → WsClient */
	clients: Map<string, WsClient>;
	/** hostId → pending reconnect timer */
	reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
	/** Crash-loop tracking for local agent restarts: hostId → { count, windowStart } */
	restartTracking: Map<string, { count: number; windowStart: number }>;
	/** requestId → callback for pending agent responses */
	pendingRequests: Map<string, (msg: import("@nexterm/shared").ProtocolMessage) => void>;
	/** hostId → pending auth prompt resolve + timeout */
	pendingAuthPrompts: Map<
		string,
		{
			resolve: (secret: string | null) => void;
			timer: ReturnType<typeof setTimeout> | null;
			clientId: string;
		}
	>;
	/** promptId → pending host-key-mismatch resolution */
	pendingHostVerify: Map<
		string,
		{
			resolve: (accepted: boolean) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>;
	/** channelId → timestamps of recent BELL messages (sliding window for rate limiting) */
	bellTimestamps: Map<string, number[]>;
	/** channelId → timestamps of recent NOTIFICATION messages (sliding window for rate limiting) */
	notificationTimestamps: Map<string, number[]>;
	/** `${hostId}:${clientId}` → cached elevation secret + expiry (TTL 5 min) */
	elevationCache: Map<string, { secret: string; expiresAt: number }>;
	/** hostId → capabilities string[] reported in the agent HELLO message */
	agentCapabilities: Map<string, string[]>;
	/** channelId → pending title debounce timer for DB writes */
	titleDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
	/** channelId → pending process title debounce timer for DB writes */
	processTitleDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
	/** Optional callback to resolve the current write-lock holder for a channel */
	getWriteLockHolder: ((channelId: string) => string | null) | null;
	/** DALs */
	metaDal: MetaDAL;
	spoolDal: SpoolDAL;
	/** Scheduler, chunker */
	scheduler: SnapshotScheduler;
	chunker: OutputChunker;
	/** Config */
	agentConfig: AgentConfig;
	configResolver: ConfigResolver | null;
	/** Logging — null until initialized by SessionManager */
	loggerRegistry: LoggerRegistry | null;
	hubLogger: HubLogger | null;
}
