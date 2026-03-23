
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Log GC ───────────────────────────────────────────────────────────────────

/**
 * Scan <logsDir>/channels/ and delete .jsonl files that are older than
 * maxAgeDays days, skipping any channelId present in activeChannelIds.
 *
 * Returns the number of deleted files.
 */
export async function runLogGc(
	logsDir: string,
	maxAgeDays: number,
	activeChannelIds: Set<string>,
): Promise<number> {
	if (maxAgeDays === 0) return 0;

	const channelsDir = path.join(logsDir, "channels");

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(channelsDir, { withFileTypes: true });
	} catch {
		// Directory doesn't exist or is unreadable — nothing to GC
		return 0;
	}

	const cutoffMs = maxAgeDays * 24 * 60 * 60 * 1000;
	const nowMs = Date.now();
	let deleted = 0;

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

		const channelId = entry.name.slice(0, -".jsonl".length);
		if (activeChannelIds.has(channelId)) continue;

		const filePath = path.join(channelsDir, entry.name);
		try {
			const { mtimeMs } = fs.statSync(filePath);
			if (nowMs - mtimeMs > cutoffMs) {
				fs.unlinkSync(filePath);
				deleted++;
			}
		} catch {
			// Continue — don't let one failure abort the whole GC pass
		}
	}

	return deleted;
}
