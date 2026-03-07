// In-memory TypeScript entity types for nexterm
// These represent the domain model; DB types are defined in hub/storage

export type SessionStatus = "starting" | "active" | "detached" | "disconnected" | "closed";
export type ChannelStatus = "born" | "live" | "orphan" | "dead";
export type HostType = "local" | "ssh";
export type SshAuthMethod = "agent" | "key" | "password";
export type IconType = "auto" | "emoji" | "image";
export type TrustPolicy = "apply" | "ask" | "ignore";

export interface Host {
	id: string; // ULID
	type: HostType;
	label: string;
	sshHost?: string;
	sshPort?: number;
	sshAuth?: SshAuthMethod;
	sshKeyPath?: string;
	iconType: IconType;
	iconValue?: string;
	color?: string; // hex #rrggbb
	profileJson?: string; // JSON string of TerminalProfile
	trustRemoteHints: TrustPolicy;
	defaultShell?: string;
	defaultCwd?: string;
	createdAt: string; // ISO 8601
	updatedAt: string;
}

export interface ChannelGroup {
	id: string;
	hostId: string;
	name: string;
	sortOrder: number;
	collapsed: boolean;
	createdAt: string;
}

export interface Session {
	id: string;
	hostId: string;
	status: SessionStatus;
	createdAt: string;
	updatedAt: string;
}

export interface Channel {
	id: string;
	sessionId: string;
	groupId?: string;
	title?: string;
	shell: string;
	args?: string[];
	cwd?: string;
	envJson?: string; // JSON string
	cols: number;
	rows: number;
	status: ChannelStatus;
	exitCode?: number;
	profileJson?: string;
	isWelcome?: boolean;
	icon?: string;
	directProcess?: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface Workspace {
	id: string;
	name: string;
	layoutJson: string; // JSON string of TabLayout
	createdAt: string;
	updatedAt: string;
}

export interface CacheIndex {
	channelId: string;
	lastSnapshotChunkId?: string;
	lastSeq: number;
	lastSeenAt: string;
}

export interface PairingCode {
	code: string;
	token: string;
	expiresAt: string;
	used: boolean;
}
