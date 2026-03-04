import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type Ref, onUnmounted, ref } from "vue";
import type { IWsClient } from "../services/ws-client.js";

/**
 * xterm.js composable.
 * Manages terminal lifecycle, input/output bridging to hub via WS, and resize handling.
 */
export function useTerminal(containerRef: Ref<HTMLElement | null>, wsClient: IWsClient) {
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

	function init(): void {
		if (!containerRef.value) {
			console.error("[useTerminal] containerRef is null — cannot init");
			return;
		}

		const term = new Terminal({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: '"Cascadia Code", "Fira Code", monospace',
			theme: {
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

		// Terminal resize → send RESIZE to hub
		term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
			if (channelId && wsClient.isConnected) {
				wsClient.send({
					type: "RESIZE",
					channelId,
					cols,
					rows,
				});
			}
		});

		// Container resize → refit terminal
		resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
		});
		resizeObserver.observe(containerRef.value);
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
	}

	function dispose(): void {
		outputUnsubscribe?.();
		outputUnsubscribe = null;
		resizeObserver?.disconnect();
		resizeObserver = null;
		terminal.value?.dispose();
		terminal.value = null;
		channelId = null;
	}

	onUnmounted(dispose);

	return { terminal, canWrite, init, attachChannel, dispose, fitAddon };
}
