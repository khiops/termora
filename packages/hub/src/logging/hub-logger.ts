import * as fs from "node:fs";
import * as path from "node:path";
import type { LogConfig } from "@termora/shared";
import { LOG_SEVERITY } from "./index.js";

const ROTATION_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── HubLogger ────────────────────────────────────────────────────────────────

export class HubLogger {
	private readonly filePath: string;
	private readonly oldFilePath: string;
	private readonly logsDir: string;
	private readonly minSeverity: number;
	private dirEnsured = false;

	constructor(logsDir: string, config: LogConfig) {
		this.logsDir = logsDir;
		this.filePath = path.join(logsDir, "hub.jsonl");
		this.oldFilePath = path.join(logsDir, "hub.jsonl.old");
		this.minSeverity = LOG_SEVERITY[config.level] ?? 2;
	}

	log(level: LogConfig["level"], msg: string, extra?: Record<string, unknown>): void {
		if ((LOG_SEVERITY[level] ?? 2) < this.minSeverity) return;

		this.ensureDir();
		this.maybeRotate();

		const entry: Record<string, unknown> = {
			ts: new Date().toISOString(),
			lvl: level,
			msg,
			...extra,
		};

		const line = JSON.stringify(entry) + "\n";
		try {
			fs.appendFileSync(this.filePath, line, { mode: 0o600 });
		} catch {
			// Silently fail if write fails (e.g. disk full)
		}
	}

	private maybeRotate(): void {
		if (!fs.existsSync(this.filePath)) return;
		try {
			const { size } = fs.statSync(this.filePath);
			if (size >= ROTATION_MAX_BYTES) {
				fs.renameSync(this.filePath, this.oldFilePath);
			}
		} catch {
			// If stat/rename fails, continue writing to existing file
		}
	}

	private ensureDir(): void {
		if (this.dirEnsured) return;
		fs.mkdirSync(this.logsDir, { recursive: true });
		this.dirEnsured = true;
	}
}
