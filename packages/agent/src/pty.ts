import { generateId } from "@nexterm/shared";
import type { SnapshotData } from "@nexterm/shared";
import { detectSea } from "@nexterm/shared/dist/sea-addon-loader.js";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { HeadlessTerminal } from "./headless.js";

export interface PtyChannel {
	id: string;
	pty: IPty;
	seq: number;
	headless: HeadlessTerminal;
}

export interface SpawnOptions {
	id?: string;
	shell: string;
	args?: string[];
	cwd?: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
	scrollback?: number;
}

export class PtyManager {
	private channels = new Map<string, PtyChannel>();

	/** Spawn a new PTY. Returns the new channel ID. */
	spawn(options: SpawnOptions): string {
		const id = options.id ?? generateId();
		const ptyProcess = pty.spawn(options.shell, options.args ?? [], {
			name: "xterm-256color",
			cols: options.cols,
			rows: options.rows,
			...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
			env: { ...process.env, ...options.env } as Record<string, string>,
			// Let node-pty auto-detect conpty vs winpty based on Windows version
		});

		const headless = new HeadlessTerminal(options.cols, options.rows, options.scrollback);

		this.channels.set(id, { id, pty: ptyProcess, seq: 0, headless });
		return id;
	}

	/** Write raw bytes to a channel's PTY stdin. */
	write(channelId: string, data: Uint8Array): void {
		const channel = this.getChannel(channelId);
		// node-pty write() expects a string; binary encoding preserves raw bytes
		channel.pty.write(Buffer.from(data).toString("binary"));
	}

	/** Resize a channel's PTY and its headless mirror. */
	resize(channelId: string, cols: number, rows: number): void {
		const channel = this.getChannel(channelId);
		channel.pty.resize(cols, rows);
		channel.headless.resize(cols, rows);
	}

	/** Increment and return the next output sequence number for a channel. */
	nextSeq(channelId: string): number {
		const channel = this.getChannel(channelId);
		return ++channel.seq;
	}

	/** Return the current sequence number for a channel without incrementing. */
	lastSeq(channelId: string): number {
		const channel = this.channels.get(channelId);
		return channel?.seq ?? 0;
	}

	/**
	 * Register an onData callback on a channel's PTY.
	 * Also feeds each chunk into the headless terminal mirror.
	 */
	onData(channelId: string, callback: (data: string) => void): void {
		const channel = this.getChannel(channelId);
		channel.pty.onData((rawData: string) => {
			// Mirror output into the headless terminal (UTF-8 re-encode)
			channel.headless.write(Buffer.from(rawData));
			callback(rawData);
		});
	}

	/** Register an onExit callback on a channel's PTY. */
	onExit(channelId: string, callback: (exit: { exitCode: number; signal?: number }) => void): void {
		const channel = this.getChannel(channelId);
		channel.pty.onExit(callback);
	}

	/** Register an onTitleChange callback on a channel's headless terminal (OSC 0/2). */
	onTitleChange(channelId: string, callback: (title: string) => void): void {
		const channel = this.getChannel(channelId);
		channel.headless.onTitleChange(callback);
	}

	/** Register an onBell callback on a channel's headless terminal (BEL). */
	onBell(channelId: string, callback: () => void): void {
		const channel = this.getChannel(channelId);
		channel.headless.onBell(callback);
	}

	/** Register an OSC 9 handler on a channel's headless terminal. */
	onOsc9(channelId: string, callback: (message: string) => boolean): void {
		const channel = this.getChannel(channelId);
		channel.headless.registerOsc9Handler(callback);
	}

	/**
	 * Produce a serialized snapshot of a channel's headless terminal state.
	 * Returns null if the channel does not exist.
	 */
	snapshot(channelId: string): SnapshotData | null {
		const channel = this.channels.get(channelId);
		if (!channel) return null;
		return channel.headless.serialize();
	}

	/** Kill and remove a channel. No-op if the channel does not exist. */
	destroy(channelId: string): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		channel.pty.kill();
		channel.headless.dispose();
		this.channels.delete(channelId);
	}

	/** Return metadata for all alive channels. */
	getChannels(): { id: string; pid: number; title: string }[] {
		return Array.from(this.channels.values()).map((ch) => ({
			id: ch.id,
			pid: ch.pty.pid,
			title: ch.pty.process,
		}));
	}

	/** Return true when the given channel exists. */
	has(channelId: string): boolean {
		return this.channels.has(channelId);
	}

	/** Return the shell PID for a channel, or null if the channel does not exist. */
	getPid(channelId: string): number | null {
		return this.channels.get(channelId)?.pty.pid ?? null;
	}

	/** Kill and remove every active channel. */
	destroyAll(): void {
		for (const [id] of this.channels) {
			this.destroy(id);
		}
	}

	private getChannel(channelId: string): PtyChannel {
		const channel = this.channels.get(channelId);
		if (!channel) throw new Error(`Channel not found: ${channelId}`);
		return channel;
	}
}
