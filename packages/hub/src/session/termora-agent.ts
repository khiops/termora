import net from "node:net";
import { type AgentChannelStateMessage, encodeFrame, type ProtocolMessage } from "@termora/shared";
import { AgentConnection } from "./agent-connection.js";
import { SendQueue } from "./send-queue.js";

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Hub-side agent connection for the daemon transport (UDS/named pipe).
 *
 * Connects to a running agent daemon via Unix domain socket or Windows named pipe.
 * The agent remains alive independently — close() disconnects without killing it.
 *
 * Factory method: TermoraAgent.connectLocal(socketPath)
 */
export class TermoraAgent extends AgentConnection {
	private socket: net.Socket;
	private sendQueue: SendQueue;

	/**
	 * Promise that resolves with collected AGENT_CHANNEL_STATE messages
	 * once CHANNEL_STATE_END is received. Created eagerly in the constructor
	 * so messages are never lost, regardless of when the caller awaits.
	 */
	private channelStatePromise: Promise<AgentChannelStateMessage[]>;

	constructor(socket: net.Socket) {
		super();
		this.socket = socket;
		this.sendQueue = new SendQueue("termora-agent");
		this.sendQueue.attach(socket);

		socket.on("data", (data: Buffer) => {
			this.handleData(data);
		});

		socket.on("close", () => {
			this.sendQueue.clear();
			this.emit("close");
		});

		socket.on("error", (err) => {
			this.emit("error", err);
		});

		// Eagerly collect channel-state messages into a promise so that
		// callers of waitForChannelState() never miss messages that arrived
		// between HELLO and the await.
		this.channelStatePromise = new Promise<AgentChannelStateMessage[]>((resolve) => {
			const states: AgentChannelStateMessage[] = [];

			const onMessage = (msg: ProtocolMessage): void => {
				if (msg.type === "AGENT_CHANNEL_STATE") {
					states.push(msg);
				} else if (msg.type === "CHANNEL_STATE_END") {
					this.off("message", onMessage);
					resolve(states);
				}
			};

			this.on("message", onMessage);
		});
	}

	/** Send a framed protocol message to the agent. */
	send(msg: ProtocolMessage): void {
		if (!this.connected) return;
		const frame = encodeFrame(msg);
		this.sendQueue.send(Buffer.from(frame));
	}

	/** Disconnect from the agent (agent keeps running). */
	close(): void {
		this.sendQueue.clear();
		this.socket.destroy();
	}

	/** True when the underlying socket is still open. */
	get connected(): boolean {
		return !this.socket.destroyed;
	}

	/**
	 * Wait for the agent to send channel state enumeration.
	 *
	 * After connecting, the daemon sends zero or more AGENT_CHANNEL_STATE
	 * messages followed by a single CHANNEL_STATE_END sentinel. This method
	 * returns the collected list.
	 *
	 * Safe to call after `connectLocal` resolves — messages that arrived
	 * between HELLO and this call are buffered internally.
	 *
	 * @param timeoutMs - Maximum time to wait (default 5 000 ms).
	 * @returns Array of channel state messages (empty when no channels exist).
	 */
	waitForChannelState(timeoutMs = 5_000): Promise<AgentChannelStateMessage[]> {
		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new Error("CHANNEL_STATE timeout"));
			}, timeoutMs);
		});

		return Promise.race([this.channelStatePromise, timeout]).finally(() => {
			clearTimeout(timer);
		});
	}

	/**
	 * Connect to a local agent daemon via Unix domain socket or named pipe.
	 * Resolves after HELLO is received (agent is ready).
	 * Rejects on connection error or HELLO timeout (5s).
	 */
	static connectLocal(socketPath: string): Promise<TermoraAgent> {
		return new Promise((resolve, reject) => {
			const socket = net.connect(socketPath);
			let settled = false;

			socket.once("connect", () => {
				const agent = new TermoraAgent(socket);

				const timer = setTimeout(() => {
					if (!settled) {
						settled = true;
						agent.close();
						reject(new Error(`HELLO timeout after ${HELLO_TIMEOUT_MS}ms`));
					}
				}, HELLO_TIMEOUT_MS);

				agent.once("ready", () => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						resolve(agent);
					}
				});

				agent.once("error", (err) => {
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						reject(err);
					}
				});
			});

			socket.once("error", (err) => {
				if (!settled) {
					settled = true;
					reject(err);
				}
			});
		});
	}
}
