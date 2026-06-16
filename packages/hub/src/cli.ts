/**
 * termora CLI
 *
 * Parses process.argv and dispatches to hub commands.
 * No heavy deps — manual argv parsing only.
 */

import { execFileSync, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	buildDaemonSpawnPlan,
	type ChildExitState,
	type DaemonReadyResult,
	openDaemonLog,
	readDaemonLogTail,
	waitForDaemonReady,
} from "./daemon-launch.js";
import { detectSea } from "./sea-addon-loader.js";
import {
	AGENT_TARGET_TRIPLES,
	type FetchAgentBinaryOptions,
	FetchError,
	fetchAgentBinary,
} from "./session/agent-fetch.js";

// ─── Platform paths ────────────────────────────────────────────────────────────

export function getStateDir(): string {
	if (process.platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? "", "termora");
	}
	return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "termora");
}

export function getConfigDir(): string {
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? "", "termora");
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "termora");
}

// ─── Runtime state ─────────────────────────────────────────────────────────────

export interface RuntimeInfo {
	pid: number;
	port: number;
	started_at: string;
}

export function loadRuntime(): RuntimeInfo | null {
	const p = join(getStateDir(), "runtime.json");
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf-8")) as RuntimeInfo;
	} catch {
		return null;
	}
}

export function persistRuntime(info: RuntimeInfo): void {
	const stateDir = getStateDir();
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(join(stateDir, "runtime.json"), JSON.stringify(info, null, 2));
}

