import { generateId } from "@nexterm/shared";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

export interface PtyChannel {
	id: string;
	pty: IPty;
	seq: number;
}

export interface SpawnOptions {
	shell: string;
	cwd: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
}

export class PtyManager {
	private channels = new Map<string, PtyChannel>();

	/** Spawn a new PTY. Returns the new channel ID. */
	spawn(options: SpawnOptions): string {
		const id = generateId();
		const ptyProcess = pty.spawn(options.shell, [], {
			name: "xterm-256color",
			cols: options.cols,
			rows: options.rows,
			cwd: options.cwd,
			env: { ...process.env, ...options.env } as Record<string, string>,
		});

		this.channels.set(id, { id, pty: ptyProcess, seq: 0 });
		return id;
	}

	/** Write raw bytes to a channel's PTY stdin. */
	write(channelId: string, data: Uint8Array): void {
		const channel = this.getChannel(channelId);
		// node-pty write() expects a string; binary encoding preserves raw bytes
		channel.pty.write(Buffer.from(data).toString("binary"));
	}

	/** Resize a channel's PTY. */
	resize(channelId: string, cols: number, rows: number): void {
		const channel = this.getChannel(channelId);
		channel.pty.resize(cols, rows);
	}

	/** Increment and return the next output sequence number for a channel. */
	nextSeq(channelId: string): number {
		const channel = this.getChannel(channelId);
		return ++channel.seq;
	}

	/** Register an onData callback on a channel's PTY. */
	onData(channelId: string, callback: (data: string) => void): void {
		const channel = this.getChannel(channelId);
		channel.pty.onData(callback);
	}

	/** Register an onExit callback on a channel's PTY. */
	onExit(channelId: string, callback: (exit: { exitCode: number; signal?: number }) => void): void {
		const channel = this.getChannel(channelId);
		channel.pty.onExit(callback);
	}

	/** Kill and remove a channel. No-op if the channel does not exist. */
	destroy(channelId: string): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		channel.pty.kill();
		this.channels.delete(channelId);
	}

	/** Return true when the given channel exists. */
	has(channelId: string): boolean {
		return this.channels.has(channelId);
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
