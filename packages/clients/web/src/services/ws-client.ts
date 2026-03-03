import { decodeMessage, encodeMessage } from "@nexterm/shared";
import type { ProtocolMessage } from "@nexterm/shared";

type MessageListener = (msg: ProtocolMessage) => void;

/**
 * Public interface for WsClient — used by composables to avoid
 * Pinia reactive proxy stripping private class members.
 */
export interface IWsClient {
	connect(url: string): Promise<void>;
	send(msg: ProtocolMessage): void;
	on(type: string, callback: MessageListener): () => void;
	close(): void;
	readonly isConnected: boolean;
}

/**
 * WebSocket client for hub communication.
 * Messages are raw MessagePack (no length-prefix framing — that is TCP-only).
 * Encoding/decoding delegates to @nexterm/shared codec (browser-safe: no Buffer).
 */
export class WsClient implements IWsClient {
	private ws: WebSocket | null = null;
	private listeners = new Map<string, Set<MessageListener>>();

	connect(url: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url);
			ws.binaryType = "arraybuffer";

			ws.onopen = () => {
				this.ws = ws;
				resolve();
			};

			ws.onerror = () => {
				reject(new Error(`WebSocket connection failed: ${url}`));
			};

			ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
				try {
					const data = new Uint8Array(event.data);
					const msg = decodeMessage(data);
					this._dispatch(msg);
				} catch (err) {
					console.error("[WsClient] Failed to decode message:", err);
				}
			};

			ws.onclose = () => {
				this.ws = null;
			};
		});
	}

	send(msg: ProtocolMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected");
		}
		const encoded = encodeMessage(msg);
		this.ws.send(encoded);
	}

	/**
	 * Subscribe to messages of a specific type.
	 * Use "*" to receive all messages.
	 * Returns an unsubscribe function.
	 */
	on(type: string, callback: MessageListener): () => void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)?.add(callback);
		return () => {
			this.listeners.get(type)?.delete(callback);
		};
	}

	close(): void {
		this.ws?.close();
		this.ws = null;
	}

	get isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	private _dispatch(msg: ProtocolMessage): void {
		// Type-specific listeners
		const typeListeners = this.listeners.get(msg.type);
		if (typeListeners) {
			for (const listener of typeListeners) {
				listener(msg);
			}
		}
		// Global catch-all listeners
		const globalListeners = this.listeners.get("*");
		if (globalListeners) {
			for (const listener of globalListeners) {
				listener(msg);
			}
		}
	}
}
