import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseManager } from "./db.js";
import { openTestDatabases } from "./db.js";
import { SpoolDAL } from "./spool.js";

// Helpers
function makeChunkInput(
	channelId: string,
	seq: number,
	kind: "output" | "snapshot" | "resize" = "output",
) {
	return {
		channelId,
		seq,
		kind,
		dataBlob: Buffer.from(`data-${seq}`),
		uncompressedLen: 10,
	};
}

describe("SpoolDAL", () => {
	let dbs: DatabaseManager;
	let dal: SpoolDAL;

	afterEach(() => {
		dbs?.close();
	});

	function setup() {
		dbs = openTestDatabases();
		dal = new SpoolDAL(dbs.spool);
	}

	// -------------------------------------------------------------------------
	// insertChunk
	// -------------------------------------------------------------------------

	it("insertChunk with kind=output returns a ULID string", () => {
		setup();
		const id = dal.insertChunk(makeChunkInput("ch-01", 1, "output"));
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("insertChunk with kind=snapshot returns a ULID string", () => {
		setup();
		const id = dal.insertChunk(makeChunkInput("ch-01", 1, "snapshot"));
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("insertChunk with kind=resize returns a ULID string", () => {
		setup();
		const id = dal.insertChunk(makeChunkInput("ch-01", 1, "resize"));
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	// -------------------------------------------------------------------------
	// getChunk
	// -------------------------------------------------------------------------

	it("getChunk returns the chunk when found", () => {
		setup();
		const id = dal.insertChunk(makeChunkInput("ch-02", 1, "output"));
		const chunk = dal.getChunk(id);
		expect(chunk).toBeDefined();
		expect(chunk?.id).toBe(id);
		expect(chunk?.channelId).toBe("ch-02");
		expect(chunk?.seq).toBe(1);
		expect(chunk?.kind).toBe("output");
	});

	it("getChunk returns undefined when not found", () => {
		setup();
		const chunk = dal.getChunk("non-existent-id");
		expect(chunk).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// getChunksByChannel
	// -------------------------------------------------------------------------

	it("getChunksByChannel without filters returns all chunks for that channel", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-03", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-03", 2, "output"));
		dal.insertChunk(makeChunkInput("ch-03", 3, "snapshot"));
		// Different channel — should not be returned
		dal.insertChunk(makeChunkInput("ch-other", 1, "output"));

		const chunks = dal.getChunksByChannel("ch-03");
		expect(chunks).toHaveLength(3);
		expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3]);
	});

	it("getChunksByChannel with kind filter returns only matching kind", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-04", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-04", 2, "snapshot"));
		dal.insertChunk(makeChunkInput("ch-04", 3, "output"));

		const chunks = dal.getChunksByChannel("ch-04", { kind: "output" });
		expect(chunks).toHaveLength(2);
		expect(chunks.every((c) => c.kind === "output")).toBe(true);
	});

	it("getChunksByChannel with afterSeq filter returns only chunks after that seq", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-05", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-05", 2, "output"));
		dal.insertChunk(makeChunkInput("ch-05", 3, "output"));

		const chunks = dal.getChunksByChannel("ch-05", { afterSeq: 1 });
		expect(chunks).toHaveLength(2);
		expect(chunks.map((c) => c.seq)).toEqual([2, 3]);
	});

	it("getChunksByChannel with limit returns at most N chunks", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-06", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-06", 2, "output"));
		dal.insertChunk(makeChunkInput("ch-06", 3, "output"));

		const chunks = dal.getChunksByChannel("ch-06", { limit: 2 });
		expect(chunks).toHaveLength(2);
		expect(chunks.map((c) => c.seq)).toEqual([1, 2]);
	});

	// -------------------------------------------------------------------------
	// getLatestSnapshot
	// -------------------------------------------------------------------------

	it("getLatestSnapshot returns the most recent snapshot chunk", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-07", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-07", 2, "snapshot"));
		dal.insertChunk(makeChunkInput("ch-07", 3, "output"));
		dal.insertChunk(makeChunkInput("ch-07", 4, "snapshot"));

		const snap = dal.getLatestSnapshot("ch-07");
		expect(snap).toBeDefined();
		expect(snap?.seq).toBe(4);
		expect(snap?.kind).toBe("snapshot");
	});

	it("getLatestSnapshot returns undefined when no snapshots exist", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-08", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-08", 2, "output"));

		const snap = dal.getLatestSnapshot("ch-08");
		expect(snap).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// deleteChunksOlderThan
	// -------------------------------------------------------------------------

	it("deleteChunksOlderThan deletes old chunks and keeps new ones", () => {
		setup();
		// Insert two chunks — then we'll delete based on timestamp
		const id1 = dal.insertChunk(makeChunkInput("ch-09", 1, "output"));
		const id2 = dal.insertChunk(makeChunkInput("ch-09", 2, "output"));

		// Both exist initially
		expect(dal.getChunk(id1)).toBeDefined();
		expect(dal.getChunk(id2)).toBeDefined();

		// Delete chunks older than a future timestamp — both get deleted
		const future = new Date(Date.now() + 60_000).toISOString();
		const deleted = dal.deleteChunksOlderThan(future);
		expect(deleted).toBe(2);

		expect(dal.getChunk(id1)).toBeUndefined();
		expect(dal.getChunk(id2)).toBeUndefined();
	});

	it("deleteChunksOlderThan keeps chunks newer than the cutoff", () => {
		setup();
		const id = dal.insertChunk(makeChunkInput("ch-10", 1, "output"));

		// Delete chunks older than a past timestamp — nothing should be deleted
		const past = new Date(Date.now() - 60_000).toISOString();
		const deleted = dal.deleteChunksOlderThan(past);
		expect(deleted).toBe(0);

		expect(dal.getChunk(id)).toBeDefined();
	});

	it("deleteChunksOlderThan preserves the last snapshot per channel regardless of age", () => {
		setup();
		// Insert output + two snapshots — all with old-enough timestamps so the
		// future cutoff would normally delete them all.
		const idOut = dal.insertChunk(makeChunkInput("ch-gc", 1, "output"));
		const idSnap1 = dal.insertChunk(makeChunkInput("ch-gc", 2, "snapshot"));
		const idSnap2 = dal.insertChunk(makeChunkInput("ch-gc", 3, "snapshot"));

		// Sanity: all three exist before GC
		expect(dal.getChunk(idOut)).toBeDefined();
		expect(dal.getChunk(idSnap1)).toBeDefined();
		expect(dal.getChunk(idSnap2)).toBeDefined();

		// GC with a future cutoff — all chunks are "old"
		const future = new Date(Date.now() + 60_000).toISOString();
		const deleted = dal.deleteChunksOlderThan(future);

		// Output chunk + first (non-last) snapshot deleted; last snapshot kept
		expect(deleted).toBe(2);
		expect(dal.getChunk(idOut)).toBeUndefined();
		expect(dal.getChunk(idSnap1)).toBeUndefined();
		// Last snapshot (highest seq) must survive
		expect(dal.getChunk(idSnap2)).toBeDefined();
	});

	it("deleteChunksOlderThan preserves last snapshot independently per channel", () => {
		setup();
		// Two channels each with one snapshot — both snapshots must survive GC
		const snapA = dal.insertChunk(makeChunkInput("ch-gcA", 1, "snapshot"));
		const snapB = dal.insertChunk(makeChunkInput("ch-gcB", 1, "snapshot"));

		const future = new Date(Date.now() + 60_000).toISOString();
		const deleted = dal.deleteChunksOlderThan(future);

		// No output chunks — nothing to delete (both snapshots are last for their channel)
		expect(deleted).toBe(0);
		expect(dal.getChunk(snapA)).toBeDefined();
		expect(dal.getChunk(snapB)).toBeDefined();
	});

	// -------------------------------------------------------------------------
	// getChannelChunkCount
	// -------------------------------------------------------------------------

	it("getChannelChunkCount returns correct count", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-11", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-11", 2, "snapshot"));
		dal.insertChunk(makeChunkInput("ch-11", 3, "resize"));

		expect(dal.getChannelChunkCount("ch-11")).toBe(3);
	});

	it("getChannelChunkCount returns 0 for unknown channel", () => {
		setup();
		expect(dal.getChannelChunkCount("ch-unknown")).toBe(0);
	});

	// -------------------------------------------------------------------------
	// UNIQUE(channel_id, seq) constraint
	// -------------------------------------------------------------------------

	it("UNIQUE(channel_id, seq) constraint violation throws", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-12", 1, "output"));
		// Inserting same channel + seq again must throw
		expect(() => dal.insertChunk(makeChunkInput("ch-12", 1, "output"))).toThrow();
	});

	// -------------------------------------------------------------------------
	// Cross-DB: channel_id has no FK to meta.db (spool is standalone)
	// -------------------------------------------------------------------------

	it("can insert chunks with arbitrary channel_id (no cross-DB FK)", () => {
		setup();
		// This channel_id does not exist in meta.db — no error expected
		const id = dal.insertChunk(makeChunkInput("arbitrary-channel-id-xyz", 1, "output"));
		expect(typeof id).toBe("string");
		const chunk = dal.getChunk(id);
		expect(chunk?.channelId).toBe("arbitrary-channel-id-xyz");
	});

	// -------------------------------------------------------------------------
	// getChannelSize
	// -------------------------------------------------------------------------

	it("getChannelSize returns total data_blob size for a channel", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-sz", 1, "output")); // "data-1" → 6 bytes
		dal.insertChunk(makeChunkInput("ch-sz", 2, "output")); // "data-2" → 6 bytes
		dal.insertChunk(makeChunkInput("ch-sz", 3, "snapshot")); // "data-3" → 6 bytes

		expect(dal.getChannelSize("ch-sz")).toBe(18);
	});

	it("getChannelSize returns 0 for unknown channel", () => {
		setup();
		expect(dal.getChannelSize("ch-nope")).toBe(0);
	});

	// -------------------------------------------------------------------------
	// deleteChunksForChannel
	// -------------------------------------------------------------------------

	it("deleteChunksForChannel removes all chunks and returns count", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-del", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-del", 2, "snapshot"));
		dal.insertChunk(makeChunkInput("ch-other2", 1, "output"));

		const deleted = dal.deleteChunksForChannel("ch-del");
		expect(deleted).toBe(2);
		expect(dal.getChannelChunkCount("ch-del")).toBe(0);
		// Other channel unaffected
		expect(dal.getChannelChunkCount("ch-other2")).toBe(1);
	});

	it("deleteChunksForChannel returns 0 for unknown channel", () => {
		setup();
		expect(dal.deleteChunksForChannel("ch-nope")).toBe(0);
	});

	// -------------------------------------------------------------------------
	// listChannelIds
	// -------------------------------------------------------------------------

	it("listChannelIds returns distinct channel ids with chunks", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-a", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-a", 2, "output"));
		dal.insertChunk(makeChunkInput("ch-b", 1, "output"));

		const ids = dal.listChannelIds();
		expect(ids).toHaveLength(2);
		expect(ids.sort()).toEqual(["ch-a", "ch-b"]);
	});

	it("listChannelIds returns empty array when no chunks exist", () => {
		setup();
		expect(dal.listChannelIds()).toEqual([]);
	});

	// -------------------------------------------------------------------------
	// evictOldestChunks
	// -------------------------------------------------------------------------

	it("evictOldestChunks deletes oldest output chunks until under target", () => {
		setup();
		// Each "data-N" blob is 6 bytes; 3 output chunks = 18 bytes
		dal.insertChunk(makeChunkInput("ch-ev", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-ev", 2, "output"));
		dal.insertChunk(makeChunkInput("ch-ev", 3, "output"));

		// Target 12 bytes → need to delete 1 chunk (18-6=12)
		const deleted = dal.evictOldestChunks("ch-ev", 12);
		expect(deleted).toBe(1);
		expect(dal.getChannelSize("ch-ev")).toBe(12);

		// Oldest (seq=1) deleted, seq 2 and 3 remain
		const remaining = dal.getChunksByChannel("ch-ev");
		expect(remaining.map((c) => c.seq)).toEqual([2, 3]);
	});

	it("evictOldestChunks preserves snapshots even if over target", () => {
		setup();
		// 1 output (6 bytes) + 1 snapshot (6 bytes) = 12 bytes
		dal.insertChunk(makeChunkInput("ch-ev2", 1, "output"));
		dal.insertChunk(makeChunkInput("ch-ev2", 2, "snapshot"));

		// Target 6 bytes → evict output, but snapshot stays
		const deleted = dal.evictOldestChunks("ch-ev2", 6);
		expect(deleted).toBe(1);
		// Only snapshot remains (6 bytes) — at target
		expect(dal.getChannelSize("ch-ev2")).toBe(6);
		expect(dal.getChunksByChannel("ch-ev2")).toHaveLength(1);
		expect(dal.getChunksByChannel("ch-ev2")[0]?.kind).toBe("snapshot");
	});

	it("evictOldestChunks stops when only snapshots remain even if still over target", () => {
		setup();
		// 2 snapshots = 12 bytes, no output
		dal.insertChunk(makeChunkInput("ch-ev3", 1, "snapshot"));
		dal.insertChunk(makeChunkInput("ch-ev3", 2, "snapshot"));

		// Target 0 → can't delete snapshots
		const deleted = dal.evictOldestChunks("ch-ev3", 0);
		expect(deleted).toBe(0);
		expect(dal.getChannelChunkCount("ch-ev3")).toBe(2);
	});

	it("evictOldestChunks returns 0 when already under target", () => {
		setup();
		dal.insertChunk(makeChunkInput("ch-ev4", 1, "output")); // 6 bytes
		const deleted = dal.evictOldestChunks("ch-ev4", 100);
		expect(deleted).toBe(0);
	});
});
