// nexterm Protocol message types
//
// Naming strategy for ambiguous messages:
// - Messages that differ between agent and UI contexts use a prefix: Agent* / Ui*
// - Messages identical in both contexts are defined once and shared
//
// Wire format: snake_case (codec handles conversion at boundaries)
// TypeScript interfaces: camelCase

import type { ChannelStatus, SessionStatus } from "./entities.js";

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

export interface SnapshotData {
	serialized: string;
	cols: number;
	rows: number;
	cursorX: number;
	cursorY: number;
}

// ---------------------------------------------------------------------------
// Hub ↔ Agent messages
// ---------------------------------------------------------------------------

/** Agent → Hub: first message after connection, announces capabilities */
export interface HelloMessage {
	type: "HELLO";
	version: number; // always 1 for MVP
	agentVersion: string;
	capabilities: string[]; // "multiplex", "snapshot", "resize"
	visualHints?: {
		badge?: { text: string; color: string };
		themeOverlay?: Record<string, string>;
	};
	availableShells?: string[];
	defaultShell?: string;
}

/** Hub → Agent: spawn a new PTY channel */
export interface AgentSpawnMessage {
	type: "SPAWN";
	requestId: string;
	channelId?: string;
	shell: string;
	args?: string[];
	cwd: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
	directProcess?: boolean;
	elevated?: boolean;
	elevationSecret?: string;
	elevationMethod?: string;
	customCommand?: string;
}

/** Agent → Hub: PTY spawned successfully */
export interface AgentSpawnOkMessage {
	type: "SPAWN_OK";
	requestId: string;
	channelId: string;
}

/** Agent → Hub: PTY spawn failed */
export interface AgentSpawnErrMessage {
	type: "SPAWN_ERR";
	requestId: string;
	code: string; // "SHELL_NOT_FOUND", "PERMISSION_DENIED", etc.
	message: string;
}

/** Hub → Agent: send user input to a channel's PTY */
export interface InputMessage {
	type: "INPUT";
	channelId: string;
	data: Uint8Array;
}

/** Agent → Hub (also Hub → UI): PTY output data */
export interface OutputMessage {
	type: "OUTPUT";
	channelId: string;
	seq: number;
	ts: string; // ISO 8601
	data: Uint8Array;
}

/** Hub → Agent (also UI → Hub): resize PTY */
export interface ResizeMessage {
	type: "RESIZE";
	channelId: string;
	cols: number;
	rows: number;
}

/** Hub → Agent: request a terminal snapshot */
export interface SnapshotReqMessage {
	type: "SNAPSHOT_REQ";
	channelId: string;
}

/** Agent → Hub: terminal snapshot response */
export interface AgentSnapshotResMessage {
	type: "SNAPSHOT_RES";
	channelId: string;
	snapshot: SnapshotData;
	lastSeq: number;
}

/** Hub → Agent: attach to an existing channel (re-connect after drop) */
export interface AgentAttachMessage {
	type: "ATTACH";
	channelId: string;
}

/** Agent → Hub: attach acknowledged, includes current snapshot */
export interface AgentAttachOkMessage {
	type: "ATTACH_OK";
	channelId: string;
	snapshot: SnapshotData;
	lastSeq: number;
}

/** Agent → Hub: PTY exited */
export interface ChannelExitMessage {
	type: "CHANNEL_EXIT";
	channelId: string;
	exitCode: number;
	signal?: string;
}

/** Hub → Agent: destroy a channel and its PTY */
export interface DestroyMessage {
	type: "DESTROY";
	channelId: string;
}

/** Hub → Agent: liveness check */
export interface HeartbeatMessage {
	type: "HEARTBEAT";
	ts: string; // ISO 8601
}

/** Agent → Hub: liveness acknowledgement */
export interface HeartbeatAckMessage {
	type: "HEARTBEAT_ACK";
	ts: string; // ISO 8601, echoed from HEARTBEAT
}

/** Either direction: structured error */
export interface ErrorMessage {
	type: "ERROR";
	code: string;
	message: string;
	channelId?: string;
}

/** Agent → Hub (daemon mode): metadata for each alive channel on hub connect/reconnect */
export interface AgentChannelStateMessage {
	type: "AGENT_CHANNEL_STATE";
	channelId: string;
	title: string;
	pid: number;
	alive: boolean;
}

/** Agent → Hub (daemon mode): sentinel marking end of AGENT_CHANNEL_STATE enumeration */
export interface ChannelStateEndMessage {
	type: "CHANNEL_STATE_END";
}

/** Agent → Hub: terminal title changed (OSC 0/2) */
export interface AgentTitleChangeMessage {
	type: "TITLE_CHANGE";
	channelId: string;
	title: string; // already sanitized by agent
	displayTitle?: string;
}

/** Agent → Hub: foreground process name changed (polled from PTY PID). */
export interface AgentProcessTitleMessage {
	type: "PROCESS_TITLE";
	channelId: string;
	title: string;
	displayTitle?: string;
}

/** Agent → Hub: terminal bell (BEL character, \x07) */
export interface AgentBellMessage {
	type: "BELL";
	channelId: string;
}

