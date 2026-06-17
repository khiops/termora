import type {
	AgentFetchDoneMessage,
	AgentFetchErrorMessage,
	AgentFetchProgressMessage,
} from "@termora/shared";
import { generateId } from "@termora/shared";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { touchToken, validateTokenRecord } from "../auth.js";
import { HUB_VERSION } from "../build-version.js";
import { getBinaryCacheDir as defaultGetBinaryCacheDir } from "../session/agent-deployer.js";
import {
	type AgentFetchImpl,
	FetchError,
	fetchAgentBinary,
	resolveTarget,
	validateAgentVersion,
} from "../session/agent-fetch.js";
import {
	type AgentTargetArch,
	type AgentTargetOs,
	type AgentVersionReader,
	type ComputeTargetStatusOptions,
	computeTargetStatus,
	getHubPlatform,
} from "../session/agent-status.js";

export interface AgentRoutesDeps extends AgentMutationOriginGuardOptions {
	readonly authToken?: string | null;
	readonly db?: Database.Database | null;
	readonly tokenTtlDays?: number;
	readonly getBinaryCacheDir?: () => string | Promise<string>;
	readonly hubVersion?: string;
	readonly versionReader?: AgentVersionReader;
	readonly resolveAgentBinaryPath?: () => string | null;
	readonly hubPlatform?: ComputeTargetStatusOptions["hubPlatform"];
	readonly fetchImpl?: AgentFetchImpl;
	readonly broadcastAgentFetchMessage?: (message: AgentFetchMessage) => void;
}

export interface AgentMutationOriginGuardOptions {
	readonly allowedOrigins?: Iterable<string> | (() => Iterable<string>);
	readonly allowedHosts?: Iterable<string> | (() => Iterable<string>);
}

type AgentPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export type AgentFetchMessage =
	| AgentFetchProgressMessage
	| AgentFetchDoneMessage
	| AgentFetchErrorMessage;

type AgentFetchPhase = AgentFetchProgressMessage["phase"];

interface AgentFetchSnapshot {
	os: AgentTargetOs;
	arch: AgentTargetArch;
	downloaded: number;
	total?: number;
	phase: AgentFetchPhase;
}

interface AgentFetchJob {
	readonly id: string;
	readonly targetKey: string;
	readonly os: AgentTargetOs;
	readonly arch: AgentTargetArch;
	readonly version: string;
	readonly cacheDir: string;
	snapshot: AgentFetchSnapshot;
}

interface AgentFetchRequestBody {
	readonly os?: unknown;
	readonly arch?: unknown;
	readonly version?: unknown;
}

const AGENT_FETCH_GLOBAL_CONCURRENCY = 2;

