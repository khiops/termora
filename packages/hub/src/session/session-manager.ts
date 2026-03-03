import type {
	AgentSpawnErrMessage,
	AgentSpawnMessage,
	AgentSpawnOkMessage,
	ChannelExitMessage,
	ChannelStateMessage,
	ErrorMessage,
	InputMessage,
	OutputMessage,
	ProtocolMessage,
	ResizeMessage,
	UiAttachOkMessage,
	UiSpawnMessage,
	UiSpawnOkMessage,
} from "@nexterm/shared";
import { generateId } from "@nexterm/shared";
import type { DatabaseManager } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";
import type { AgentConnection } from "./agent-connection.js";
import { LocalAgent, resolveAgentPath } from "./local-agent.js";

const SPAWN_TIMEOUT_MS = 10_000;

export interface WsClient {
	id: string;
	send: (msg: ProtocolMessage) => void;
	attachedChannels: Set<string>;
}

interface ChannelState {
	sessionId: string;
	hostId: string;
	clients: Set<string>;
}

export class SessionManager {
	/** hostId → AgentConnection */
	private agents = new Map<string, AgentConnection>();
	/** channelId → ChannelState */
	private channels = new Map<string, ChannelState>();
	/** clientId → WsClient */
	private clients = new Map<string, WsClient>();
	private metaDal: MetaDAL;

	constructor(private dbManager: DatabaseManager) {
		this.metaDal = new MetaDAL(dbManager.meta);
	}

	/**
	 * Ensure the built-in "local" host exists in meta.db.
	 * Idempotent — creates on first call, returns existing id thereafter.
	 */
	async ensureLocalHost(): Promise<string> {
		const existing = this.metaDal.getHostByLabel("local");
		if (existing) return existing.id;
		const host = this.metaDal.createHost({ type: "local", label: "local" });
		return host.id;
	}

	addClient(client: WsClient): void {
		this.clients.set(client.id, client);
	}

	removeClient(clientId: string): void {
		const client = this.clients.get(clientId);
		if (!client) return;
		// Copy set to avoid mutating while iterating
		for (const channelId of [...client.attachedChannels]) {
			this._detachClient(clientId, channelId);
		}
		this.clients.delete(clientId);
	}

	/**
	 * Handle a SPAWN message from a UI client.
	 * For M1: always spawns on the local host regardless of msg.hostId.
	 */
	async handleSpawn(clientId: string, msg: UiSpawnMessage): Promise<void> {
		const client = this.clients.get(clientId);
		if (!client) return;

		// M1: always use local host
		const hostId = await this.ensureLocalHost();

		// Get or (re)create agent for this host
		let agent = this.agents.get(hostId);
		if (!agent?.connected) {
			const la = new LocalAgent(resolveAgentPath());
			await la.start();
			this._wireAgentEvents(hostId, la);
			this.agents.set(hostId, la);
			agent = la;
		}

		const requestId = generateId();
		const sessionId = generateId();

		const agentSpawn: AgentSpawnMessage = {
			type: "SPAWN",
			requestId,
			shell: msg.shell ?? process.env.SHELL ?? "/bin/sh",
			cwd: msg.cwd ?? process.env.HOME ?? "/",
			env: msg.env ?? {},
			cols: 80,
			rows: 24,
		};
		agent.send(agentSpawn);

		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				agent?.off("message", handler);
				reject(new Error("Agent SPAWN timeout"));
			}, SPAWN_TIMEOUT_MS);

			const handler = (incoming: ProtocolMessage) => {
				if (incoming.type === "SPAWN_OK") {
					const spawnOk = incoming as AgentSpawnOkMessage;
					if (spawnOk.requestId !== requestId) return;
					clearTimeout(timer);
					agent?.off("message", handler);

					const { channelId } = spawnOk;
					this.channels.set(channelId, {
						sessionId,
						hostId,
						clients: new Set([clientId]),
					});
					client.attachedChannels.add(channelId);

					const response: UiSpawnOkMessage = {
						type: "SPAWN_OK",
						channelId,
						hostId,
						sessionId,
					};
					client.send(response);
					resolve();
				} else if (incoming.type === "SPAWN_ERR") {
					const spawnErr = incoming as AgentSpawnErrMessage;
					if (spawnErr.requestId !== requestId) return;
					clearTimeout(timer);
					agent?.off("message", handler);

					const errorMsg: ErrorMessage = {
						type: "ERROR",
						code: spawnErr.code,
						message: spawnErr.message,
					};
					client.send(errorMsg);
					reject(new Error(`SPAWN_ERR [${spawnErr.code}]: ${spawnErr.message}`));
				}
			};
			agent?.on("message", handler);
		});
	}

	handleAttach(clientId: string, channelId: string): void {
		const client = this.clients.get(clientId);
		if (!client) return;

		const channel = this.channels.get(channelId);
		if (!channel) {
			const errorMsg: ErrorMessage = {
				type: "ERROR",
				code: "CHANNEL_NOT_FOUND",
				message: `Channel ${channelId} not found`,
			};
			client.send(errorMsg);
			return;
		}

		channel.clients.add(clientId);
		client.attachedChannels.add(channelId);

		// M1: no snapshot, no tail, no write-lock
		const attachOk: UiAttachOkMessage = {
			type: "ATTACH_OK",
			channelId,
			snapshot: null,
			tail: [],
			writeLockHolder: null,
			cached: false,
		};
		client.send(attachOk);
	}

	handleDetach(clientId: string, channelId: string): void {
		this._detachClient(clientId, channelId);
	}

	handleInput(clientId: string, channelId: string, data: Uint8Array): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		const agent = this.agents.get(channel.hostId);
		if (!agent) return;
		const inputMsg: InputMessage = { type: "INPUT", channelId, data };
		agent.send(inputMsg);
	}

	handleResize(clientId: string, channelId: string, cols: number, rows: number): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		const agent = this.agents.get(channel.hostId);
		if (!agent) return;
		const resizeMsg: ResizeMessage = { type: "RESIZE", channelId, cols, rows };
		agent.send(resizeMsg);
	}

	async shutdown(): Promise<void> {
		for (const agent of this.agents.values()) {
			agent.close();
		}
		this.agents.clear();
		this.clients.clear();
		this.channels.clear();
	}

	private _detachClient(clientId: string, channelId: string): void {
		this.channels.get(channelId)?.clients.delete(clientId);
		this.clients.get(clientId)?.attachedChannels.delete(channelId);
	}

	private _wireAgentEvents(hostId: string, agent: AgentConnection): void {
		agent.on("message", (msg: ProtocolMessage) => {
			if (msg.type === "OUTPUT") {
				const outputMsg = msg as OutputMessage;
				this._broadcastToChannel(outputMsg.channelId, outputMsg);
			} else if (msg.type === "CHANNEL_EXIT") {
				const exitMsg = msg as ChannelExitMessage;
				const channel = this.channels.get(exitMsg.channelId);
				if (channel) {
					const stateMsg: ChannelStateMessage = {
						type: "CHANNEL_STATE",
						channelId: exitMsg.channelId,
						sessionId: channel.sessionId,
						status: "dead",
						exitCode: exitMsg.exitCode,
					};
					this._broadcastToChannel(exitMsg.channelId, stateMsg);
				}
			}
		});

		agent.on("close", () => {
			this.agents.delete(hostId);
		});
	}

	private _broadcastToChannel(channelId: string, msg: ProtocolMessage): void {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		for (const clientId of channel.clients) {
			this.clients.get(clientId)?.send(msg);
		}
	}
}
