import type { SnapshotData } from "@nexterm/shared";
import xtermAddonSerialize from "@xterm/addon-serialize";
import xtermHeadless from "@xterm/headless";

const { SerializeAddon } = xtermAddonSerialize;
const { Terminal } = xtermHeadless;

/**
 * Wraps an xterm.js headless Terminal with a SerializeAddon so the agent can
 * maintain an accurate screen-state mirror for each PTY channel and produce
 * serialized snapshots on demand.
 *
 * Note: @xterm/headless works in Node.js without any DOM polyfill.
 * Note: Terminal.write() is asynchronous internally; we do not wait for
 * completion because snapshot requests are infrequent and the delta is
 * negligible in practice.
 */
export class HeadlessTerminal {
	private readonly terminal: InstanceType<typeof Terminal>;
	private readonly serializeAddon: InstanceType<typeof SerializeAddon>;

	constructor(cols: number, rows: number, scrollback?: number) {
		this.terminal = new Terminal({
			cols,
			rows,
			scrollback: scrollback ?? 5000,
			allowProposedApi: true,
		});
		this.serializeAddon = new SerializeAddon();
		this.terminal.loadAddon(this.serializeAddon);
	}

	/** Write PTY output data to the headless terminal. */
	write(data: string | Uint8Array): void {
		this.terminal.write(data);
	}

	/**
	 * Write data and wait for the internal parser to fully process it.
	 * Useful in tests where you need the cursor position to be settled
	 * before calling serialize().
	 */
	writeSync(data: string | Uint8Array): Promise<void> {
		return new Promise((resolve) => {
			this.terminal.write(data, resolve);
		});
	}

	/** Resize the headless terminal to match the PTY dimensions. */
	resize(cols: number, rows: number): void {
		this.terminal.resize(cols, rows);
	}

	/**
	 * Produce a serialized snapshot of the terminal state.
	 *
	 * The returned `serialized` string can be written back into an xterm.js
	 * terminal (via `Terminal.write`) to restore the full viewport.
	 *
	 * Because Terminal.write() is async, this snapshot captures whatever has
	 * been flushed to the renderer buffer up to this point.  In production the
	 * hub issues SNAPSHOT_REQ only when a new client attaches, so the tiny
	 * pending-write window is not observable.
	 */
	serialize(): SnapshotData {
		return {
			serialized: this.serializeAddon.serialize(),
			cols: this.terminal.cols,
			rows: this.terminal.rows,
			cursorX: this.terminal.buffer.active.cursorX,
			cursorY: this.terminal.buffer.active.cursorY,
		};
	}

	dispose(): void {
		this.terminal.dispose();
	}
}