export function registerAgentRoutes(server: FastifyInstance, deps: AgentRoutesDeps = {}): void {
	const requireBearer = createAgentBearerAuthGuard(deps);
	const requireMutationOrigin = createAgentMutationOriginGuard(deps);
	const jobsByTarget = new Map<string, AgentFetchJob>();
	const queuedJobs: AgentFetchJob[] = [];
	let runningJobs = 0;

	server.get(
		"/api/agents/targets",
		{ preHandler: requireBearer },
		async (_request: FastifyRequest, reply: FastifyReply) => {
			try {
				const cacheDir = deps.getBinaryCacheDir ? await deps.getBinaryCacheDir() : undefined;
				const status = await computeTargetStatus({
					...(cacheDir !== undefined && { cacheDir }),
					...(deps.hubVersion !== undefined && { hubVersion: deps.hubVersion }),
					...(deps.versionReader !== undefined && { versionReader: deps.versionReader }),
					...(deps.resolveAgentBinaryPath !== undefined && {
						resolveAgentBinaryPath: deps.resolveAgentBinaryPath,
					}),
					...(deps.hubPlatform !== undefined && { hubPlatform: deps.hubPlatform }),
				});
				return reply.code(200).send(status);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({
					error: {
						code: "AGENT_STATUS_ERROR",
						message,
					},
				});
			}
		},
	);

	server.post<{ Body: AgentFetchRequestBody }>(
		"/api/agents/fetch",
		{ preHandler: [requireBearer, requireMutationOrigin] },
		async (request, reply) => {
			const body = request.body;
			const os = typeof body?.os === "string" ? body.os : "";
			const arch = typeof body?.arch === "string" ? body.arch : "";
			const target = resolveTarget(os, arch);
			if (!target) {
				return sendError(
					reply,
					400,
					"UNSUPPORTED_TARGET",
					`No Termora agent release is built for ${os}/${arch}.`,
				);
			}

			const versionValue =
				body?.version === undefined ? (deps.hubVersion ?? HUB_VERSION) : body.version;
			const version = typeof versionValue === "string" ? versionValue : String(versionValue);

			try {
				validateAgentVersion(version);
			} catch (error) {
				if (error instanceof FetchError) {
					return sendError(reply, 400, error.code, error.message);
				}
				throw error;
			}

			const targetOs = os as AgentTargetOs;
			const targetArch = arch as AgentTargetArch;
			const hubPlatform =
				deps.hubPlatform === undefined
					? getHubPlatform(process.platform, process.arch)
					: deps.hubPlatform;
			if (hubPlatform?.os === targetOs && hubPlatform.arch === targetArch) {
				return sendError(
					reply,
					400,
					"BUNDLED_TARGET",
					`The hub platform target ${targetOs}/${targetArch} is served by the bundled agent and is not fetched into the cache.`,
				);
			}

			const targetKey = `${targetOs}/${targetArch}`;
			const existingJob = jobsByTarget.get(targetKey);
			if (existingJob) {
				return reply.code(202).send({
					job_id: existingJob.id,
					snapshot: snapshotToWire(existingJob.snapshot),
				});
			}

			const cacheDir = await resolveBinaryCacheDir(deps);
			if (
				await isTargetCached({
					cacheDir,
					version,
					os: targetOs,
					arch: targetArch,
					deps,
					hubPlatform,
				})
			) {
				return reply.code(200).send({ status: "already_cached" });
			}

			const job: AgentFetchJob = {
				id: generateId(),
				targetKey,
				os: targetOs,
				arch: targetArch,
				version,
				cacheDir,
				snapshot: {
					os: targetOs,
					arch: targetArch,
					downloaded: 0,
					phase: "download",
				},
			};
			jobsByTarget.set(targetKey, job);
			queuedJobs.push(job);
			drainFetchQueue();

			return reply.code(202).send({
				job_id: job.id,
				snapshot: snapshotToWire(job.snapshot),
			});
		},
	);

	function drainFetchQueue(): void {
		while (runningJobs < AGENT_FETCH_GLOBAL_CONCURRENCY) {
			const job = queuedJobs.shift();
			if (!job) return;
			runningJobs++;
			void runFetchJob(job).finally(() => {
				runningJobs--;
				jobsByTarget.delete(job.targetKey);
				drainFetchQueue();
			});
		}
	}

	async function runFetchJob(job: AgentFetchJob): Promise<void> {
		try {
			const path = await fetchAgentBinary({
				os: job.os,
				arch: job.arch,
				version: job.version,
				cacheDir: job.cacheDir,
				...(deps.fetchImpl !== undefined && { fetchImpl: deps.fetchImpl }),
				onProgress: (progress) => {
					job.snapshot = {
						os: job.os,
						arch: job.arch,
						downloaded: progress.downloaded,
						...(progress.total !== undefined && { total: progress.total }),
						phase: progress.phase,
					};
					broadcastAgentFetch({
						type: "AGENT_FETCH_PROGRESS",
						jobId: job.id,
						os: job.os,
						arch: job.arch,
						downloaded: progress.downloaded,
						...(progress.total !== undefined && { total: progress.total }),
						phase: progress.phase,
					});
				},
			});
			broadcastAgentFetch({ type: "AGENT_FETCH_DONE", jobId: job.id, path });
		} catch (error) {
			if (error instanceof FetchError) {
				broadcastAgentFetch({
					type: "AGENT_FETCH_ERROR",
					jobId: job.id,
					code: error.code,
					message: error.message,
				});
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			broadcastAgentFetch({
				type: "AGENT_FETCH_ERROR",
				jobId: job.id,
				code: "FETCH_FAILED",
				message,
			});
		}
	}

	function broadcastAgentFetch(message: AgentFetchMessage): void {
		try {
			deps.broadcastAgentFetchMessage?.(message);
		} catch (error) {
			server.log.warn({ err: error }, "agent-fetch: broadcast failed");
		}
	}
}

async function resolveBinaryCacheDir(deps: AgentRoutesDeps): Promise<string> {
	return deps.getBinaryCacheDir ? await deps.getBinaryCacheDir() : defaultGetBinaryCacheDir();
}

async function isTargetCached(args: {
	readonly cacheDir: string;
	readonly version: string;
	readonly os: AgentTargetOs;
	readonly arch: AgentTargetArch;
	readonly deps: AgentRoutesDeps;
	readonly hubPlatform: ComputeTargetStatusOptions["hubPlatform"];
}): Promise<boolean> {
	const status = await computeTargetStatus({
		cacheDir: args.cacheDir,
		hubVersion: args.version,
		...(args.deps.versionReader !== undefined && { versionReader: args.deps.versionReader }),
		...(args.deps.resolveAgentBinaryPath !== undefined && {
			resolveAgentBinaryPath: args.deps.resolveAgentBinaryPath,
		}),
		...(args.hubPlatform !== undefined && { hubPlatform: args.hubPlatform }),
	});
	const row = status.targets.find((target) => target.os === args.os && target.arch === args.arch);
	return row?.status === "cached";
}

function snapshotToWire(snapshot: AgentFetchSnapshot): {
	readonly os: AgentTargetOs;
	readonly arch: AgentTargetArch;
	readonly downloaded: number;
	readonly total?: number;
	readonly phase: AgentFetchPhase;
} {
	return {
		os: snapshot.os,
		arch: snapshot.arch,
		downloaded: snapshot.downloaded,
		...(snapshot.total !== undefined && { total: snapshot.total }),
		phase: snapshot.phase,
	};
}

export function createAgentMutationOriginGuard(
	opts: AgentMutationOriginGuardOptions,
): AgentPreHandler {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const origin = request.headers.origin;
		if (!origin) return;

		const allowedOrigins = new Set(readAllowList(opts.allowedOrigins));
		const allowedHosts = new Set(readAllowList(opts.allowedHosts));
		let originHost: string;
		try {
			originHost = new URL(origin).host;
		} catch {
			return sendError(reply, 403, "ORIGIN_FORBIDDEN", "Origin is not allowed");
		}

		const host = request.headers.host;
		const originAllowed = allowedOrigins.has(origin) || allowedHosts.has(originHost);
		const hostAllowed = !host || allowedHosts.size === 0 || allowedHosts.has(host);
		if (!originAllowed || !hostAllowed) {
			return sendError(reply, 403, "ORIGIN_FORBIDDEN", "Origin or Host is not allowed");
		}
	};
}

function createAgentBearerAuthGuard(deps: AgentRoutesDeps): AgentPreHandler {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			return sendError(reply, 401, "AUTH_REQUIRED", "Authorization header required");
		}

		const [scheme, token, extra] = authHeader.split(" ");
		if (scheme !== "Bearer" || !token || extra !== undefined) {
			return sendError(reply, 401, "AUTH_REQUIRED", "Authorization header must be: Bearer <token>");
		}

		if (isValidAgentBearer(token, deps)) return;
		return sendError(reply, 401, "AUTH_INVALID", "Invalid, expired, or revoked token");
	};
}

function isValidAgentBearer(token: string, deps: AgentRoutesDeps): boolean {
	if (deps.db) {
		const record = validateTokenRecord(deps.db, token);
		if (record) {
			if (deps.tokenTtlDays !== undefined) touchToken(deps.db, record.id, deps.tokenTtlDays);
			return true;
		}
	}
	return deps.authToken !== undefined && deps.authToken !== null && token === deps.authToken;
}

function readAllowList(list: Iterable<string> | (() => Iterable<string>) | undefined): string[] {
	if (!list) return [];
	return Array.from(typeof list === "function" ? list() : list);
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string): void {
	reply.code(statusCode).send({ error: { code, message } });
}
