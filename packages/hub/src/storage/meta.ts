import type { Host } from "@nexterm/shared";
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

function rowToHost(row: HostRow): Host {
	return {
		id: row.id,
		type: row.type as Host["type"],
		label: row.label,
		sshHost: row.ssh_host ?? undefined,
		sshPort: row.ssh_port ?? undefined,
		sshAuth: (row.ssh_auth as Host["sshAuth"]) ?? undefined,
		sshKeyPath: row.ssh_key_path ?? undefined,
		iconType: row.icon_type as Host["iconType"],
		iconValue: row.icon_value ?? undefined,
		color: row.color ?? undefined,
		profileJson: row.profile_json ?? undefined,
		trustRemoteHints: row.trust_remote_hints as Host["trustRemoteHints"],
		defaultShell: row.default_shell ?? undefined,
		defaultCwd: row.default_cwd ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class MetaDAL {
	constructor(private db: Database.Database) {}

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
}
