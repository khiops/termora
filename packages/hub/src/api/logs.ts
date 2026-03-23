
import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { LOG_SEVERITY } from "../logging/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogQueryParams {
	level?: string; // filter by min severity level
	from_t?: string; // min offset ms (channel) or ISO date (hub)
	to_t?: string; // max offset ms (channel) or ISO date (hub)
	search?: string; // case-insensitive substring match on msg
	limit?: string; // max entries (default 100, max 1000)
	offset?: string; // skip first N entries
}

// ULID: 26 chars, alphanumeric (Crockford base32). Relaxed to [0-9A-Za-z] to
// prevent path traversal while covering all valid ULIDs.
const CHANNEL_ID_RE = /^[0-9A-Za-z]{26}$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a JSONL file and return parsed entries, skipping empty/malformed lines.
 */
function readJsonl(filePath: string): Record<string, unknown>[] {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	const entries: Record<string, unknown>[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				entries.push(parsed as Record<string, unknown>);
			}
		} catch {
			// Skip malformed lines
		}
	}
	return entries;
}

/**
 * Parse and validate limit/offset query params.
 * Returns defaults (100/0) when params are absent.
 */
function parsePagination(
	rawLimit: string | undefined,
	rawOffset: string | undefined,
): { limit: number; offset: number; error?: string } {
	const limit = rawLimit !== undefined ? Number.parseInt(rawLimit, 10) : 100;
	const offset = rawOffset !== undefined ? Number.parseInt(rawOffset, 10) : 0;

	if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
		return { limit: 100, offset: 0, error: "limit must be between 1 and 1000" };
	}
	if (!Number.isFinite(offset) || offset < 0) {
		return { limit: 100, offset: 0, error: "offset must be >= 0" };
	}
	return { limit, offset };
}

/**
 * Filter entries by minimum severity level.
 * E.g. level="warn" keeps warn + error.
 */
function filterByLevel(
	entries: Record<string, unknown>[],
	level: string | undefined,
): Record<string, unknown>[] {
	if (!level) return entries;
	const minSev = LOG_SEVERITY[level];
	if (minSev === undefined) return entries;
	return entries.filter((e) => {
		const lvl = e["lvl"];
		if (typeof lvl !== "string") return false;
		const sev = LOG_SEVERITY[lvl];
		return sev !== undefined && sev >= minSev;
	});
}

/**
 * Filter channel log entries by `t` (ms offset) range.
 */
function filterChannelByTime(
	entries: Record<string, unknown>[],
	fromT: string | undefined,
	toT: string | undefined,
): Record<string, unknown>[] {
	if (!fromT && !toT) return entries;
	const from = fromT !== undefined ? Number(fromT) : undefined;
	const to = toT !== undefined ? Number(toT) : undefined;
	return entries.filter((e) => {
		const t = e["t"];
		if (typeof t !== "number") return true;
		if (from !== undefined && t < from) return false;
		if (to !== undefined && t > to) return false;
		return true;
	});
}

/**
 * Filter hub log entries by `ts` (ISO 8601 string) range.
 */
function filterHubByTime(
	entries: Record<string, unknown>[],
	fromT: string | undefined,
	toT: string | undefined,
): Record<string, unknown>[] {
	if (!fromT && !toT) return entries;
	const from = fromT !== undefined ? new Date(fromT).getTime() : undefined;
	const to = toT !== undefined ? new Date(toT).getTime() : undefined;
	return entries.filter((e) => {
		const ts = e["ts"];
		if (typeof ts !== "string") return true;
		const t = new Date(ts).getTime();
		if (Number.isNaN(t)) return true;
		if (from !== undefined && t < from) return false;
		if (to !== undefined && t > to) return false;
		return true;
	});
}

/**
 * Filter entries by case-insensitive substring match in the `msg` field.
 */
function filterBySearch(
	entries: Record<string, unknown>[],
	search: string | undefined,
): Record<string, unknown>[] {
	if (!search) return entries;
	const lower = search.toLowerCase();
	return entries.filter((e) => {
		const msg = e["msg"];
		return typeof msg === "string" && msg.toLowerCase().includes(lower);
	});
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerLogRoutes(
	app: FastifyInstance,
	logsDir: string,
): Promise<void> {
	// GET /api/logs/channels/:channelId
	app.get<{ Params: { channelId: string }; Querystring: LogQueryParams }>(
		"/api/logs/channels/:channelId",
		async (request, reply) => {
			const { channelId } = request.params;

			// Path traversal protection: channelId must be 26 alphanumeric chars
			if (!CHANNEL_ID_RE.test(channelId)) {
				return reply.code(400).send({
					error: {
						code: "INVALID_CHANNEL_ID",
						message: "channelId must be 26 alphanumeric characters",
					},
				});
			}

			const { level, from_t, to_t, search, limit: rawLimit, offset: rawOffset } = request.query;

			const { limit, offset, error: paginationError } = parsePagination(rawLimit, rawOffset);
			if (paginationError) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: paginationError },
				});
			}

			const filePath = path.join(logsDir, "channels", `${channelId}.jsonl`);
			let entries = readJsonl(filePath);

			entries = filterByLevel(entries, level);
			entries = filterChannelByTime(entries, from_t, to_t);
			entries = filterBySearch(entries, search);

			const total = entries.length;
			const page = entries.slice(offset, offset + limit);

			return { entries: page, total };
		},
	);

	// GET /api/logs/hub
	app.get<{ Querystring: LogQueryParams }>(
		"/api/logs/hub",
		async (request, reply) => {
			const { level, from_t, to_t, search, limit: rawLimit, offset: rawOffset } = request.query;

			const { limit, offset, error: paginationError } = parsePagination(rawLimit, rawOffset);
			if (paginationError) {
				return reply.code(400).send({
					error: { code: "VALIDATION_ERROR", message: paginationError },
				});
			}

			const filePath = path.join(logsDir, "hub.jsonl");
			let entries = readJsonl(filePath);

			entries = filterByLevel(entries, level);
			entries = filterHubByTime(entries, from_t, to_t);
			entries = filterBySearch(entries, search);

			const total = entries.length;
			const page = entries.slice(offset, offset + limit);

			return { entries: page, total };
		},
	);
}
