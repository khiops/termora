import type { TerminalProfile, UiAttachOkMessage } from "@nexterm/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import { type Ref, onUnmounted, ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

/**
 * xterm.js composable.
 * Manages terminal lifecycle, input/output bridging to hub via WS, and resize handling.
 */
export function useTerminal(
	containerRef: Ref<HTMLElement | null>,
	wsClient: IWsClient,
	profile?: TerminalProfile,
) {
	const terminal = ref<Terminal | null>(null);
	const fitAddon = new FitAddon();
	let channelId: string | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let outputUnsubscribe: (() => void) | null = null;

	/**
	 * When false, keyboard input is suppressed (read-only mode).
	 * Set to true once the caller confirms write-lock ownership.
	 * Defaults to true so single-client setups work without auth.
	 */
	const canWrite = ref(true);

	/**
	 * Last cols/rows sent to the hub, used to avoid sending duplicate RESIZE
	 * messages that would trigger unnecessary SIGWINCH → prompt redraws.
	 */
	let lastSentCols = 0;
	let lastSentRows = 0;

	/** Debounce timer for RESIZE messages */
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;

	function sendResize(cols: number, rows: number): void {
		if (!channelId || !wsClient.isConnected) return;
		if (cols === lastSentCols && rows === lastSentRows) return;
		lastSentCols = cols;
		lastSentRows = rows;
		wsClient.send({ type: "RESIZE", channelId, cols, rows });
	}

	function init(): { cols: number; rows: number } {
		if (!containerRef.value) {
			console.error("[useTerminal] containerRef is null — cannot init");
			return { cols: 80, rows: 24 };
		}

		const p = profile;
		const term = new Terminal({
			allowProposedApi: true,
			cursorBlink: p?.cursorStyle !== "underline", // blink except underline (xterm default)
			fontSize: p?.fontSize ?? 14,
			fontFamily: p?.fontFamily ?? '"Consolas", "Liberation Mono", "Courier New", monospace',
			cursorStyle: p?.cursorStyle ?? "block",
			scrollback: p?.scrollback ?? 5000,
			theme: {
				// Catppuccin Mocha — hardcoded for now, themeOverrides later
				background: "#1e1e2e",
				foreground: "#cdd6f4",
				cursor: "#f5e0dc",
				black: "#45475a",
				red: "#f38ba8",
				green: "#a6e3a1",
				yellow: "#f9e2af",
				blue: "#89b4fa",
				magenta: "#f5c2e7",
				cyan: "#94e2d5",
				white: "#bac2de",
				brightBlack: "#585b70",
				brightRed: "#f38ba8",
				brightGreen: "#a6e3a1",
				brightYellow: "#f9e2af",
				brightBlue: "#89b4fa",
				brightMagenta: "#f5c2e7",
				brightCyan: "#94e2d5",
				brightWhite: "#a6adc8",
			},
		});

		term.loadAddon(fitAddon);
		term.loadAddon(new Unicode11Addon());
		term.unicode.activeVersion = "11";
		term.open(containerRef.value);
		fitAddon.fit();
		terminal.value = term;

		// Keyboard input → send INPUT to hub (only when holding write lock)
		term.onData((data: string) => {
			if (channelId && wsClient.isConnected && canWrite.value) {
				wsClient.send({
					type: "INPUT",
					channelId,
					data: new TextEncoder().encode(data),
				});
			}
		});

		// Terminal resize → send RESIZE to hub (debounced to coalesce rapid resizes)
		term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				resizeTimer = null;
				sendResize(cols, rows);
			}, 50);
		});

		// Container resize → refit terminal
		resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
		});
		resizeObserver.observe(containerRef.value);

		return { cols: term.cols, rows: term.rows };
	}

	/**
	 * Subscribe to OUTPUT messages for the given channel and write to terminal.
	 * Call after init() and after a successful SPAWN.
	 */
	function attachChannel(id: string): void {
		channelId = id;

		// Clean up previous subscription if any
		outputUnsubscribe?.();

		outputUnsubscribe = wsClient.on("OUTPUT", (msg) => {
			if (msg.type === "OUTPUT" && msg.channelId === channelId && terminal.value) {
				// msg.data arrives as Uint8Array from MessagePack decode
				const data =
					msg.data instanceof Uint8Array ? msg.data : new TextEncoder().encode(String(msg.data));
				terminal.value.write(data);
			}
		});

		// Send initial RESIZE so the PTY matches our dimensions from the start
		if (terminal.value) {
			sendResize(terminal.value.cols, terminal.value.rows);
		}
	}

	/**
	 * Re-attach to an existing channel: send ATTACH, wait for ATTACH_OK,
	 * restore snapshot + replay tail, then subscribe to live OUTPUT.
	 */
	/**
	 * Re-attach to an existing channel: send ATTACH, wait for ATTACH_OK,
	 * restore snapshot + replay tail, then subscribe to live OUTPUT.
	 *
	 * Dead channels are respawned by the hub under the same channel ID, so
	 * the caller always uses the original ID after this returns.
	 */
	async function reattachChannel(id: string): Promise<void> {
		// Clean up previous OUTPUT subscription
		outputUnsubscribe?.();

		// Don't set channelId yet — prevents spurious RESIZE messages from
		// being sent to the hub during terminal.reset() / terminal.write()
		// which would cause the shell to redraw the prompt multiple times.

		// Send ATTACH and wait for ATTACH_OK or ERROR
		const result = await new Promise<{
			snapshot: unknown;
			tail: Uint8Array[];
		}>((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubOk();
				unsubErr();
				reject(new Error("ATTACH timeout — no response after 10s"));
			}, 10_000);

			const unsubOk = wsClient.on("ATTACH_OK", (msg) => {
				if (msg.type === "ATTACH_OK") {
					const uiMsg = msg as UiAttachOkMessage;
					if (uiMsg.channelId !== id) return;
					clearTimeout(timer);
					unsubOk();
					unsubErr();
					resolve({
						snapshot: uiMsg.snapshot,
						tail: uiMsg.tail ?? [],
					});
				}
			});

			const unsubErr = wsClient.on("ERROR", (msg) => {
				if (
					msg.type === "ERROR" &&
					(msg.code === "CHANNEL_NOT_FOUND" || msg.code === "CHANNEL_DEAD")
				) {
					clearTimeout(timer);
					unsubOk();
					unsubErr();
					reject(new Error(msg.message ?? msg.code));
				}
			});

			wsClient.send({ type: "ATTACH", channelId: id });
		});

		// Restore snapshot if present (channelId still unset → no RESIZE sent)
		if (terminal.value && result.snapshot) {
			terminal.value.reset();
			const serialized = (result.snapshot as { serialized?: string }).serialized;
			if (serialized) {
				terminal.value.write(serialized);
			}
		}

		// Replay tail chunks
		if (terminal.value && result.tail.length > 0) {
			for (const chunk of result.tail) {
				const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
				terminal.value.write(data);
			}
		}

		// Set channelId — same ID always (respawn reuses the same channel ID)
		channelId = id;

		// Subscribe to live OUTPUT
		outputUnsubscribe = wsClient.on("OUTPUT", (msg) => {
			if (msg.type === "OUTPUT" && msg.channelId === channelId && terminal.value) {
				const data =
					msg.data instanceof Uint8Array ? msg.data : new TextEncoder().encode(String(msg.data));
				terminal.value.write(data);
			}
		});

		// Send ONE RESIZE with actual terminal dimensions so the PTY matches.
		// This is debounced + dedup'd so ResizeObserver won't cause duplicates.
		if (terminal.value) {
			sendResize(terminal.value.cols, terminal.value.rows);
		}
	}

	/**
	 * Pre-set the RESIZE dedup state to the terminal's current dimensions.
	 * Call BEFORE attachChannel when the PTY was already spawned at the correct
	 * size (deferred spawn) so that attachChannel's sendResize is a no-op and
	 * no SIGWINCH is fired (which would cause oh-my-posh to redraw the prompt).
	 */
	function suppressNextResize(): void {
		if (terminal.value) {
			lastSentCols = terminal.value.cols;
			lastSentRows = terminal.value.rows;
		}
	}

	/** Re-apply profile options (font, cursor, scrollback) to the live terminal. */
	function applyProfile(p: TerminalProfile): void {
		const term = terminal.value;
		if (!term) return;
		term.options.fontFamily =
			p.fontFamily ?? '"Consolas", "Liberation Mono", "Courier New", monospace';
		term.options.fontSize = p.fontSize ?? 14;
		term.options.cursorStyle = p.cursorStyle ?? "block";
		term.options.scrollback = p.scrollback ?? 5000;
		fitAddon.fit();
	}

	function dispose(): void {
		if (resizeTimer !== null) clearTimeout(resizeTimer);
		resizeTimer = null;
		outputUnsubscribe?.();
		outputUnsubscribe = null;
		resizeObserver?.disconnect();
		resizeObserver = null;
		terminal.value?.dispose();
		terminal.value = null;
		channelId = null;
	}

	onUnmounted(dispose);

	return {
		terminal,
		canWrite,
		init,
		attachChannel,
		reattachChannel,
		applyProfile,
		suppressNextResize,
		dispose,
		fitAddon,
	};
}
