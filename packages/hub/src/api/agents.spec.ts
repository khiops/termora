import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	AgentFetchDoneMessage,
	AgentFetchErrorMessage,
	AgentFetchProgressMessage,
} from "@termora/shared";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_TARGET_TRIPLES } from "../session/agent-cache.js";
import type { AgentFetchImpl } from "../session/agent-fetch.js";
import type { AgentTargetArch, AgentTargetOs, HubPlatform } from "../session/agent-status.js";
import { registerAgentRoutes } from "./agents.js";

const TEST_TOKEN = "a".repeat(64);
const HUB_VERSION = "0.4.1";
const HUB_PLATFORM = { os: "linux", arch: "x64" } as const satisfies HubPlatform;
const BUNDLED_PATH = "/tmp/termora-agent-api-test";
const DEFAULT_RELEASE_BASE_URL = "https://github.com/khiops/termora";

type AgentTargetEntry = {
	readonly triple: string | null;
	readonly ext: "" | ".exe";
	readonly built: boolean;
};

type AgentFetchMessage = AgentFetchProgressMessage | AgentFetchDoneMessage | AgentFetchErrorMessage;

const AGENT_TARGET_TABLE = AGENT_TARGET_TRIPLES as Record<
	AgentTargetOs,
	Record<AgentTargetArch, AgentTargetEntry>
>;

let server: FastifyInstance | null = null;
let tempDirs: string[] = [];

