import type {
	Channel,
	ChannelGroup,
	ChannelStatus,
	Host,
	Session,
	SessionStatus,
	SshAuthMethod,
} from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import type Database from "better-sqlite3";

export interface CreateHostInput {
	type: "local" | "ssh";
	label: string;
	sshHost?: string;
	sshPort?: number;
	sshAuth?: "agent" | "key" | "password";
	sshKeyPath?: string;
	iconType?: "auto" | "emoji" | "image";
	iconValue?: string;
	color?: string;
	profileJson?: string;
	trustRemoteHints?: "apply" | "ask" | "ignore";
	defaultShell?: string;
	defaultCwd?: string;
}

export interface CreateSessionInput {
	id: string;
	hostId: string;
	status: SessionStatus;
}

export interface CreateChannelInput {
	id: string;
	sessionId: string;
	status: ChannelStatus;
	shell?: string;
	args?: string[];
	cwd?: string;
	title?: string;
	cols?: number;
	rows?: number;
	icon?: string;
	directProcess?: boolean;
}

interface HostRow {
	id: string;
	type: string;
	label: string;
	ssh_host: string | null;
	ssh_port: number | null;
	ssh_auth: string | null;
	ssh_key_path: string | null;
	icon_type: string;
	icon_value: string | null;
	color: string | null;
	profile_json: string | null;
	trust_remote_hints: string;
	default_shell: string | null;
	default_cwd: string | null;
	created_at: string;
	updated_at: string;
}

interface SessionRow {
	id: string;
	host_id: string;
	status: string;
	created_at: string;
	updated_at: string;
}

interface ChannelRow {
	id: string;
	session_id: string;
	group_id: string | null;
	title: string | null;
	shell: string;
	args: string;
	cwd: string | null;
	env_json: string | null;
	cols: number;
	rows: number;
	status: string;
	exit_code: number | null;
	profile_json: string | null;
	is_welcome: number;
	icon: string | null;
	direct_process: number;
	dynamic_title: string | null;
	created_at: string;
	updated_at: string;
}

interface GroupRow {
	id: string;
	host_id: string;
	name: string;
	sort_order: number;
	collapsed: number;
	created_at: string;
}

export interface PairingCodeRow {
	id: string;
	code: string;
	created_at: string;
	expires_at: string;
	used: number;
	used_at: string | null;
	used_by_ip: string | null;
}

function rowToHost(row: HostRow): Host {
	const host: Host = {
		id: row.id,
		type: row.type as Host["type"],
		label: row.label,
		iconType: row.icon_type as Host["iconType"],
		trustRemoteHints: row.trust_remote_hints as Host["trustRemoteHints"],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.ssh_host != null) host.sshHost = row.ssh_host;
	if (row.ssh_port != null) host.sshPort = row.ssh_port;
	if (row.ssh_auth != null) host.sshAuth = row.ssh_auth as SshAuthMethod;
	if (row.ssh_key_path != null) host.sshKeyPath = row.ssh_key_path;
	if (row.icon_value != null) host.iconValue = row.icon_value;
	if (row.color != null) host.color = row.color;
	if (row.profile_json != null) host.profileJson = row.profile_json;
	if (row.default_shell != null) host.defaultShell = row.default_shell;
	if (row.default_cwd != null) host.defaultCwd = row.default_cwd;
	return host;
}

