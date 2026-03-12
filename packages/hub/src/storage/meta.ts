import type {
	Channel,
	ChannelGroup,
	ChannelStatus,
	ElevationMethod,
	Host,
	HostGroup,
	HostLaunchProfileOverride,
	LaunchProfile,
	LaunchProfileMode,
	Session,
	SessionStatus,
	SshAuthMethod,
	SupportedOs,
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
	hostGroup?: string | null;
	hostGroupId?: string | null;
	sortOrder?: number;
	sshConfigHost?: string | null;
	sshUser?: string | null;
	keepAliveSeconds?: number;
	historyRetentionDays?: number;
	elevationMethod?: ElevationMethod | null;
	customCommand?: string | null;
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
	launchProfileId?: string;
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
	host_group: string | null;
	host_group_id: string | null;
	sort_order: number;
	ssh_config_host: string | null;
	ssh_user: string | null;
	keep_alive_seconds: number;
	history_retention_days: number;
	discovered_shells: string | null;
	discovered_shells_at: string | null;
	elevation_method: string | null;
	custom_command: string | null;
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
	process_title: string | null;
	launch_profile_id: string | null;
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
		sortOrder: row.sort_order,
		keepAliveSeconds: row.keep_alive_seconds,
		historyRetentionDays: row.history_retention_days,
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
	if (row.host_group != null) host.hostGroup = row.host_group;
	if (row.host_group_id != null) host.hostGroupId = row.host_group_id;
	if (row.ssh_config_host != null) host.sshConfigHost = row.ssh_config_host;
	if (row.ssh_user != null) host.sshUser = row.ssh_user;
	if (row.discovered_shells != null) {
		try {
			host.discoveredShells = JSON.parse(row.discovered_shells) as string[];
		} catch {
			// ignore malformed JSON
		}
	}
	if (row.discovered_shells_at != null) host.discoveredShellsAt = row.discovered_shells_at;
	if (row.elevation_method != null) host.elevationMethod = row.elevation_method as ElevationMethod;
	if (row.custom_command != null) host.customCommand = row.custom_command;
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
	if (row.process_title != null) ch.processTitle = row.process_title;
	if (row.launch_profile_id != null) ch.launchProfileId = row.launch_profile_id;
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

interface HostGroupRow {
	id: string;
	name: string;
	sort_order: number;
	color: string | null;
	created_at: string;
	updated_at: string;
}

function rowToHostGroup(row: HostGroupRow): HostGroup {
	return {
		id: row.id,
		name: row.name,
		sortOrder: row.sort_order,
		color: row.color,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// ─── Launch Profile row types ────────────────────────────────────────────────

interface LaunchProfileRow {
	id: string;
	name: string;
	shell: string;
	args_json: string | null;
	cwd: string | null;
	env_json: string | null;
	mode: string;
	elevated: number;
	supported_os: string;
	icon_type: string;
	icon_value: string | null;
	color: string | null;
	profile_overrides_json: string | null;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

interface HostLaunchProfileRow {
	host_id: string;
	profile_id: string;
	override_type: string;
	sort_order: number | null;
}

function rowToLaunchProfile(row: LaunchProfileRow): LaunchProfile {
	const profile: LaunchProfile = {
		id: row.id,
		name: row.name,
		shell: row.shell,
		mode: row.mode as LaunchProfileMode,
		elevated: row.elevated !== 0,
		supportedOs: row.supported_os as SupportedOs,
		iconType: row.icon_type as LaunchProfile["iconType"],
		sortOrder: row.sort_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.args_json != null) {
		try {
			const parsed = JSON.parse(row.args_json) as string[];
			if (parsed.length > 0) profile.args = parsed;
		} catch {
			// ignore malformed JSON
		}
	}
	if (row.cwd != null) profile.cwd = row.cwd;
	if (row.env_json != null) {
		try {
			profile.env = JSON.parse(row.env_json) as Record<string, string>;
		} catch {
			// ignore malformed JSON
		}
	}
	if (row.icon_value != null) profile.iconValue = row.icon_value;
	if (row.color != null) profile.color = row.color;
	if (row.profile_overrides_json != null) {
		try {
			// Cast via unknown to avoid exactOptionalPropertyTypes constraint on `| undefined`
			profile.profileOverrides = JSON.parse(row.profile_overrides_json) as NonNullable<
				LaunchProfile["profileOverrides"]
			>;
		} catch {
			// ignore malformed JSON
		}
	}
	return profile;
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
					default_shell, default_cwd,
					host_group, host_group_id, sort_order, ssh_config_host, ssh_user,
					keep_alive_seconds, history_retention_days,
					elevation_method, custom_command,
					created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?,
					?, ?,
					?, ?, ?, ?, ?,
					?, ?,
					?, ?,
					?, ?
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
				input.hostGroup ?? null,
				input.hostGroupId ?? null,
				input.sortOrder ?? 0,
				input.sshConfigHost ?? null,
				input.sshUser ?? null,
				input.keepAliveSeconds ?? 60,
				input.historyRetentionDays ?? 30,
				input.elevationMethod ?? null,
				input.customCommand ?? null,
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
		const rows = this.db
			.prepare(
				`SELECT * FROM hosts ORDER BY
				CASE WHEN type = 'local' THEN 0 ELSE 1 END,
				COALESCE(host_group, '~') ASC, -- '~' sorts after all alphanumeric chars in ASCII, placing ungrouped hosts last
				sort_order ASC`,
			)
			.all() as HostRow[];
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
			hostGroup: "host_group",
			hostGroupId: "host_group_id",
			sortOrder: "sort_order",
			sshConfigHost: "ssh_config_host",
			sshUser: "ssh_user",
			keepAliveSeconds: "keep_alive_seconds",
			historyRetentionDays: "history_retention_days",
			elevationMethod: "elevation_method",
			customCommand: "custom_command",
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

	importHosts(inputs: CreateHostInput[]): Host[] {
		const txn = this.db.transaction(() => {
			return inputs.map((input) => this.createHost(input));
		});
		return txn();
	}

	reorderHosts(groupId: string | null, hostIds: string[]): void {
		const txn = this.db.transaction(() => {
			for (let i = 0; i < hostIds.length; i++) {
				this.db
					.prepare(
						"UPDATE hosts SET sort_order = ?, host_group_id = ?, updated_at = ? WHERE id = ?",
					)
					.run(i, groupId, new Date().toISOString(), hostIds[i]);
			}
		});
		txn();
	}

	duplicateHost(id: string): Host | null {
		const original = this.getHost(id);
		if (!original) return null;
		if (original.type === "local") return null; // cannot duplicate local host

		// Find unique label: "label-copy", "label-copy-2", etc.
		let suffix = "-copy";
		let attempt = 1;
		while (this.getHostByLabel(original.label + suffix)) {
			attempt++;
			suffix = `-copy-${attempt}`;
		}

		return this.createHost({
			type: original.type,
			label: original.label + suffix,
			...(original.sshHost !== undefined && { sshHost: original.sshHost }),
			...(original.sshPort !== undefined && { sshPort: original.sshPort }),
			...(original.sshAuth !== undefined && { sshAuth: original.sshAuth }),
			...(original.sshKeyPath !== undefined && { sshKeyPath: original.sshKeyPath }),
			...(original.iconType !== undefined && { iconType: original.iconType }),
			...(original.iconValue !== undefined && { iconValue: original.iconValue }),
			...(original.color !== undefined && { color: original.color }),
			...(original.profileJson !== undefined && { profileJson: original.profileJson }),
			...(original.trustRemoteHints !== undefined && {
				trustRemoteHints: original.trustRemoteHints,
			}),
			...(original.defaultShell !== undefined && { defaultShell: original.defaultShell }),
			...(original.defaultCwd !== undefined && { defaultCwd: original.defaultCwd }),
			...(original.hostGroup != null && { hostGroup: original.hostGroup }),
			...(original.sshConfigHost != null && { sshConfigHost: original.sshConfigHost }),
			...(original.sshUser != null && { sshUser: original.sshUser }),
			keepAliveSeconds: original.keepAliveSeconds,
			historyRetentionDays: original.historyRetentionDays,
		});
	}

	renameHostGroup(oldName: string, newName: string): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE hosts SET host_group = ?, updated_at = ? WHERE host_group = ?")
			.run(newName, now, oldName);
		return result.changes;
	}

	deleteHostGroup(name: string): number {
		const now = new Date().toISOString();
		const result = this.db
			.prepare("UPDATE hosts SET host_group = NULL, updated_at = ? WHERE host_group = ?")
			.run(now, name);
		return result.changes;
	}

	listHostGroups(): string[] {
		const rows = this.db
			.prepare(
				"SELECT DISTINCT host_group FROM hosts WHERE host_group IS NOT NULL ORDER BY host_group ASC",
			)
			.all() as Array<{ host_group: string }>;
		return rows.map((r) => r.host_group);
	}

	// ─── Host Groups (first-class) ───────────────────────────────────────────

	listHostGroupEntities(): HostGroup[] {
		const rows = this.db
			.prepare("SELECT * FROM host_groups ORDER BY sort_order ASC, name ASC")
			.all() as HostGroupRow[];
		return rows.map(rowToHostGroup);
	}

	createHostGroup(name: string, color?: string | null): HostGroup {
		const now = new Date().toISOString();
		const id = generateId();

		const maxRow = this.db
			.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM host_groups")
			.get() as { next_sort: number };
		const sortOrder = maxRow.next_sort;

		this.db
			.prepare(
				`INSERT INTO host_groups (id, name, sort_order, color, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(id, name, sortOrder, color ?? null, now, now);

		return rowToHostGroup(
			this.db.prepare("SELECT * FROM host_groups WHERE id = ?").get(id) as HostGroupRow,
		);
	}

	getHostGroupEntity(id: string): HostGroup | null {
		const row = this.db.prepare("SELECT * FROM host_groups WHERE id = ?").get(id) as
			| HostGroupRow
			| undefined;
		return row ? rowToHostGroup(row) : null;
	}

	updateHostGroup(id: string, fields: { name?: string; color?: string | null }): HostGroup | null {
		const now = new Date().toISOString();
		const setClauses: string[] = ["updated_at = ?"];
		const values: unknown[] = [now];

		if (fields.name !== undefined) {
			setClauses.push("name = ?");
			values.push(fields.name);
		}
		if ("color" in fields) {
			setClauses.push("color = ?");
			values.push(fields.color ?? null);
		}

		values.push(id);
		const result = this.db
			.prepare(`UPDATE host_groups SET ${setClauses.join(", ")} WHERE id = ?`)
			.run(...values);

		if (result.changes === 0) return null;
		return rowToHostGroup(
			this.db.prepare("SELECT * FROM host_groups WHERE id = ?").get(id) as HostGroupRow,
		);
	}

	deleteHostGroupEntity(id: string): boolean {
		// ON DELETE SET NULL handles hosts.host_group_id automatically
		const result = this.db.prepare("DELETE FROM host_groups WHERE id = ?").run(id);
		return result.changes > 0;
	}

	reorderHostGroups(groupIds: string[]): void {
		const now = new Date().toISOString();
		const txn = this.db.transaction(() => {
			for (let i = 0; i < groupIds.length; i++) {
				this.db
					.prepare("UPDATE host_groups SET sort_order = ?, updated_at = ? WHERE id = ?")
					.run(i, now, groupIds[i]);
			}
		});
		txn();
	}

	migrateHostGroupData(): void {
		const txn = this.db.transaction(() => {
			// Find distinct legacy host_group strings
			const distinctGroups = this.db
				.prepare(
					"SELECT DISTINCT host_group FROM hosts WHERE host_group IS NOT NULL AND host_group != ''",
				)
				.all() as Array<{ host_group: string }>;

			const now = new Date().toISOString();
			for (const { host_group } of distinctGroups) {
				// Check if an entity already exists for this name
				const existing = this.db
					.prepare("SELECT id FROM host_groups WHERE name = ?")
					.get(host_group) as { id: string } | undefined;
				if (!existing) {
					const newId = generateId();
					const maxRow = this.db
						.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM host_groups")
						.get() as { next_sort: number };
					this.db
						.prepare(
							`INSERT INTO host_groups (id, name, sort_order, color, created_at, updated_at)
							VALUES (?, ?, ?, NULL, ?, ?)`,
						)
						.run(newId, host_group, maxRow.next_sort, now, now);
				}
			}

			// Update host_group_id for all hosts that have a legacy host_group
			this.db
				.prepare(
					`UPDATE hosts
					SET host_group_id = (SELECT id FROM host_groups WHERE name = hosts.host_group)
					WHERE host_group IS NOT NULL AND host_group != '' AND host_group_id IS NULL`,
				)
				.run();
		});
		txn();
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

	reorderGroups(hostId: string, groupIds: string[]): void {
		// Validate all groups belong to the given host before mutating
		const existing = this.db
			.prepare("SELECT id FROM channel_groups WHERE host_id = ?")
			.all(hostId) as { id: string }[];
		const ownedIds = new Set(existing.map((r) => r.id));
		for (const id of groupIds) {
			if (!ownedIds.has(id)) {
				throw new Error(`Group ${id} does not belong to host ${hostId}`);
			}
		}
		const txn = this.db.transaction(() => {
			for (let i = 0; i < groupIds.length; i++) {
				this.db
					.prepare("UPDATE channel_groups SET sort_order = ? WHERE id = ?")
					.run(i, groupIds[i]);
			}
		});
		txn();
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
					icon, direct_process, launch_profile_id, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				input.launchProfileId ?? null,
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
						.prepare("SELECT * FROM channels WHERE session_id = ? ORDER BY created_at ASC")
						.all(sessionId)
				: this.db.prepare("SELECT * FROM channels ORDER BY created_at ASC").all()
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

	updateProcessTitle(channelId: string, title: string): void {
		const now = new Date().toISOString();
		this.db
			.prepare("UPDATE channels SET process_title = ?, updated_at = ? WHERE id = ?")
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
		this.db.prepare("DELETE FROM cache_index WHERE channel_id = ?").run(id);
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

	// ─── Launch Profiles ─────────────────────────────────────────────────────

	createLaunchProfile(input: Omit<LaunchProfile, "id" | "createdAt" | "updatedAt">): LaunchProfile {
		const now = new Date().toISOString();
		const id = generateId();

		this.db
			.prepare(
				`INSERT INTO launch_profiles (
					id, name, shell, args_json, cwd, env_json, mode, elevated,
					supported_os, icon_type, icon_value, color, profile_overrides_json,
					sort_order, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.name,
				input.shell,
				input.args && input.args.length > 0 ? JSON.stringify(input.args) : null,
				input.cwd ?? null,
				input.env ? JSON.stringify(input.env) : null,
				input.mode,
				input.elevated ? 1 : 0,
				input.supportedOs,
				input.iconType,
				input.iconValue ?? null,
				input.color ?? null,
				input.profileOverrides ? JSON.stringify(input.profileOverrides) : null,
				input.sortOrder,
				now,
				now,
			);

		return this.getLaunchProfile(id) as LaunchProfile;
	}

	getLaunchProfile(id: string): LaunchProfile | undefined {
		const row = this.db.prepare("SELECT * FROM launch_profiles WHERE id = ?").get(id) as
			| LaunchProfileRow
			| undefined;
		return row ? rowToLaunchProfile(row) : undefined;
	}

	getLaunchProfileByName(name: string): LaunchProfile | undefined {
		const row = this.db
			.prepare("SELECT * FROM launch_profiles WHERE name = ? COLLATE NOCASE")
			.get(name) as LaunchProfileRow | undefined;
		return row ? rowToLaunchProfile(row) : undefined;
	}

	listLaunchProfiles(): LaunchProfile[] {
		const rows = this.db
			.prepare("SELECT * FROM launch_profiles ORDER BY sort_order ASC, name ASC")
			.all() as LaunchProfileRow[];
		return rows.map(rowToLaunchProfile);
	}

	updateLaunchProfile(id: string, updates: Partial<LaunchProfile>): LaunchProfile | undefined {
		const existing = this.getLaunchProfile(id);
		if (!existing) return undefined;

		const now = new Date().toISOString();

		const fieldMap: Record<string, string> = {
			name: "name",
			shell: "shell",
			cwd: "cwd",
			mode: "mode",
			elevated: "elevated",
			supportedOs: "supported_os",
			iconType: "icon_type",
			iconValue: "icon_value",
			color: "color",
			sortOrder: "sort_order",
		};

		const setClauses: string[] = ["updated_at = ?"];
		const values: unknown[] = [now];

		for (const [camel, snake] of Object.entries(fieldMap)) {
			if (camel in updates) {
				setClauses.push(`${snake} = ?`);
				const val = updates[camel as keyof LaunchProfile];
				if (camel === "elevated") {
					values.push(val ? 1 : 0);
				} else {
					values.push(val !== undefined ? val : null);
				}
			}
		}

		if ("args" in updates) {
			setClauses.push("args_json = ?");
			values.push(updates.args && updates.args.length > 0 ? JSON.stringify(updates.args) : null);
		}
		if ("env" in updates) {
			setClauses.push("env_json = ?");
			values.push(updates.env ? JSON.stringify(updates.env) : null);
		}
		if ("profileOverrides" in updates) {
			setClauses.push("profile_overrides_json = ?");
			values.push(updates.profileOverrides ? JSON.stringify(updates.profileOverrides) : null);
		}

		values.push(id);
		this.db
			.prepare(`UPDATE launch_profiles SET ${setClauses.join(", ")} WHERE id = ?`)
			.run(...values);

		return this.getLaunchProfile(id);
	}

	deleteLaunchProfile(id: string): boolean {
		const result = this.db.prepare("DELETE FROM launch_profiles WHERE id = ?").run(id);
		return result.changes > 0;
	}

	reorderLaunchProfiles(ids: string[]): void {
		const now = new Date().toISOString();
		const txn = this.db.transaction(() => {
			for (let i = 0; i < ids.length; i++) {
				this.db
					.prepare("UPDATE launch_profiles SET sort_order = ?, updated_at = ? WHERE id = ?")
					.run(i, now, ids[i]);
			}
		});
		txn();
	}

	listHostProfiles(
		hostId: string,
		hostOs: string,
	): Array<LaunchProfile & { overrideType?: string; effectiveSort: number }> {
		const rows = this.db
			.prepare(
				`SELECT p.*, hlp.override_type,
				        COALESCE(hlp.sort_order, p.sort_order) AS effective_sort
				 FROM launch_profiles p
				 LEFT JOIN host_launch_profiles hlp
				     ON p.id = hlp.profile_id AND hlp.host_id = ?
				 WHERE
				     hlp.override_type = 'pin'
				     OR hlp.override_type = 'default'
				     OR (
				         p.supported_os IN ('any', ?)
				         AND (hlp.override_type IS NULL OR hlp.override_type != 'hide')
				     )
				 ORDER BY
				     CASE WHEN hlp.override_type = 'default' THEN 0 ELSE 1 END,
				     effective_sort,
				     p.name`,
			)
			.all(hostId, hostOs) as Array<
			LaunchProfileRow & { override_type: string | null; effective_sort: number }
		>;

		return rows.map((row) => {
			const profile = rowToLaunchProfile(row);
			const result: LaunchProfile & { overrideType?: string; effectiveSort: number } = {
				...profile,
				effectiveSort: row.effective_sort,
			};
			if (row.override_type != null) result.overrideType = row.override_type;
			return result;
		});
	}

	upsertHostProfileOverride(
		hostId: string,
		profileId: string,
		overrideType: string,
		sortOrder?: number,
	): void {
		const txn = this.db.transaction(() => {
			if (overrideType === "default") {
				// Enforce one-default-per-host invariant: remove any existing default for this host
				this.db
					.prepare(
						"DELETE FROM host_launch_profiles WHERE host_id = ? AND override_type = 'default'",
					)
					.run(hostId);
			}
			this.db
				.prepare(
					`INSERT INTO host_launch_profiles (host_id, profile_id, override_type, sort_order)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(host_id, profile_id) DO UPDATE SET
					     override_type = excluded.override_type,
					     sort_order = excluded.sort_order`,
				)
				.run(hostId, profileId, overrideType, sortOrder ?? null);
		});
		txn();
	}

	deleteHostProfileOverride(hostId: string, profileId: string): boolean {
		const result = this.db
			.prepare("DELETE FROM host_launch_profiles WHERE host_id = ? AND profile_id = ?")
			.run(hostId, profileId);
		return result.changes > 0;
	}

	updateHostDiscoveredShells(hostId: string, shells: string[], defaultShell?: string): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE hosts
				 SET discovered_shells = ?, discovered_shells_at = ?, updated_at = ?
				 WHERE id = ?`,
			)
			.run(JSON.stringify(shells), now, now, hostId);
		if (defaultShell !== undefined) {
			this.db
				.prepare("UPDATE hosts SET default_shell = ?, updated_at = ? WHERE id = ?")
				.run(defaultShell, now, hostId);
		}
	}

	getHostLaunchProfileOverride(
		hostId: string,
		profileId: string,
	): HostLaunchProfileOverride | undefined {
		const row = this.db
			.prepare("SELECT * FROM host_launch_profiles WHERE host_id = ? AND profile_id = ?")
			.get(hostId, profileId) as HostLaunchProfileRow | undefined;
		if (!row) return undefined;
		const result: HostLaunchProfileOverride = {
			hostId: row.host_id,
			profileId: row.profile_id,
			overrideType: row.override_type as HostLaunchProfileOverride["overrideType"],
		};
		if (row.sort_order != null) result.sortOrder = row.sort_order;
		return result;
	}
}
