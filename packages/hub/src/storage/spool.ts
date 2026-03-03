import { generateId } from "@nexterm/shared";
import type Database from "better-sqlite3";

export interface InsertChunkInput {
	channelId: string;
	seq: number;
	kind: "output" | "snapshot" | "resize";
	codec?: "raw" | "zstd";
	dataBlob: Buffer;
	uncompressedLen: number;
}

export interface Chunk {
	id: string;
	channelId: string;
	seq: number;
	ts: string;
	kind: string;
	codec: string;
	dataBlob: Buffer;
	uncompressedLen: number;
}

interface ChunkRow {
	id: string;
	channel_id: string;
	seq: number;
	ts: string;
	kind: string;
	codec: string;
	data_blob: Buffer;
	uncompressed_len: number;
}

function rowToChunk(row: ChunkRow): Chunk {
	return {
		id: row.id,
		channelId: row.channel_id,
		seq: row.seq,
		ts: row.ts,
		kind: row.kind,
		codec: row.codec,
		dataBlob: row.data_blob,
		uncompressedLen: row.uncompressed_len,
	};
}

export class SpoolDAL {
	constructor(private db: Database.Database) {}

	insertChunk(input: InsertChunkInput): string {
		const id = generateId();
		const ts = new Date().toISOString();

		this.db
			.prepare(
				`INSERT INTO chunks (id, channel_id, seq, ts, kind, codec, data_blob, uncompressed_len)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.channelId,
				input.seq,
				ts,
				input.kind,
				input.codec ?? "raw",
				input.dataBlob,
				input.uncompressedLen,
			);

		return id;
	}

	getChunk(id: string): Chunk | undefined {
		const row = this.db.prepare("SELECT * FROM chunks WHERE id = ?").get(id) as
			| ChunkRow
			| undefined;
		return row ? rowToChunk(row) : undefined;
	}

	getChunksByChannel(
		channelId: string,
		opts?: { kind?: string; afterSeq?: number; limit?: number },
	): Chunk[] {
		const conditions: string[] = ["channel_id = ?"];
		const params: unknown[] = [channelId];

		if (opts?.kind !== undefined) {
			conditions.push("kind = ?");
			params.push(opts.kind);
		}
		if (opts?.afterSeq !== undefined) {
			conditions.push("seq > ?");
			params.push(opts.afterSeq);
		}

		let sql = `SELECT * FROM chunks WHERE ${conditions.join(" AND ")} ORDER BY seq ASC`;
		if (opts?.limit !== undefined) {
			sql += " LIMIT ?";
			params.push(opts.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as ChunkRow[];
		return rows.map(rowToChunk);
	}

	getLatestSnapshot(channelId: string): Chunk | undefined {
		const row = this.db
			.prepare(
				`SELECT * FROM chunks
				WHERE channel_id = ? AND kind = 'snapshot'
				ORDER BY seq DESC LIMIT 1`,
			)
			.get(channelId) as ChunkRow | undefined;
		return row ? rowToChunk(row) : undefined;
	}

	deleteChunksOlderThan(before: string): number {
		const result = this.db.prepare("DELETE FROM chunks WHERE ts < ?").run(before);
		return result.changes;
	}

	getChannelChunkCount(channelId: string): number {
		const row = this.db
			.prepare("SELECT COUNT(*) as count FROM chunks WHERE channel_id = ?")
			.get(channelId) as { count: number };
		return row.count;
	}
}
