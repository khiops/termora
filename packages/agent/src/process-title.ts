import { readFileSync } from "node:fs";

/**
 * Get the foreground process name for a PTY shell PID.
 * Reads /proc/<pid>/stat to get tpgid (foreground process group ID),
 * then /proc/<tpgid>/comm for the process name.
 * Returns null on any error or unsupported platform.
 */
export function getForegroundProcessName(shellPid: number): string | null {
	if (process.platform !== "linux") {
		return null; // macOS: needs proc_pidpath via native addon (P1); Windows: needs windows-process-tree (P1)
	}
	try {
		// Read /proc/<pid>/stat — parse tpgid safely around the comm field
		// Format: pid (comm) state ppid pgrp session tty_nr tpgid ...
		// The comm field can contain spaces and parens, so find the last ')' first
		const stat = readFileSync(`/proc/${shellPid}/stat`, "utf8");
		const lastParen = stat.lastIndexOf(")");
		if (lastParen === -1) return null;
		const fields = stat.slice(lastParen + 2).split(" ");
		// fields[0]=state, [1]=ppid, [2]=pgrp, [3]=session, [4]=tty_nr, [5]=tpgid
		const tpgidField = fields[5];
		if (tpgidField === undefined) return null;
		const tpgid = Number.parseInt(tpgidField, 10);
		if (Number.isNaN(tpgid) || tpgid <= 0) return null;

		// Read /proc/<tpgid>/comm for the process name
		const comm = readFileSync(`/proc/${tpgid}/comm`, "utf8").trim();
		return comm || null;
	} catch {
		return null; // Process may have exited, /proc not available, etc.
	}
}

/** Default polling interval in milliseconds. */
export const PROCESS_TITLE_POLL_MS = 500;

/**
 * Start polling the foreground process name for a channel.
 * Calls `onChange(name)` only when the name actually changes.
 * Returns a cleanup function to stop polling.
 */
export function startProcessTitlePolling(
	shellPid: number,
	onChange: (name: string) => void,
	intervalMs: number = PROCESS_TITLE_POLL_MS,
): () => void {
	let lastTitle: string | null = null;

	const timer = setInterval(() => {
		const name = getForegroundProcessName(shellPid);
		if (name !== null && name !== lastTitle) {
			lastTitle = name;
			onChange(name);
		}
	}, intervalMs);

	return () => clearInterval(timer);
}
