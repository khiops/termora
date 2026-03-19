import type Database from "better-sqlite3";

import type { PairingCodeRow } from "./meta-types.js";

// ─── PairingCodesDAL ─────────────────────────────────────────────────────────

export class PairingCodesDAL {
	constructor(private db: Database.Database) {}

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