/** Agent → Hub: OSC 9 desktop notification */
export interface AgentNotificationMessage {
	type: "NOTIFICATION";
	channelId: string;
	message: string;
}

// ---------------------------------------------------------------------------
// Hub ↔ UI messages (WebSocket)
// ---------------------------------------------------------------------------

/** UI → Hub: authenticate the WebSocket connection */
export interface AuthMessage {
	type: "AUTH";
	token: string;
}

/** Hub → UI: authentication succeeded */
export interface AuthOkMessage {
	type: "AUTH_OK";
	clientId: string;
}

/** Hub → UI: authentication failed */
export interface AuthFailMessage {
	type: "AUTH_FAIL";
	message: string;
}

/** UI → Hub: request to spawn a channel on a host */
export interface UiSpawnMessage {
	type: "SPAWN";
	hostId: string;
	shell?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	groupId?: string;
	cols?: number;
	rows?: number;
	directProcess?: boolean;
	launchProfileId?: string;
	elevated?: boolean;
}

/** Hub → UI: channel spawned successfully */
export interface UiSpawnOkMessage {
	type: "SPAWN_OK";
	channelId: string;
	hostId: string;
	sessionId: string;
}

/** UI → Hub: attach this client to an existing channel */
export interface UiAttachMessage {
	type: "ATTACH";
	channelId: string;
}

/** Hub → UI: attach acknowledged, includes snapshot + tail for replay */
export interface UiAttachOkMessage {
	type: "ATTACH_OK";
	channelId: string;
	snapshot: SnapshotData | null;
	tail: Uint8Array[];
	writeLockHolder: string | null;
	cached: boolean;
	dynamicTitle?: string;
	processTitle?: string;
	displayTitle?: string;
}

/** UI → Hub: detach this client from a channel (keep channel alive) */
export interface DetachMessage {
	type: "DETACH";
	channelId: string;
}

// --- Write-lock messages ---

/** UI → Hub: claim exclusive write access for this client */
export interface WriteClaimMessage {
	type: "WRITE_CLAIM";
	channelId: string;
}

/** UI → Hub: voluntarily release write lock */
export interface WriteReleaseMessage {
	type: "WRITE_RELEASE";
	channelId: string;
}

/** UI → Hub (privileged): forcibly steal write lock from current holder */
export interface WriteForceMessage {
	type: "WRITE_FORCE";
	channelId: string;
}

/** Hub → UI (to current lock holder): another client wants write access */
export interface WriteRequestMessage {
	type: "WRITE_REQUEST";
	channelId: string;
	fromClientId: string;
}

/** Hub → UI (to requester): write lock granted */
export interface WriteGrantMessage {
	type: "WRITE_GRANT";
	channelId: string;
	toClientId: string;
}

/** Hub → UI (to requester): write lock denied */
export interface WriteDenyMessage {
	type: "WRITE_DENY";
	channelId: string;
	toClientId: string;
}

/** Hub → UI (to current holder): write lock was forcibly revoked */
export interface WriteRevokedMessage {
	type: "WRITE_REVOKED";
	channelId: string;
}

/** Hub → UI: current write lock state for a channel */
export interface WriteLockMessage {
	type: "WRITE_LOCK";
	channelId: string;
	holder: string | null; // clientId or null
}

// --- State notifications ---

/** Hub → UI: session lifecycle state change */
export interface SessionStateMessage {
	type: "SESSION_STATE";
	sessionId: string;
	hostId: string;
	status: SessionStatus;
}

/** Hub → UI: channel lifecycle state change */
export interface ChannelStateMessage {
	type: "CHANNEL_STATE";
	channelId: string;
	sessionId: string;
	status: ChannelStatus;
	exitCode?: number;
}

/** Hub → UI: full state snapshot sent immediately after AUTH_OK */
export interface StateSyncMessage {
	type: "STATE_SYNC";
	sessions: Array<{
		sessionId: string;
		hostId: string;
		status: SessionStatus;
	}>;
	channels: Array<{
		channelId: string;
		sessionId: string;
		status: ChannelStatus;
		exitCode?: number;
		displayTitle?: string;
	}>;
}

// --- Ping / pong (WebSocket keepalive) ---

/** UI → Hub: keepalive ping */
export interface PingMessage {
	type: "PING";
}

/** Hub → UI: keepalive pong */
export interface PongMessage {
	type: "PONG";
}

// --- SSH host fingerprint verification ---

/** Hub → UI: unknown host fingerprint, waiting for user decision */
export interface HostVerifyMessage {
	type: "HOST_VERIFY";
	hostId: string;
	fingerprint: string;
	algorithm: string;
	/** Set when the stored fingerprint differs from the server's current key (MITM warning). */
	oldFingerprint?: string;
	/** Correlation ID — must be echoed in HOST_VERIFY_RESPONSE for mismatch prompts. */
	promptId?: string;
}