function rowToSession(row: SessionRow): Session {
	return {
		id: row.id,
		hostId: row.host_id,
		status: row.status as SessionStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToChannel(row: ChannelRow): Channel {
	const ch: Channel = {
		id: row.id,
		sessionId: row.session_id,
		shell: row.shell,
		cols: row.cols,
		rows: row.rows,
		status: row.status as ChannelStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.group_id != null) ch.groupId = row.group_id;
	if (row.title != null) ch.title = row.title;
	if (row.cwd != null) ch.cwd = row.cwd;
	if (row.env_json != null) ch.envJson = row.env_json;
	if (row.exit_code != null) ch.exitCode = row.exit_code;
	if (row.profile_json != null) ch.profileJson = row.profile_json;
	if (row.is_welcome === 1) ch.isWelcome = true;
	if (row.icon != null) ch.icon = row.icon;
	if (row.direct_process === 1) ch.directProcess = true;
	if (row.dynamic_title != null) ch.dynamicTitle = row.dynamic_title;
	if (row.args && row.args !== "[]") {
		try {
			const parsed = JSON.parse(row.args) as string[];
			if (parsed.length > 0) ch.args = parsed;
		} catch {
			// Ignore malformed JSON — treat as no args
		}
	}
	return ch;
}

function rowToGroup(row: GroupRow): ChannelGroup {
	return {
		id: row.id,
		hostId: row.host_id,
		name: row.name,
		sortOrder: row.sort_order,
		collapsed: row.collapsed !== 0,
		createdAt: row.created_at,
	};
}

export class MetaDAL {
	constructor(private db: Database.Database) {}

	// ─── Hosts ──────────────────────────────────────────────────────────────

	createHost(input: CreateHostInput): Host {
		const now = new Date().toISOString();
		const id = generateId();

		this.db
			.prepare(
				`INSERT INTO hosts (
					id, type, label, ssh_host, ssh_port, ssh_auth, ssh_key_path,
					icon_type, icon_value, color, profile_json, trust_remote_hints,
					default_shell, default_cwd, created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?,
					?, ?, ?, ?
				)`,
			)
			.run(
				id,
				input.type,
				input.label,
				input.sshHost ?? null,
				input.sshPort ?? null,
				input.sshAuth ?? null,
				input.sshKeyPath ?? null,
				input.iconType ?? "auto",
				input.iconValue ?? null,
				input.color ?? null,
				input.profileJson ?? null,
				input.trustRemoteHints ?? "apply",
				input.defaultShell ?? null,
				input.defaultCwd ?? null,
				now,
				now,
			);

		return this.getHost(id) as Host;
	}

	getHost(id: string): Host | undefined {
		const row = this.db.prepare("SELECT * FROM hosts WHERE id = ?").get(id) as HostRow | undefined;
		return row ? rowToHost(row) : undefined;
	}

	getHostByLabel(label: string): Host | undefined {
		const row = this.db.prepare("SELECT * FROM hosts WHERE label = ?").get(label) as
			| HostRow
			| undefined;
		return row ? rowToHost(row) : undefined;
	}

	listHosts(): Host[] {
		const rows = this.db.prepare("SELECT * FROM hosts ORDER BY created_at ASC").all() as HostRow[];
		return rows.map(rowToHost);
	}

	updateHost(id: string, input: Partial<CreateHostInput>): Host {
		const now = new Date().toISOString();

		const fieldMap: Record<string, string> = {
			type: "type",
			label: "label",
			sshHost: "ssh_host",
			sshPort: "ssh_port",
			sshAuth: "ssh_auth",
			sshKeyPath: "ssh_key_path",
			iconType: "icon_type",
			iconValue: "icon_value",
			color: "color",
			profileJson: "profile_json",
			trustRemoteHints: "trust_remote_hints",
			defaultShell: "default_shell",
			defaultCwd: "default_cwd",
		};

		const setClauses: string[] = ["updated_at = ?"];
		const values: unknown[] = [now];

		for (const [camel, snake] of Object.entries(fieldMap)) {
			if (camel in input) {
				setClauses.push(`${snake} = ?`);
				const val = input[camel as keyof CreateHostInput];
				values.push(val !== undefined ? val : null);
			}
		}

		values.push(id);

		this.db.prepare(`UPDATE hosts SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);

		const updated = this.getHost(id);
		if (!updated) {
			throw new Error(`Host not found after update: ${id}`);
		}
		return updated;
	}

	deleteHost(id: string): boolean {
		const result = this.db.prepare("DELETE FROM hosts WHERE id = ?").run(id);
		return result.changes > 0;
	}

	// ─── Groups ─────────────────────────────────────────────────────────────

	listGroups(hostId: string): ChannelGroup[] {
		const rows = this.db
			.prepare("SELECT * FROM channel_groups WHERE host_id = ? ORDER BY sort_order ASC")
			.all(hostId) as GroupRow[];
		return rows.map(rowToGroup);
	}

	createGroup(hostId: string, name: string): ChannelGroup {
		const now = new Date().toISOString();
		const id = generateId();

		const maxRow = this.db
			.prepare("SELECT MAX(sort_order) AS max_sort FROM channel_groups WHERE host_id = ?")
			.get(hostId) as { max_sort: number | null } | undefined;
		const sortOrder = (maxRow?.max_sort ?? -1) + 1;

		this.db
			.prepare(
				`INSERT INTO channel_groups (id, host_id, name, sort_order, collapsed, created_at)
				 VALUES (?, ?, ?, ?, 0, ?)`,
			)
			.run(id, hostId, name, sortOrder, now);

		const row = this.db.prepare("SELECT * FROM channel_groups WHERE id = ?").get(id) as GroupRow;
		return rowToGroup(row);
	}

	renameGroup(id: string, name: string): boolean {
		const result = this.db.prepare("UPDATE channel_groups SET name = ? WHERE id = ?").run(name, id);
		return result.changes > 0;
	}

	deleteGroup(id: string): boolean {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE channels SET group_id = NULL, updated_at = ? WHERE group_id = ?")
			.run(now, id);
		const result = this.db.prepare("DELETE FROM channel_groups WHERE id = ?").run(id);
		return result.changes > 0;
	}

	updateChannelGroupId(channelId: string, groupId: string | null): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET group_id = ?, updated_at = ? WHERE id = ?")
			.run(groupId, now, channelId);
		return result.changes > 0;
	}

	// ─── Sessions ───────────────────────────────────────────────────────────

	createSession(input: CreateSessionInput): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO sessions (id, host_id, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(input.id, input.hostId, input.status, now, now);
	}

	getSession(id: string): Session | undefined {
		const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
			| SessionRow
			| undefined;
		return row ? rowToSession(row) : undefined;
	}

	listSessions(hostId?: string): Session[] {
		const rows = (
			hostId
				? this.db
						.prepare("SELECT * FROM sessions WHERE host_id = ? ORDER BY created_at ASC")
						.all(hostId)
				: this.db.prepare("SELECT * FROM sessions ORDER BY created_at ASC").all()
		) as SessionRow[];
		return rows.map(rowToSession);
	}

	updateSessionStatus(id: string, status: SessionStatus): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
			.run(status, now, id);
	}

	deleteSession(id: string): void {
		this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	}

	// ─── Channels ───────────────────────────────────────────────────────────

	createChannel(input: CreateChannelInput): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO channels (
					id, session_id, shell, args, cwd, title, status, cols, rows,
					icon, direct_process, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.id,
				input.sessionId,
				input.shell ?? "/bin/sh",
				input.args ? JSON.stringify(input.args) : "[]",
				input.cwd ?? null,
				input.title ?? null,
				input.status,
				input.cols ?? 80,
				input.rows ?? 24,
				input.icon ?? null,
				input.directProcess ? 1 : 0,
				now,
				now,
			);
	}

	getChannel(id: string): Channel | undefined {
		const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as
			| ChannelRow
			| undefined;
		return row ? rowToChannel(row) : undefined;
	}

	/** Look up a channel along with its host info (needed for respawn). */
	getChannelWithHost(
		channelId: string,
	): { channel: Channel; hostId: string; hostType: string } | null {
		const row = this.db
			.prepare(
				`SELECT c.*, s.host_id, h.type AS host_type
				 FROM channels c
				 JOIN sessions s ON c.session_id = s.id
				 JOIN hosts h ON s.host_id = h.id
				 WHERE c.id = ?`,
			)
			.get(channelId) as (ChannelRow & { host_id: string; host_type: string }) | undefined;
		if (!row) return null;
		return {
			channel: rowToChannel(row),
			hostId: row.host_id,
			hostType: row.host_type,
		};
	}

	listChannels(sessionId?: string): Channel[] {
		const rows = (
			sessionId
				? this.db
						.prepare(
							"SELECT * FROM channels WHERE session_id = ? AND status != 'dead' ORDER BY created_at ASC",
						)
						.all(sessionId)
				: this.db
						.prepare("SELECT * FROM channels WHERE status != 'dead' ORDER BY created_at ASC")
						.all()
		) as ChannelRow[];
		return rows.map(rowToChannel);
	}

	updateChannelStatus(id: string, status: ChannelStatus, exitCode?: number): void {
		const now = new Date().toISOString();
		if (exitCode !== undefined) {
			this.db
				.prepare("UPDATE channels SET status = ?, exit_code = ?, updated_at = ? WHERE id = ?")
				.run(status, exitCode, now, id);
		} else {
			this.db
				.prepare("UPDATE channels SET status = ?, updated_at = ? WHERE id = ?")
				.run(status, now, id);
		}
	}

	updateChannelDimensions(id: string, cols: number, rows: number): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET cols = ?, rows = ?, updated_at = ? WHERE id = ?")
			.run(cols, rows, now, id);
		return result.changes > 0;
	}

	updateChannelTitle(id: string, title: string | null): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET title = ?, updated_at = ? WHERE id = ?")
			.run(title, now, id);
		return result.changes > 0;
	}

	updateDynamicTitle(channelId: string, title: string): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE channels SET dynamic_title = ?, updated_at = ? WHERE id = ?")
			.run(title, now, channelId);
	}

	updateChannelConfig(
		channelId: string,
		config: {
			icon?: string | null;
			shell?: string | null;
			args?: string[];
			cwd?: string | null;
			directProcess?: boolean;
		},
	): boolean {
		const sets: string[] = [];
		const params: Record<string, unknown> = { id: channelId };

		if (config.icon !== undefined) {
			sets.push("icon = @icon");
			params.icon = config.icon;
		}
		if (config.shell !== undefined) {
			sets.push("shell = @shell");
			params.shell = config.shell ?? "/bin/sh";
		}
		if (config.args !== undefined) {
			sets.push("args = @args");
			params.args = JSON.stringify(config.args);
		}
		if (config.cwd !== undefined) {
			sets.push("cwd = @cwd");
			params.cwd = config.cwd;
		}
		if (config.directProcess !== undefined) {
			sets.push("direct_process = @directProcess");
			params.directProcess = config.directProcess ? 1 : 0;
		}

		if (sets.length === 0) return false;

		const now = new Date().toISOString();
		sets.push("updated_at = @updatedAt");
		params.updatedAt = now;

		const result = this.db
			.prepare(`UPDATE channels SET ${sets.join(", ")} WHERE id = @id`)
			.run(params);
		return result.changes > 0;
	}

	deleteChannel(id: string): void {
		this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
	}

	// ─── Profile JSON helpers ─────────────────────────────────────────────────

	getHostProfile(id: string): string | null {
		const row = this.db.prepare("SELECT profile_json FROM hosts WHERE id = ?").get(id) as
			| { profile_json: string | null }
			| undefined;
		return row?.profile_json ?? null;
	}

	updateHostProfile(id: string, profileJson: string | null): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE hosts SET profile_json = ?, updated_at = ? WHERE id = ?")
			.run(profileJson, now, id);
		return result.changes > 0;
	}

	getChannelProfile(id: string): string | null {
		const row = this.db.prepare("SELECT profile_json FROM channels WHERE id = ?").get(id) as
			| { profile_json: string | null }
			| undefined;
		return row?.profile_json ?? null;
	}

	updateChannelProfile(id: string, profileJson: string | null): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET profile_json = ?, updated_at = ? WHERE id = ?")
			.run(profileJson, now, id);
		return result.changes > 0;
	}

	// ─── Welcome Channel ──────────────────────────────────────────────────

	/** Set a channel as welcome tab for its host. Clears any previous welcome on the same host. */
	setWelcomeChannel(channelId: string): boolean {
		const row = this.db
			.prepare(
				`SELECT s.host_id FROM channels c
				 JOIN sessions s ON c.session_id = s.id
				 WHERE c.id = ?`,
			)
			.get(channelId) as { host_id: string } | undefined;
		if (!row) return false;

		const now = new Date().toISOString();
		const txn = this.db.transaction(() => {
			// Clear existing welcome for this host
			this.db
				.prepare(
					`UPDATE channels SET is_welcome = 0, updated_at = ?
					 WHERE is_welcome = 1
					   AND session_id IN (SELECT id FROM sessions WHERE host_id = ?)`,
				)
				.run(now, row.host_id);
			// Set new welcome
			this.db
				.prepare("UPDATE channels SET is_welcome = 1, updated_at = ? WHERE id = ?")
				.run(now, channelId);
		});
		txn();
		return true;
	}

	/** Clear welcome status for a channel. */
	clearWelcomeChannel(channelId: string): boolean {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET is_welcome = 0, updated_at = ? WHERE id = ?")
			.run(now, channelId);
		return result.changes > 0;
	}

	/** Get the welcome channel for a host (if any). */
	getWelcomeChannel(hostId: string): Channel | undefined {
		const row = this.db
			.prepare(
				`SELECT c.* FROM channels c
				 JOIN sessions s ON c.session_id = s.id
				 WHERE s.host_id = ? AND c.is_welcome = 1
				 LIMIT 1`,
			)
			.get(hostId) as ChannelRow | undefined;
		return row ? rowToChannel(row) : undefined;
	}

	markAllChannelsDead(): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE channels SET status = 'dead', updated_at = ? WHERE status != 'dead'")
			.run(now);
		return result.changes;
	}

	markAllSessionsClosed(): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE sessions SET status = 'closed', updated_at = ? WHERE status != 'closed'")
			.run(now);
		return result.changes;
	}

	// ─── Warm Restart ─────────────────────────────────────────────────────────

	/** Channels that were alive (not dead) when the hub last exited, with host info. */
	listAliveChannelsWithHost(): Array<{
		id: string;
		sessionId: string;
		shell: string;
		args: string[];
		cwd: string | null;
		cols: number;
		rows: number;
		status: string;
		hostId: string;
		hostType: string;
		directProcess: boolean;
	}> {
		const rows = this.db
			.prepare(
				`SELECT c.id, c.session_id, c.shell, c.args, c.cwd, c.cols, c.rows,
				        c.status, c.direct_process,
				        s.host_id, h.type AS host_type
				 FROM channels c
				 JOIN sessions s ON c.session_id = s.id
				 JOIN hosts h ON s.host_id = h.id
				 WHERE c.status != 'dead'`,
			)
			.all() as Array<{
			id: string;
			session_id: string;
			shell: string;
			args: string;
			cwd: string | null;
			cols: number;
			rows: number;
			status: string;
			direct_process: number;
			host_id: string;
			host_type: string;
		}>;
		return rows.map((r) => {
			let args: string[] = [];
			try {
				args = JSON.parse(r.args) as string[];
			} catch {
				// ignore
			}
			return {
				id: r.id,
				sessionId: r.session_id,
				shell: r.shell,
				args,
				cwd: r.cwd,
				cols: r.cols,
				rows: r.rows,
				status: r.status,
				hostId: r.host_id,
				hostType: r.host_type,
				directProcess: r.direct_process === 1,
			};
		});
	}

	/** Mark all non-dead channels for a host as orphan. */
	markHostChannelsOrphan(hostId: string): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare(
				`UPDATE channels SET status = 'orphan', updated_at = ?
				 WHERE status != 'dead'
				   AND session_id IN (SELECT id FROM sessions WHERE host_id = ?)`,
			)
			.run(now, hostId);
		return result.changes;
	}

	/** Mark non-closed sessions for a host as disconnected. */
	markHostSessionDisconnected(hostId: string): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare(
				`UPDATE sessions SET status = 'disconnected', updated_at = ?
				 WHERE host_id = ? AND status != 'closed'`,
			)
			.run(now, hostId);
		return result.changes;
	}

	// ─── GC helpers ─────────────────────────────────────────────────────────

	/** Dead channels whose updated_at is older than `before` (ISO 8601). */
	listStaleDeadChannelIds(before: string): string[] {
		return this.db
			.prepare("SELECT id FROM channels WHERE status = 'dead' AND updated_at < ?")
			.all(before)
			.map((r) => (r as { id: string }).id);
	}

	// ─── Cache Index ─────────────────────────────────────────────────────────

	updateCacheIndex(channelId: string, snapshotChunkId: string, lastSeq: number): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO cache_index (channel_id, last_snapshot_chunk_id, last_seq, last_seen_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(channel_id) DO UPDATE SET
					last_snapshot_chunk_id = excluded.last_snapshot_chunk_id,
					last_seq = excluded.last_seq,
					last_seen_at = excluded.last_seen_at`,
			)
			.run(channelId, snapshotChunkId, lastSeq, now);
	}

	// ─── Pairing Codes ───────────────────────────────────────────────────────

	createPairingCode(id: string, code: string, createdAt: string, expiresAt: string): void {
		this.db
			.prepare("INSERT INTO pairing_codes (id, code, created_at, expires_at) VALUES (?, ?, ?, ?)")
			.run(id, code, createdAt, expiresAt);
	}

	getPairingCodeByCode(code: string): PairingCodeRow | undefined {
		return this.db.prepare("SELECT * FROM pairing_codes WHERE code = ?").get(code) as
			| PairingCodeRow
			| undefined;
	}

	markPairingCodeUsed(id: string, usedAt: string, usedByIp: string): void {
		this.db
			.prepare("UPDATE pairing_codes SET used = 1, used_at = ?, used_by_ip = ? WHERE id = ?")
			.run(usedAt, usedByIp, id);
	}

	countActivePairingCodes(): number {
		const now = new Date().toISOString();
		const row = this.db
			.prepare("SELECT COUNT(*) as n FROM pairing_codes WHERE used = 0 AND expires_at > ?")
			.get(now) as { n: number };
		return row.n;
	}

	cleanExpiredPairingCodes(): void {
		const now = new Date().toISOString();
		this.db.prepare("DELETE FROM pairing_codes WHERE expires_at < ? AND used = 0").run(now);
	}
}