export function deleteRuntime(): void {
	const p = join(getStateDir(), "runtime.json");
	if (existsSync(p)) rmSync(p);
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────

function loadAuthToken(): string | null {
	const p = join(getConfigDir(), "auth.json");
	if (!existsSync(p)) return null;
	try {
		const parsed = JSON.parse(readFileSync(p, "utf-8")) as { token?: string };
		return parsed.token ?? null;
	} catch {
		return null;
	}
}

// ─── HTTP client ───────────────────────────────────────────────────────────────

async function apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
	const runtime = loadRuntime();
	if (!runtime) {
		throw new Error("Hub is not running (no runtime.json found)");
	}

	const token = loadAuthToken();
	const headers: Record<string, string> = {};
	if (body !== undefined) headers["Content-Type"] = "application/json";
	if (token) headers.Authorization = `Bearer ${token}`;

	const url = `http://127.0.0.1:${runtime.port}${path}`;
	const res = await fetch(url, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HTTP ${res.status}: ${text}`);
	}

	const ct = res.headers.get("content-type") ?? "";
	if (ct.includes("application/json")) {
		return res.json();
	}
	return res.text();
}

// ─── Argument parser ───────────────────────────────────────────────────────────

export interface ParsedArgs {
	command: string;
	// start
	port?: number;
	daemon?: boolean;
	// host add
	label?: string;
	host?: string;
	sshPort?: number;
	user?: string;
	authMethod?: string;
	keyPath?: string;
	// pair verify
	code?: string;
	// agent fetch
	target?: string;
	version?: string;
	all?: boolean;
	prune?: boolean;
	// json output flag
	json?: boolean;
	// auto-open browser after start
	open?: boolean;
}

/**
 * Parse a flat argv array into a structured ParsedArgs.
 * Returns null if no command could be determined.
 */
export function parseArgs(argv: string[]): ParsedArgs | null {
	if (argv.length === 0) return null;

	const args = [...argv];
	const result: ParsedArgs = { command: "" };

	// Helper: consume a flag value (removes both flag and value from args)
	function flagValue(flag: string): string | undefined {
		const idx = args.indexOf(flag);
		if (idx === -1) return undefined;
		const val = args[idx + 1];
		args.splice(idx, 2);
		return val;
	}

	function hasFlag(flag: string): boolean {
		const idx = args.indexOf(flag);
		if (idx === -1) return false;
		args.splice(idx, 1);
		return true;
	}

	// Consume named flags first (order-independent)
	const portStr = flagValue("--port");
	if (portStr !== undefined) result.port = Number.parseInt(portStr, 10);

	const labelVal = flagValue("--label");
	if (labelVal !== undefined) result.label = labelVal;

	const hostVal = flagValue("--host");
	if (hostVal !== undefined) result.host = hostVal;

	const sshPortStr = flagValue("--ssh-port");
	if (sshPortStr !== undefined) result.sshPort = Number.parseInt(sshPortStr, 10);

	const userVal = flagValue("--user");
	if (userVal !== undefined) result.user = userVal;

	const authVal = flagValue("--auth");
	if (authVal !== undefined) result.authMethod = authVal;

	const keyPathVal = flagValue("--key-path");
	if (keyPathVal !== undefined) result.keyPath = keyPathVal;

	const codeVal = flagValue("--code");
	if (codeVal !== undefined) result.code = codeVal;

	const versionVal = flagValue("--version");
	if (versionVal !== undefined) result.version = versionVal;

	if (hasFlag("--daemon")) result.daemon = true;
	if (hasFlag("--json")) result.json = true;
	if (hasFlag("--open")) result.open = true;
	if (hasFlag("--all")) result.all = true;
	if (hasFlag("--prune")) result.prune = true;

	// Positional: remaining args after flag removal
	const positional = args.filter((a) => !a.startsWith("-"));

	const sub0 = positional[0];
	const sub1 = positional[1];
	const sub2 = positional[2];

	if (!sub0) return null;

	if (sub0 === "start") {
		result.command = "start";
	} else if (sub0 === "stop") {
		result.command = "stop";
	} else if (sub0 === "status") {
		result.command = "status";
	} else if (sub0 === "host") {
		if (sub1 === "add") {
			result.command = "host-add";
		} else if (sub1 === "list") {
			result.command = "host-list";
		} else if (sub1 === "remove") {
			result.command = "host-remove";
			if (!result.label && sub2) result.label = sub2;
		} else {
			return null;
		}
	} else if (sub0 === "agent") {
		if (sub1 === "fetch") {
			result.command = "agent-fetch";
			if (sub2) result.target = sub2;
		} else {
			return null;
		}
	} else if (sub0 === "session") {
		if (sub1 === "list") {
			result.command = "session-list";
		} else {
			return null;
		}
	} else if (sub0 === "pair") {
		result.command = "pair";
	} else if (sub0 === "config") {
		if (sub1 === "edit") {
			result.command = "config-edit";
		} else {
			return null;
		}
	} else {
		return null;
	}

	return result;
}

// ─── Agent fetch helpers ──────────────────────────────────────────────────────

type AgentTargetEntry = {
	readonly triple: string | null;
	readonly ext: "" | ".exe";
	readonly built: boolean;
};

type AgentFetchTarget = {
	readonly os: string;
	readonly arch: string;
};

type AgentBinaryFetcher = (options: FetchAgentBinaryOptions) => Promise<string>;

export interface AgentFetchCommandDeps {
	readonly fetchAgentBinary?: AgentBinaryFetcher;
	readonly getBinaryCacheDir?: () => string | Promise<string>;
	readonly hubVersion?: string;
	readonly writeLine?: (line: string) => void;
	readonly writeError?: (line: string) => void;
}

const STRICT_AGENT_VERSION = /^\d+\.\d+\.\d+$/;

const AGENT_TARGET_TABLE = AGENT_TARGET_TRIPLES as Record<
	string,
	Record<string, AgentTargetEntry> | undefined
>;

async function defaultHubVersion(): Promise<string> {
	const { HUB_VERSION } = await import("./build-version.js");
	return HUB_VERSION;
}

async function defaultBinaryCacheDir(): Promise<string> {
	const { getBinaryCacheDir } = await import("./session/agent-deployer.js");
	return getBinaryCacheDir();
}

function builtAgentTargets(): AgentFetchTarget[] {
	const targets: AgentFetchTarget[] = [];
	for (const [os, arches] of Object.entries(AGENT_TARGET_TABLE)) {
		if (!arches) continue;
		for (const [arch, target] of Object.entries(arches)) {
			if (target.built && target.triple) targets.push({ os, arch });
		}
	}
	return targets;
}

function parseAgentTargetId(value: string): AgentFetchTarget | null {
	const parts = value.split("-");
	if (parts.length !== 2) return null;
	const [os, arch] = parts;
	if (!os || !arch) return null;
	return { os, arch };
}

function resolveAgentFetchTargets(args: ParsedArgs): AgentFetchTarget[] | string {
	if (args.all && args.target) {
		return "Choose either an agent target or --all, not both.";
	}
	if (args.all) return builtAgentTargets();
	if (!args.target) {
		return "Usage: termora agent fetch <os-arch>|--all [--version <x.y.z>] [--prune]";
	}
	const target = parseAgentTargetId(args.target);
	if (!target) {
		return `Invalid agent target "${args.target}". Use <os-arch>, for example linux-arm64.`;
	}
	return [target];
}

function badVersionError(version: string): FetchError | null {
	if (STRICT_AGENT_VERSION.test(version) && version !== "0.0.0") return null;
	return new FetchError(
		"BAD_VERSION",
		`Bad Termora agent version "${version}". Use a released strict semver like 0.4.0, or rerun termora-hub agent fetch --version <x.y.z> with a real release version before downloading.`,
	);
}

function cachePathForBuiltTarget(
	cacheDir: string,
	target: AgentFetchTarget,
	version: string,
): string | null {
	const entry = AGENT_TARGET_TABLE[target.os]?.[target.arch];
	if (!entry?.built || !entry.triple) return null;
	return join(cacheDir, `termora-agent-${target.os}-${target.arch}-${version}${entry.ext}`);
}

function parseAgentBinaryCacheName(name: string): { readonly version: string } | null {
	for (const [os, arches] of Object.entries(AGENT_TARGET_TABLE)) {
		if (!arches) continue;
		for (const [arch, target] of Object.entries(arches)) {
			const prefix = `termora-agent-${os}-${arch}-`;
			if (!name.startsWith(prefix) || !name.endsWith(target.ext)) continue;
			const versionEnd = target.ext.length > 0 ? name.length - target.ext.length : name.length;
			const version = name.slice(prefix.length, versionEnd);
			if (STRICT_AGENT_VERSION.test(version)) return { version };
		}
	}
	return null;
}

function pruneAgentBinaryCache(cacheDir: string, version: string): number {
	if (!existsSync(cacheDir)) return 0;

	let removed = 0;
	for (const name of readdirSync(cacheDir)) {
		const parsed = parseAgentBinaryCacheName(name);
		if (!parsed || parsed.version === version) continue;

		const path = join(cacheDir, name);
		try {
			// lstat (not stat): never follow a symlink when deciding what to delete.
			if (!lstatSync(path).isFile()) continue;
			rmSync(path);
			removed++;
		} catch {
			// Entry vanished or was unremovable mid-prune (raced removal); prune is
			// best-effort cleanup, so skip it.
		}
	}
	return removed;
}

export async function cmdAgentFetch(
	args: ParsedArgs,
	deps: AgentFetchCommandDeps = {},
): Promise<number> {
	const writeLine = deps.writeLine ?? ((line: string) => console.log(line));
	const writeError = deps.writeError ?? ((line: string) => console.error(line));
	const targets = resolveAgentFetchTargets(args);
	if (typeof targets === "string") {
		writeError(targets);
		return 1;
	}

	const version = args.version ?? deps.hubVersion ?? (await defaultHubVersion());
	const versionError = badVersionError(version);
	if (versionError) {
		writeError(versionError.message);
		return 1;
	}

	const cacheDir = await (deps.getBinaryCacheDir ?? defaultBinaryCacheDir)();
	const fetcher = deps.fetchAgentBinary ?? fetchAgentBinary;
	let failed = false;

	for (const target of targets) {
		const existing = cachePathForBuiltTarget(cacheDir, target, version);
		if (existing && existsSync(existing)) {
			writeLine(`already cached ${existing}`);
			continue;
		}

		try {
			const path = await fetcher({
				os: target.os,
				arch: target.arch,
				version,
				cacheDir,
			});
			writeLine(path);
		} catch (error) {
			failed = true;
			const message = error instanceof Error ? error.message : String(error);
			writeLine(message);
		}
	}

	if (args.prune) pruneAgentBinaryCache(cacheDir, version);
	return failed ? 1 : 0;
}

// ─── Command handlers ──────────────────────────────────────────────────────────

async function cmdStart(args: ParsedArgs): Promise<void> {
	const existing = loadRuntime();
	if (existing && isPidAlive(existing.pid)) {
		console.error(`Hub already running (pid ${existing.pid} on port ${existing.port})`);
		process.exit(1);
	}

	const port = args.port ?? 4100;

	if (args.daemon) {
		const stateDir = getStateDir();
		mkdirSync(stateDir, { recursive: true });
		const logPath = join(stateDir, "hub-daemon.log");
		const logFd = openDaemonLog(logPath);
		const plan = buildDaemonSpawnPlan({
			sea: detectSea(),
			port,
			...(args.open ? { open: true } : {}),
			moduleUrl: import.meta.url,
		});
		let childExit: ChildExitState = { exited: false };
		const child = spawn(process.execPath, plan.args, {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: {
				...process.env,
				...plan.env,
			},
		});
		child.on("exit", (code, signal) => {
			childExit = { exited: true, code, signal };
		});
		child.on("error", (err) => {
			childExit = { exited: true, code: null, signal: null, errorMessage: err.message };
		});
		child.unref();
		if (child.pid === undefined) {
			console.error("Failed to start daemon process: child pid was not reported");
			closeSync(logFd);
			process.exit(1);
		}
		const childPid = child.pid;

		// Single source of truth for both probe bounds (socket abort + race).
		const healthTimeoutMs = 2000;
		let result: DaemonReadyResult;
		try {
			result = await waitForDaemonReady({
				childPid,
				loadRuntime,
				fetchHealth: async (runtimePort) => {
					// Abort a stalled probe so the socket is not left hanging open.
					const res = await fetch(`http://127.0.0.1:${runtimePort}/api/health`, {
						signal: AbortSignal.timeout(healthTimeoutMs),
					});
					if (!res.ok) {
						throw new Error(`Health check failed with HTTP ${res.status}`);
					}
					return res.json();
				},
				getChildExit: () => childExit,
				readLogTail: () => readDaemonLogTail(logPath),
				// Kill via the ChildProcess handle: a raw process.kill(pid) could
				// hit an unrelated process if the OS reused the pid.
				killChild: () => {
					child.kill("SIGTERM");
				},
				now: () => Date.now(),
				sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
				healthTimeoutMs,
			});
		} catch (err) {
			closeSync(logFd);
			throw err;
		}

		closeSync(logFd);
		if (result.ok) {
			console.log(`Hub daemon ready (pid ${result.pid} on port ${result.port})`);
			process.exit(0);
		}

		console.error(result.message);
		process.exit(1);
	}

	// Foreground — dynamic import keeps heavy deps out of parse-time module graph
	const { createServer, startServer } = await import("./server.js");
	const { initAuth } = await import("./auth.js");
	const { openDatabases } = await import("./storage/db.js");
	const { openBrowser } = await import("./open-browser.js");

	const configDir = getConfigDir();
	const stateDir = getStateDir();
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });

	const authToken = initAuth(configDir);
	const dbManager = openDatabases(stateDir);

	const { BUILD_HASH } = await import("./build-version.js");

	const server = await createServer({ port, authToken, dbManager });
	const address = await startServer(server, { port });

	// Extract actual port (may differ from requested due to zero_conf)
	const actualPort = new URL(address).port ? Number(new URL(address).port) : port;
	persistRuntime({ pid: process.pid, port: actualPort, started_at: new Date().toISOString() });

	console.log(`termora hub listening on ${address} (build: ${BUILD_HASH})`);
	console.log(`Config dir : ${configDir}`);
	console.log(`State dir  : ${stateDir}`);

	// Open browser if requested via --open flag or TERMORA_OPEN env (set by daemon spawner)
	const shouldOpen = args.open === true || process.env.TERMORA_OPEN === "1";
	if (shouldOpen) {
		const url = `http://127.0.0.1:${actualPort}`;
		console.log(`Opening browser: ${url}`);
		openBrowser(url);
	}

	const shutdown = async () => {
		deleteRuntime();
		await server.close();
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

async function cmdStop(): Promise<void> {
	const runtime = loadRuntime();
	if (!runtime) {
		console.error("Hub is not running (no runtime.json)");
		process.exit(1);
	}
	if (!isPidAlive(runtime.pid)) {
		console.log("Hub process is gone — cleaning up stale runtime.json");
		deleteRuntime();
		return;
	}
	process.kill(runtime.pid, "SIGTERM");
	console.log(`Sent SIGTERM to hub (pid ${runtime.pid})`);
	deleteRuntime();
}

async function cmdStatus(args: ParsedArgs): Promise<void> {
	const runtime = loadRuntime();
	if (!runtime) {
		if (args.json) {
			console.log(JSON.stringify({ running: false }));
		} else {
			console.log("Hub: stopped (no runtime.json)");
		}
		return;
	}

	const alive = isPidAlive(runtime.pid);
	if (!alive) {
		if (args.json) {
			console.log(JSON.stringify({ running: false, stale: true, pid: runtime.pid }));
		} else {
			console.log(`Hub: stale (pid ${runtime.pid} no longer alive)`);
		}
		return;
	}

	let health: unknown = null;
	try {
		health = await fetch(`http://127.0.0.1:${runtime.port}/api/health`).then((r) => r.json());
	} catch {
		// Not reachable yet — not fatal
	}

	if (args.json) {
		console.log(
			JSON.stringify({
				running: true,
				pid: runtime.pid,
				port: runtime.port,
				started_at: runtime.started_at,
				health,
			}),
		);
	} else {
		console.log("Hub: running");
		console.log(`  PID        : ${runtime.pid}`);
		console.log(`  Port       : ${runtime.port}`);
		console.log(`  Started at : ${runtime.started_at}`);
		if (health && typeof health === "object" && health !== null) {
			const h = health as Record<string, unknown>;
			console.log(`  Status     : ${String(h.status ?? "?")}`);
			console.log(`  Uptime     : ${Number(h.uptime ?? 0).toFixed(1)}s`);
		}
	}
}

async function cmdHostAdd(args: ParsedArgs): Promise<void> {
	if (!args.label || !args.host) {
		console.error(
			"Usage: termora host add --label <label> --host <user@hostname> [--ssh-port 22] [--auth agent|key] [--key-path ~/.ssh/id_ed25519]",
		);
		process.exit(1);
	}

	const body: Record<string, unknown> = {
		type: "ssh",
		label: args.label,
		ssh_host: args.host,
	};
	if (args.sshPort !== undefined) body.ssh_port = args.sshPort;
	if (args.authMethod) body.ssh_auth = args.authMethod;
	if (args.keyPath) body.ssh_key_path = args.keyPath;

	const result = await apiRequest("POST", "/api/hosts", body);
	if (args.json) {
		console.log(JSON.stringify(result));
	} else {
		const r = result as Record<string, unknown>;
		console.log(`Host added: ${String(r.label ?? args.label)} (id: ${String(r.id ?? "?")})`);
	}
}

async function cmdHostList(args: ParsedArgs): Promise<void> {
	const result = await apiRequest("GET", "/api/hosts");
	const hosts = result as Array<Record<string, unknown>>;
	if (args.json) {
		console.log(JSON.stringify(hosts));
		return;
	}
	if (!hosts.length) {
		console.log("No hosts configured.");
		return;
	}
	const pad = (s: string, n: number) => s.padEnd(n);
	console.log(`${pad("LABEL", 20)}  ${pad("HOST", 30)}  ${pad("PORT", 6)}  USER`);
	console.log(`${"-".repeat(20)}  ${"-".repeat(30)}  ${"-".repeat(6)}  ----`);
	for (const h of hosts) {
		console.log(
			`${pad(String(h.label ?? ""), 20)}  ${pad(String(h.hostname ?? ""), 30)}  ${pad(String(h.port ?? 22), 6)}  ${String(h.username ?? "")}`,
		);
	}
}

async function cmdHostRemove(args: ParsedArgs): Promise<void> {
	if (!args.label) {
		console.error("Usage: termora host remove <label>");
		process.exit(1);
	}

	// Resolve label → id (API uses ULID, not label)
	const hosts = (await apiRequest("GET", "/api/hosts")) as Array<Record<string, unknown>>;
	const match = hosts.find((h) => h.label === args.label);
	if (!match?.id) {
		console.error(`Host "${args.label}" not found.`);
		process.exit(1);
	}

	await apiRequest("DELETE", `/api/hosts/${encodeURIComponent(String(match.id))}`);
	console.log(`Host "${args.label}" removed.`);
}

async function cmdSessionList(args: ParsedArgs): Promise<void> {
	const result = await apiRequest("GET", "/api/sessions");
	const sessions = result as Array<Record<string, unknown>>;
	if (args.json) {
		console.log(JSON.stringify(sessions));
		return;
	}
	if (!sessions.length) {
		console.log("No active sessions.");
		return;
	}
	const pad = (s: string, n: number) => s.padEnd(n);
	console.log(`${pad("ID", 26)}  ${pad("HOST", 20)}  ${pad("STATE", 12)}  CREATED`);
	console.log(`${"-".repeat(26)}  ${"-".repeat(20)}  ${"-".repeat(12)}  -------`);
	for (const s of sessions) {
		console.log(
			`${pad(String(s.id ?? ""), 26)}  ${pad(String(s.host_label ?? s.host_id ?? ""), 20)}  ${pad(String(s.state ?? ""), 12)}  ${String(s.created_at ?? "")}`,
		);
	}
}

async function cmdPair(args: ParsedArgs): Promise<void> {
	if (args.code) {
		const result = await apiRequest("POST", "/api/pair/verify", { code: args.code });
		if (args.json) {
			console.log(JSON.stringify(result));
		} else {
			const r = result as Record<string, unknown>;
			console.log(`Pairing successful. Token: ${String(r.token ?? "")}`);
		}
	} else {
		const result = await apiRequest("POST", "/api/pair");
		if (args.json) {
			console.log(JSON.stringify(result));
		} else {
			const r = result as Record<string, unknown>;
			console.log(`Pairing code : ${String(r.code ?? "")}`);
			console.log(`Expires at   : ${String(r.expires_at ?? "")}`);
			console.log("Share this code with the client to authorise it.");
		}
	}
}

async function cmdConfigEdit(): Promise<void> {
	const configPath = join(getConfigDir(), "config.toml");
	const editor =
		process.env.VISUAL ?? process.env.EDITOR ?? (process.platform === "win32" ? "notepad" : "vi");

	console.log(`Opening ${configPath} in ${editor}…`);
	try {
		execFileSync(editor, [configPath], { stdio: "inherit" });
	} catch (err) {
		console.error(`Failed to open editor: ${(err as Error).message}`);
		process.exit(1);
	}
}

// ─── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
	console.log(`termora — local-first session terminal platform

Usage:
  termora start [--port 4100] [--daemon]       Start hub (foreground or daemon)
              [--open]                          Open browser after start
  termora stop                                  Stop running hub
  termora status [--json]                       Show hub status

  termora host add --label X --host user@Y      Add an SSH host
              [--ssh-port 22] [--auth agent|key]
              [--key-path ~/.ssh/id_ed25519]
  termora host list [--json]                    List all hosts
  termora host remove <label>                   Remove a host

  termora agent fetch <os-arch>|--all           Populate the agent binary cache
              [--version x.y.z] [--prune]

  termora session list [--json]                 List active sessions

  termora pair                                  Generate pairing code
  termora pair --code XXXXXX                    Verify pairing code

  termora config edit                           Open config.toml in $EDITOR
`);
}

// ─── Entry point ───────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
		printHelp();
		return;
	}

	const parsed = parseArgs(argv);

	if (!parsed) {
		console.error(`Unknown command: ${argv.join(" ")}`);
		console.error("Run 'termora --help' for usage.");
		process.exit(1);
	}

	try {
		switch (parsed.command) {
			case "start":
				await cmdStart(parsed);
				break;
			case "stop":
				await cmdStop();
				break;
			case "status":
				await cmdStatus(parsed);
				break;
			case "host-add":
				await cmdHostAdd(parsed);
				break;
			case "host-list":
				await cmdHostList(parsed);
				break;
			case "host-remove":
				await cmdHostRemove(parsed);
				break;
			case "agent-fetch": {
				const code = await cmdAgentFetch(parsed);
				if (code !== 0) process.exit(code);
				break;
			}
			case "session-list":
				await cmdSessionList(parsed);
				break;
			case "pair":
				await cmdPair(parsed);
				break;
			case "config-edit":
				await cmdConfigEdit();
				break;
			default:
				console.error(`Unknown command: ${parsed.command}`);
				process.exit(1);
		}
	} catch (err) {
		console.error(`Error: ${(err as Error).message}`);
		process.exit(1);
	}
}