/** UI → Hub: user decision on unknown fingerprint */
export interface HostVerifyResponseMessage {
	type: "HOST_VERIFY_RESPONSE";
	hostId: string;
	action: "trust_permanent" | "trust_once" | "reject";
	/** Must match the promptId from HostVerifyMessage when responding to a mismatch prompt. */
	promptId?: string;
}

/** Hub → UI: request a secret from the user during SSH connection */
export interface AuthPromptMessage {
	type: "AUTH_PROMPT";
	hostId: string;
	promptType: "password" | "passphrase" | "elevation";
	message: string;
}

/** UI → Hub: user provides the secret (or cancels) */
export interface AuthPromptResponseMessage {
	type: "AUTH_PROMPT_RESPONSE";
	hostId: string;
	secret: string | null; // null = user cancelled
}

/** UI → Hub: test SSH connectivity (with optional auth prompting) */
export interface TestConnectMessage {
	type: "TEST_CONNECT";
	hostId: string; // real host ID for saved hosts, client-generated temp ID for unsaved
	hostname: string;
	port: number;
	sshAuth: "agent" | "key" | "password";
	sshKeyPath?: string;
	sshUser?: string;
}

/** Hub → UI: test connectivity succeeded */
export interface TestConnectOkMessage {
	type: "TEST_CONNECT_OK";
	hostId: string;
}

/** Hub → UI: test connectivity failed */
export interface TestConnectFailMessage {
	type: "TEST_CONNECT_FAIL";
	hostId: string;
	message: string;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

/** All messages that the Agent sends to the Hub */
export type AgentMessage =
	| HelloMessage
	| AgentSpawnOkMessage
	| AgentSpawnErrMessage
	| OutputMessage
	| AgentSnapshotResMessage
	| AgentAttachOkMessage
	| ChannelExitMessage
	| HeartbeatAckMessage
	| AgentChannelStateMessage
	| ChannelStateEndMessage
	| AgentTitleChangeMessage
	| AgentProcessTitleMessage
	| AgentBellMessage
	| AgentNotificationMessage
	| ErrorMessage;

/** All messages that the Hub sends to the Agent */
export type HubToAgentMessage =
	| AgentSpawnMessage
	| InputMessage
	| ResizeMessage
	| SnapshotReqMessage
	| AgentAttachMessage
	| DestroyMessage
	| HeartbeatMessage
	| ErrorMessage;

/** All messages that the UI sends to the Hub */
export type UiMessage =
	| AuthMessage
	| UiSpawnMessage
	| UiAttachMessage
	| DetachMessage
	| InputMessage
	| ResizeMessage
	| WriteClaimMessage
	| WriteReleaseMessage
	| WriteForceMessage
	| WriteGrantMessage
	| WriteDenyMessage
	| PingMessage
	| HostVerifyResponseMessage
	| AuthPromptResponseMessage
	| TestConnectMessage
	| ErrorMessage;

/** All messages that the Hub sends to the UI */
export type HubToUiMessage =
	| AuthOkMessage
	| AuthFailMessage
	| UiSpawnOkMessage
	| UiAttachOkMessage
	| OutputMessage
	| SessionStateMessage
	| ChannelStateMessage
	| StateSyncMessage
	| WriteRequestMessage
	| WriteGrantMessage
	| WriteDenyMessage
	| WriteRevokedMessage
	| WriteLockMessage
	| AgentTitleChangeMessage
	| AgentProcessTitleMessage
	| AgentBellMessage
	| AgentNotificationMessage
	| PongMessage
	| HostVerifyMessage
	| AuthPromptMessage
	| TestConnectOkMessage
	| TestConnectFailMessage
	| ErrorMessage;

/** Master union of every distinct protocol message type */
export type ProtocolMessage =
	| HelloMessage
	| AgentSpawnMessage
	| AgentSpawnOkMessage
	| AgentSpawnErrMessage
	| InputMessage
	| OutputMessage
	| ResizeMessage
	| SnapshotReqMessage
	| AgentSnapshotResMessage
	| AgentAttachMessage
	| AgentAttachOkMessage
	| ChannelExitMessage
	| DestroyMessage
	| HeartbeatMessage
	| HeartbeatAckMessage
	| AuthMessage
	| AuthOkMessage
	| AuthFailMessage
	| UiSpawnMessage
	| UiSpawnOkMessage
	| UiAttachMessage
	| UiAttachOkMessage
	| DetachMessage
	| WriteClaimMessage
	| WriteReleaseMessage
	| WriteForceMessage
	| WriteRequestMessage
	| WriteGrantMessage
	| WriteDenyMessage
	| WriteRevokedMessage
	| WriteLockMessage
	| SessionStateMessage
	| ChannelStateMessage
	| StateSyncMessage
	| PingMessage
	| PongMessage
	| HostVerifyMessage
	| HostVerifyResponseMessage
	| AuthPromptMessage
	| AuthPromptResponseMessage
	| AgentChannelStateMessage
	| ChannelStateEndMessage
	| AgentTitleChangeMessage
	| AgentProcessTitleMessage
	| AgentBellMessage
	| AgentNotificationMessage
	| TestConnectMessage
	| TestConnectOkMessage
	| TestConnectFailMessage
	| ErrorMessage;
