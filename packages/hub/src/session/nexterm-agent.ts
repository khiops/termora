import net from "node:net";
import { type ProtocolMessage, encodeFrame } from "@nexterm/shared";
import { AgentConnection } from "./agent-connection.js";
import { SendQueue } from "./send-queue.js";

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Hub-side agent connection for the daemon transport (UDS/named pipe).
 *
 * Connects to a running agent daemon via Unix domain socket or Windows named pipe.
 * The agent remains alive independently — close() disconnects without killing it.
 *
 * Factory method: NextermAgent.connectLocal(socketPath)
 */
export class NextermAgent extends AgentConnection {
	private socket: net.Socket;
	private sendQueue: SendQueue;

	constructor(socket: net.Socket) {
		super();
		this.socket = socket;
		this.sendQueue = new SendQueue("nexterm-agent");
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
	 * Connect to a local agent daemon via Unix domain socket or named pipe.
	 * Resolves after HELLO is received (agent is ready).
	 * Rejects on connection error or HELLO timeout (5s).
	 */
	static connectLocal(socketPath: string): Promise<NextermAgent> {
		return new Promise((resolve, reject) => {
			const socket = net.connect(socketPath);
			let settled = false;

			socket.once("connect", () => {
				const agent = new NextermAgent(socket);

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
