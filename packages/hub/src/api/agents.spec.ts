import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_TARGET_TRIPLES } from "../session/agent-cache.js";
import type { AgentTargetArch, AgentTargetOs, HubPlatform } from "../session/agent-status.js";
import { registerAgentRoutes } from "./agents.js";

const TEST_TOKEN = "a".repeat(64);
const HUB_VERSION = "0.4.1";
const HUB_PLATFORM = { os: "linux", arch: "x64" } as const satisfies HubPlatform;
const BUNDLED_PATH = "/tmp/termora-agent-api-test";

type AgentTargetEntry = {
	readonly triple: string | null;
	readonly ext: "" | ".exe";
	readonly built: boolean;
};

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

function agentCachePath(
	cacheDir: string,
	osName: AgentTargetOs,
	arch: AgentTargetArch,
	version: string,
): string {
	const target = AGENT_TARGET_TABLE[osName][arch];
	return path.join(cacheDir, `termora-agent-${osName}-${arch}-${version}${target.ext}`);
}
