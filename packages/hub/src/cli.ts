/**
 * nexterm CLI — Block 5.6
 *
 * Parses process.argv and dispatches to hub commands.
 * No heavy deps — manual argv parsing only.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Platform paths ────────────────────────────────────────────────────────────

export function getStateDir(): string {
	if (process.platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? "", "nexterm");
	}
	return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "nexterm");
}

export function getConfigDir(): string {
	if (process.platform === "win32") {
		return join(process.env.APPDATA ?? "", "nexterm");
	}
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "nexterm");
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
	// pair verify
	code?: string;
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

	const codeVal = flagValue("--code");
	if (codeVal !== undefined) result.code = codeVal;

	if (hasFlag("--daemon")) result.daemon = true;
	if (hasFlag("--json")) result.json = true;
	if (hasFlag("--open")) result.open = true;

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

// ─── Command handlers ──────────────────────────────────────────────────────────

async function cmdStart(args: ParsedArgs): Promise<void> {
	const existing = loadRuntime();
	if (existing && isPidAlive(existing.pid)) {
		console.error(`Hub already running (pid ${existing.pid} on port ${existing.port})`);
		process.exit(1);
	}

	const port = args.port ?? 4100;

	if (args.daemon) {
		// Resolve the compiled main.js sibling path
		const mainPath = fileURLToPath(new URL("./main.js", import.meta.url));
		const child = spawn(process.execPath, [mainPath], {
			detached: true,
			stdio: "ignore",
			env: {
				...process.env,
				NEXTERM_PORT: String(port),
				...(args.open ? { NEXTERM_OPEN: "1" } : {}),
			},
		});
		child.unref();
		console.log(`Hub starting as daemon (pid ${child.pid ?? "?"} on port ${port})`);
		return;
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

	const server = await createServer({ port, authToken, dbManager });
	const address = await startServer(server, { port });

	persistRuntime({ pid: process.pid, port, started_at: new Date().toISOString() });

	console.log(`nexterm hub listening on ${address}`);
	console.log(`Config dir : ${configDir}`);
	console.log(`State dir  : ${stateDir}`);

	// Open browser if requested via --open flag or NEXTERM_OPEN env (set by daemon spawner)
	const shouldOpen = args.open === true || process.env.NEXTERM_OPEN === "1";
	if (shouldOpen) {
		const url = `http://127.0.0.1:${port}`;
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
			"Usage: nexterm host add --label <label> --host <hostname> [--ssh-port 22] [--user <user>] [--auth agent|key]",
		);
		process.exit(1);
	}

	const body: Record<string, unknown> = {
		label: args.label,
		hostname: args.host,
	};
	if (args.sshPort !== undefined) body.port = args.sshPort;
	if (args.user) body.username = args.user;
	if (args.authMethod) body.auth_method = args.authMethod;

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
		console.error("Usage: nexterm host remove <label>");
		process.exit(1);
	}

	await apiRequest("DELETE", `/api/hosts/${encodeURIComponent(args.label)}`);
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
	console.log(`nexterm — local-first session terminal platform

Usage:
  nexterm start [--port 4100] [--daemon]       Start hub (foreground or daemon)
              [--open]                          Open browser after start
  nexterm stop                                  Stop running hub
  nexterm status [--json]                       Show hub status

  nexterm host add --label X --host Y           Add a host
              [--ssh-port 22] [--user Z]
              [--auth agent|key]
  nexterm host list [--json]                    List all hosts
  nexterm host remove <label>                   Remove a host

  nexterm session list [--json]                 List active sessions

  nexterm pair                                  Generate pairing code
  nexterm pair --code XXXXXX                    Verify pairing code

  nexterm config edit                           Open config.toml in $EDITOR
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
		console.error("Run 'nexterm --help' for usage.");
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