afterEach(async () => {
	if (server) await server.close();
	server = null;
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("GET /api/agents/targets", () => {
	it("requires Bearer auth at the route level without global daemon auth", async () => {
		const cacheDir = makeTempDir();
		let statusReads = 0;
		server = Fastify({ logger: false });
		registerAgentRoutes(server, {
			authToken: TEST_TOKEN,
			getBinaryCacheDir: () => {
				statusReads++;
				return cacheDir;
			},
		});

		const missing = await server.inject({ method: "GET", url: "/api/agents/targets" });
		const wrong = await server.inject({
			method: "GET",
			url: "/api/agents/targets",
			headers: { authorization: `Bearer ${"b".repeat(64)}` },
		});

		expect(missing.statusCode).toBe(401);
		expect(missing.json().error).toEqual({
			code: "AUTH_REQUIRED",
			message: "Authorization header required",
		});
		expect(wrong.statusCode).toBe(401);
		expect(wrong.json().error.code).toBe("AUTH_INVALID");
		expect(statusReads).toBe(0);
	});

	it("rejects all Bearer tokens when no route auth token is configured", async () => {
		server = Fastify({ logger: false });
		registerAgentRoutes(server);

		const res = await server.inject({
			method: "GET",
			url: "/api/agents/targets",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});

		expect(res.statusCode).toBe(401);
		expect(res.json().error.code).toBe("AUTH_INVALID");
	});

	it("returns the SC-01 target status shape for an authorized request", async () => {
		const cacheDir = makeTempDir();
		writeFileSync(agentCachePath(cacheDir, "linux", "arm64", HUB_VERSION), "agent");
		server = Fastify({ logger: false });
		registerAgentRoutes(server, {
			authToken: TEST_TOKEN,
			getBinaryCacheDir: () => cacheDir,
			hubVersion: HUB_VERSION,
			hubPlatform: HUB_PLATFORM,
			resolveAgentBinaryPath: () => BUNDLED_PATH,
			versionReader: () => HUB_VERSION,
		});

		const res = await server.inject({
			method: "GET",
			url: "/api/agents/targets",
			headers: { authorization: `Bearer ${TEST_TOKEN}` },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.hub_version).toBe(HUB_VERSION);
		expect(body.targets).toHaveLength(6);
		expect(targetStatus(body, "linux", "x64")).toBe("bundled");
		expect(targetStatus(body, "linux", "arm64")).toBe("cached");
		expect(targetStatus(body, "windows", "x64")).toBe("missing");
		expect(targetStatus(body, "windows", "arm64")).toBe("unsupported");
		expect(targetStatus(body, "darwin", "x64")).toBe("unsupported");
		expect(targetStatus(body, "darwin", "arm64")).toBe("unsupported");
	});
});

describe("POST /api/agents/fetch", () => {
	it("SC-05 streams progress, completes, and makes /targets show cached", async () => {
		const cacheDir = makeTempDir();
		const messages: AgentFetchMessage[] = [];
		const assetBody = "linux-arm64-agent";
		const { fetchImpl } = agentAssetFetch("linux", "arm64", HUB_VERSION, assetBody);
		server = makeAgentRouteServer(cacheDir, { fetchImpl, messages });

		const res = await postFetch({ os: "linux", arch: "arm64" });

		expect(res.statusCode).toBe(202);
		const jobId = res.json().job_id as string;
		expect(jobId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(res.json().snapshot).toMatchObject({
			os: "linux",
			arch: "arm64",
			downloaded: 0,
			phase: "download",
		});

		await waitForMessage<AgentFetchProgressMessage>(
			messages,
			(msg): msg is AgentFetchProgressMessage =>
				msg.type === "AGENT_FETCH_PROGRESS" && msg.jobId === jobId,
		);
		const done = await waitForMessage<AgentFetchDoneMessage>(
			messages,
			(msg): msg is AgentFetchDoneMessage => msg.type === "AGENT_FETCH_DONE" && msg.jobId === jobId,
		);
		expect(done.path).toBe(agentCachePath(cacheDir, "linux", "arm64", HUB_VERSION));

		const targets = await server!.inject({
			method: "GET",
			url: "/api/agents/targets",
			headers: authHeaders(),
		});
		expect(targets.statusCode).toBe(200);
		expect(targetStatus(targets.json(), "linux", "arm64")).toBe("cached");
	});

	it("SC-06 rejects an unsupported target before any network call", async () => {
		const cacheDir = makeTempDir();
		const fetchImpl = vi.fn<AgentFetchImpl>();
		server = makeAgentRouteServer(cacheDir, { fetchImpl });

		const res = await postFetch({ os: "darwin", arch: "arm64" });

		expect(res.statusCode).toBe(400);
		expect(res.json().error.code).toBe("UNSUPPORTED_TARGET");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("SC-24 rejects fetches for the hub platform before any network call", async () => {
		const cacheDir = makeTempDir();
		const fetchImpl = vi.fn<AgentFetchImpl>();
		server = makeAgentRouteServer(cacheDir, { fetchImpl });

		const res = await postFetch({ os: "linux", arch: "x64" });

		expect(res.statusCode).toBe(400);
		expect(res.json().error.code).toBe("BUNDLED_TARGET");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("SC-07 broadcasts a verbatim NETWORK FetchError message on connectivity failure", async () => {
		const cacheDir = makeTempDir();
		const messages: AgentFetchMessage[] = [];
		const fetchImpl = vi.fn<AgentFetchImpl>(async () => {
			throw new Error("offline");
		});
		server = makeAgentRouteServer(cacheDir, { fetchImpl, messages });

		const res = await postFetch({ os: "linux", arch: "arm64" });

		expect(res.statusCode).toBe(202);
		const jobId = res.json().job_id as string;
		const error = await waitForMessage<AgentFetchErrorMessage>(
			messages,
			(msg): msg is AgentFetchErrorMessage =>
				msg.type === "AGENT_FETCH_ERROR" && msg.jobId === jobId,
		);
		expect(error.code).toBe("NETWORK");
		expect(error.message).toBe(
			`Network error while downloading ${versionedAssetUrl("linux", "arm64", HUB_VERSION)}: offline. Retry the agent fetch, or manually download the asset and rename it to ${agentCachePath(cacheDir, "linux", "arm64", HUB_VERSION)}; Node fetch does not honor proxy environment variables here.`,
		);
	});

	it("SC-17 returns already_cached for a trusted current cache hit without starting a job", async () => {
		const cacheDir = makeTempDir();
		const cachedPath = agentCachePath(cacheDir, "linux", "arm64", HUB_VERSION);
		writeFileSync(cachedPath, "cached-agent");
		chmodSync(cachedPath, 0o755);
		const messages: AgentFetchMessage[] = [];
		const fetchImpl = vi.fn<AgentFetchImpl>();
		server = makeAgentRouteServer(cacheDir, { fetchImpl, messages });

		const res = await postFetch({ os: "linux", arch: "arm64" });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: "already_cached" });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(messages).toEqual([]);
	});

	it("SC-20 collapses concurrent duplicate fetches for one target into one job", async () => {
		const cacheDir = makeTempDir();
		const messages: AgentFetchMessage[] = [];
		const assetBody = "deduped-agent";
		const assetUrl = versionedAssetUrl("linux", "arm64", HUB_VERSION);
		const assetName = versionedAssetName("linux", "arm64", HUB_VERSION);
		let resolveAsset: ((response: Response) => void) | null = null;
		const pendingAsset = new Promise<Response>((resolve) => {
			resolveAsset = resolve;
		});
		let assetDownloads = 0;
		const fetchImpl = vi.fn<AgentFetchImpl>(async (url) => {
			if (url === assetUrl) {
				assetDownloads++;
				return pendingAsset;
			}
			if (url === checksumUrl(HUB_VERSION)) return response(sums(assetName, assetBody));
			throw new Error(`unexpected URL ${url}`);
		});
		server = makeAgentRouteServer(cacheDir, { fetchImpl, messages });

		const first = postFetch({ os: "linux", arch: "arm64" });
		const second = postFetch({ os: "linux", arch: "arm64" });
		const [firstRes, secondRes] = await Promise.all([first, second]);

		expect(firstRes.statusCode).toBe(202);
		expect(secondRes.statusCode).toBe(202);
		expect(secondRes.json().job_id).toBe(firstRes.json().job_id);
		expect(assetDownloads).toBe(1);

		resolveAsset?.(
			response(assetBody, { headers: { "content-length": String(assetBody.length) } }),
		);
		const done = await waitForMessage<AgentFetchDoneMessage>(
			messages,
			(msg): msg is AgentFetchDoneMessage =>
				msg.type === "AGENT_FETCH_DONE" && msg.jobId === firstRes.json().job_id,
		);
		expect(done.path).toBe(agentCachePath(cacheDir, "linux", "arm64", HUB_VERSION));
		expect(listCache(cacheDir).filter((name) => name === path.basename(done.path))).toHaveLength(1);
	});
});

function targetStatus(
	body: { targets: Array<{ os: string; arch: string; status: string }> },
	os: AgentTargetOs,
	arch: AgentTargetArch,
): string {
	const target = body.targets.find((row) => row.os === os && row.arch === arch);
	expect(target).toBeDefined();
	return target!.status;
}

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "termora-api-agents-"));
	chmodSync(dir, 0o700);
	tempDirs.push(dir);
	return dir;
}

function makeAgentRouteServer(
	cacheDir: string,
	opts: {
		readonly fetchImpl?: AgentFetchImpl;
		readonly messages?: AgentFetchMessage[];
	} = {},
): FastifyInstance {
	const instance = Fastify({ logger: false });
	registerAgentRoutes(instance, {
		authToken: TEST_TOKEN,
		getBinaryCacheDir: () => cacheDir,
		hubVersion: HUB_VERSION,
		hubPlatform: HUB_PLATFORM,
		resolveAgentBinaryPath: () => BUNDLED_PATH,
		versionReader: () => HUB_VERSION,
		...(opts.fetchImpl !== undefined && { fetchImpl: opts.fetchImpl }),
		broadcastAgentFetchMessage: (message) => {
			opts.messages?.push(message);
		},
	});
	return instance;
}

function postFetch(payload: unknown) {
	return server!.inject({
		method: "POST",
		url: "/api/agents/fetch",
		headers: authHeaders(),
		payload,
	});
}

function authHeaders(): { authorization: string } {
	return { authorization: `Bearer ${TEST_TOKEN}` };
}

function agentCachePath(
	cacheDir: string,
	osName: AgentTargetOs,
	arch: AgentTargetArch,
	version: string,
): string {
	const target = AGENT_TARGET_TABLE[osName][arch];
	return path.join(cacheDir, `termora-agent-${osName}-${arch}-${version}${target.ext}`);
}

function agentAssetFetch(
	osName: AgentTargetOs,
	arch: AgentTargetArch,
	version: string,
	body: string,
): { fetchImpl: AgentFetchImpl } {
	const assetUrl = versionedAssetUrl(osName, arch, version);
	const assetName = versionedAssetName(osName, arch, version);
	const fetchImpl = vi.fn<AgentFetchImpl>(async (url) => {
		if (url === assetUrl) {
			return response(body, { headers: { "content-length": String(body.length) } });
		}
		if (url === checksumUrl(version)) return response(sums(assetName, body));
		throw new Error(`unexpected URL ${url}`);
	});
	return { fetchImpl };
}

function versionedAssetName(osName: AgentTargetOs, arch: AgentTargetArch, version: string): string {
	const target = AGENT_TARGET_TABLE[osName][arch];
	if (!target.triple) throw new Error(`unsupported test target ${osName}/${arch}`);
	return `termora-agent-${target.triple}-${version}${target.ext}`;
}

function versionedAssetUrl(osName: AgentTargetOs, arch: AgentTargetArch, version: string): string {
	return `${DEFAULT_RELEASE_BASE_URL}/releases/download/v${version}/${versionedAssetName(osName, arch, version)}`;
}

function checksumUrl(version: string): string {
	return `${DEFAULT_RELEASE_BASE_URL}/releases/download/v${version}/SHA256SUMS-${version}.txt`;
}

function response(
	body: BodyInit | null,
	init: { readonly status?: number; readonly headers?: HeadersInit } = {},
): Response {
	return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

function sums(assetName: string, body: string): string {
	return `${createHash("sha256").update(body).digest("hex")}  ${assetName}\n`;
}

function listCache(cacheDir: string): string[] {
	return readdirSync(cacheDir)
		.filter((name) => !name.startsWith("SHA256SUMS-"))
		.sort();
}

async function waitForMessage<T extends AgentFetchMessage>(
	messages: AgentFetchMessage[],
	predicate: (message: AgentFetchMessage) => message is T,
): Promise<T> {
	const deadline = Date.now() + 1_000;
	for (;;) {
		const found = messages.find(predicate);
		if (found) return found;
		if (Date.now() >= deadline) throw new Error("Timed out waiting for agent fetch message");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
