import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdAgentFetch, getConfigDir, getStateDir, type ParsedArgs, parseArgs } from "./cli.js";
import {
	AGENT_TARGET_TRIPLES,
	type FetchAgentBinaryOptions,
	FetchError,
} from "./session/agent-fetch.js";

const TEST_VERSION = "0.4.1";

type AgentTargetEntry = {
	readonly triple: string | null;
	readonly ext: "" | ".exe";
	readonly built: boolean;
};

const AGENT_TARGET_TABLE = AGENT_TARGET_TRIPLES as Record<
	string,
	Record<string, AgentTargetEntry> | undefined
>;

let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	tempDirs = [];
});

describe("parseArgs", () => {
	describe("start", () => {
		it("parses bare start", () => {
			const r = parseArgs(["start"]);
			expect(r).not.toBeNull();
			expect(r?.command).toBe("start");
			expect(r?.port).toBeUndefined();
			expect(r?.daemon).toBeUndefined();
		});

		it("parses start --port 4200", () => {
			const r = parseArgs(["start", "--port", "4200"]);
			expect(r?.command).toBe("start");
			expect(r?.port).toBe(4200);
		});

		it("parses start --daemon", () => {
			const r = parseArgs(["start", "--daemon"]);
			expect(r?.command).toBe("start");
			expect(r?.daemon).toBe(true);
		});

		it("parses start --port 4200 --daemon", () => {
			const r = parseArgs(["start", "--port", "4200", "--daemon"]);
			expect(r?.command).toBe("start");
			expect(r?.port).toBe(4200);
			expect(r?.daemon).toBe(true);
		});
	});

	describe("stop / status", () => {
		it("parses stop", () => {
			const r = parseArgs(["stop"]);
			expect(r?.command).toBe("stop");
		});

		it("parses status", () => {
			const r = parseArgs(["status"]);
			expect(r?.command).toBe("status");
		});

		it("parses status --json", () => {
			const r = parseArgs(["status", "--json"]);
			expect(r?.command).toBe("status");
			expect(r?.json).toBe(true);
		});
	});

	describe("host add", () => {
		it("parses host add --label prod --host 10.0.0.1", () => {
			const r = parseArgs(["host", "add", "--label", "prod", "--host", "10.0.0.1"]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("prod");
			expect(r?.host).toBe("10.0.0.1");
		});

		it("parses host add with all flags", () => {
			const r = parseArgs([
				"host",
				"add",
				"--label",
				"staging",
				"--host",
				"192.168.1.5",
				"--ssh-port",
				"2222",
				"--user",
				"deploy",
				"--auth",
				"key",
			]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("staging");
			expect(r?.host).toBe("192.168.1.5");
			expect(r?.sshPort).toBe(2222);
			expect(r?.user).toBe("deploy");
			expect(r?.authMethod).toBe("key");
		});

		it("parses host list", () => {
			const r = parseArgs(["host", "list"]);
			expect(r?.command).toBe("host-list");
		});

		it("parses host list --json", () => {
			const r = parseArgs(["host", "list", "--json"]);
			expect(r?.command).toBe("host-list");
			expect(r?.json).toBe(true);
		});

		it("parses host remove <label>", () => {
			const r = parseArgs(["host", "remove", "old-server"]);
			expect(r?.command).toBe("host-remove");
			expect(r?.label).toBe("old-server");
		});
	});

	describe("agent fetch", () => {
		it("parses agent fetch <os-arch>", () => {
			const r = parseArgs(["agent", "fetch", "linux-arm64"]);
			expect(r?.command).toBe("agent-fetch");
			expect(r?.target).toBe("linux-arm64");
			expect(r?.all).toBeUndefined();
		});

		it("parses agent fetch --all", () => {
			const r = parseArgs(["agent", "fetch", "--all"]);
			expect(r?.command).toBe("agent-fetch");
			expect(r?.all).toBe(true);
			expect(r?.target).toBeUndefined();
		});

		it("parses agent fetch --version and --prune", () => {
			const r = parseArgs(["agent", "fetch", "linux-arm64", "--version", TEST_VERSION, "--prune"]);
			expect(r?.command).toBe("agent-fetch");
			expect(r?.target).toBe("linux-arm64");
			expect(r?.version).toBe(TEST_VERSION);
			expect(r?.prune).toBe(true);
		});

		it("does not clobber existing flag parsing or add -V handling", () => {
			const r = parseArgs(["start", "--port", "4200", "--version", TEST_VERSION]);
			expect(r?.command).toBe("start");
			expect(r?.port).toBe(4200);
			expect(r?.version).toBe(TEST_VERSION);
			expect(parseArgs(["-V"])).toBeNull();
		});
	});

	describe("session", () => {
		it("parses session list", () => {
			const r = parseArgs(["session", "list"]);
			expect(r?.command).toBe("session-list");
		});

		it("parses session list --json", () => {
			const r = parseArgs(["session", "list", "--json"]);
			expect(r?.command).toBe("session-list");
			expect(r?.json).toBe(true);
		});
	});

	describe("pair", () => {
		it("parses bare pair (generate mode)", () => {
			const r = parseArgs(["pair"]);
			expect(r?.command).toBe("pair");
			expect(r?.code).toBeUndefined();
		});

		it("parses pair --code 123456", () => {
			const r = parseArgs(["pair", "--code", "123456"]);
			expect(r?.command).toBe("pair");
			expect(r?.code).toBe("123456");
		});
	});

	describe("config edit", () => {
		it("parses config edit", () => {
			const r = parseArgs(["config", "edit"]);
			expect(r?.command).toBe("config-edit");
		});
	});

	describe("unknown commands", () => {
		it("returns null for empty argv", () => {
			expect(parseArgs([])).toBeNull();
		});

		it("returns null for unknown top-level command", () => {
			expect(parseArgs(["foobar"])).toBeNull();
		});

		it("returns null for 'host' with no sub-command", () => {
			expect(parseArgs(["host"])).toBeNull();
		});

		it("returns null for 'host bogus'", () => {
			expect(parseArgs(["host", "bogus"])).toBeNull();
		});

		it("returns null for 'session' with no sub-command", () => {
			expect(parseArgs(["session"])).toBeNull();
		});

		it("returns null for 'config' with no sub-command", () => {
			expect(parseArgs(["config"])).toBeNull();
		});
	});

	describe("flag ordering", () => {
		it("handles flags before positional args", () => {
			const r = parseArgs(["--label", "prod", "host", "add", "--host", "1.2.3.4"]);
			expect(r?.command).toBe("host-add");
			expect(r?.label).toBe("prod");
			expect(r?.host).toBe("1.2.3.4");
		});
	});
});

describe("cmdAgentFetch", () => {
	it("populates the cache, then no-ops when the target is already cached", async () => {
		const cacheDir = makeTempDir();
		const lines: string[] = [];
		const fetcher = vi.fn(async (options: FetchAgentBinaryOptions) => {
			const binaryPath = agentCachePath(
				options.cacheDir,
				options.os,
				options.arch,
				options.version,
			);
			mkdirSync(options.cacheDir, { recursive: true });
			writeFileSync(binaryPath, "agent");
			return binaryPath;
		});
		const args = parsed(["agent", "fetch", "linux-arm64"]);
		const expectedPath = agentCachePath(cacheDir, "linux", "arm64", TEST_VERSION);

		const firstCode = await cmdAgentFetch(args, {
			fetchAgentBinary: fetcher,
			getBinaryCacheDir: () => cacheDir,
			hubVersion: TEST_VERSION,
			writeLine: (line) => lines.push(line),
		});

		expect(firstCode).toBe(0);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(existsSync(expectedPath)).toBe(true);
		expect(lines).toEqual([expectedPath]);

		lines.length = 0;
		const secondCode = await cmdAgentFetch(args, {
			fetchAgentBinary: fetcher,
			getBinaryCacheDir: () => cacheDir,
			hubVersion: TEST_VERSION,
			writeLine: (line) => lines.push(line),
		});

		expect(secondCode).toBe(0);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(lines).toEqual([`already cached ${expectedPath}`]);
	});

	it("--all attempts every built target and returns non-zero when any target fails", async () => {
		const cacheDir = makeTempDir();
		const lines: string[] = [];
		const builtTargets = builtAgentTargetIds();
		const fetcher = vi.fn(async (options: FetchAgentBinaryOptions) => {
			const id = `${options.os}-${options.arch}`;
			if (id === "linux-x64") {
				throw new FetchError("PRIVATE_OR_FORBIDDEN", `manual gesture for ${id}`);
			}
			const binaryPath = agentCachePath(
				options.cacheDir,
				options.os,
				options.arch,
				options.version,
			);
			mkdirSync(options.cacheDir, { recursive: true });
			writeFileSync(binaryPath, "agent");
			return binaryPath;
		});

		const code = await cmdAgentFetch(parsed(["agent", "fetch", "--all"]), {
			fetchAgentBinary: fetcher,
			getBinaryCacheDir: () => cacheDir,
			hubVersion: TEST_VERSION,
			writeLine: (line) => lines.push(line),
		});

		expect(code).toBe(1);
		expect(fetcher).toHaveBeenCalledTimes(builtTargets.length);
		expect(fetcher.mock.calls.map(([options]) => `${options.os}-${options.arch}`)).toEqual(
			builtTargets,
		);
		expect(lines).toHaveLength(builtTargets.length);
		expect(lines[0]).toBe("manual gesture for linux-x64");
		expect(lines.at(-1)).toContain("termora-agent-windows-x64");
	});

	it("prints a FetchError actionable message and returns non-zero", async () => {
		const cacheDir = makeTempDir();
		const lines: string[] = [];
		const message =
			"Termora could not download https://example.test/asset. Manually download it, chmod 755 it, then rename it to the cache path.";
		const fetcher = vi.fn(async () => {
			throw new FetchError("PRIVATE_OR_FORBIDDEN", message);
		});

		const code = await cmdAgentFetch(parsed(["agent", "fetch", "linux-arm64"]), {
			fetchAgentBinary: fetcher,
			getBinaryCacheDir: () => cacheDir,
			hubVersion: TEST_VERSION,
			writeLine: (line) => lines.push(line),
		});

		expect(code).toBe(1);
		expect(lines).toEqual([message]);
	});

	it("--prune removes only stale regular files with known agent cache names", async () => {
		const cacheDir = makeTempDir();
		const current = agentCachePath(cacheDir, "linux", "x64", TEST_VERSION);
		const staleLinux = agentCachePath(cacheDir, "linux", "x64", "0.3.4");
		const staleWindows = agentCachePath(cacheDir, "windows", "x64", "0.3.4");
		const checksum = path.join(cacheDir, "SHA256SUMS-0.3.4.txt");
		const backup = path.join(cacheDir, "termora-agent-linux-x64-0.3.4.backup");
		const matchingDirectory = path.join(cacheDir, "termora-agent-linux-arm64-0.3.4");
		mkdirSync(matchingDirectory, { recursive: true });
		writeFileSync(current, "current");
		writeFileSync(staleLinux, "stale");
		writeFileSync(staleWindows, "stale");
		writeFileSync(checksum, "checksum");
		writeFileSync(backup, "backup");
		const fetcher = vi.fn(async () => {
			throw new Error("unexpected fetch");
		});
		const lines: string[] = [];

		const code = await cmdAgentFetch(
			parsed(["agent", "fetch", "linux-x64", "--version", TEST_VERSION, "--prune"]),
			{
				fetchAgentBinary: fetcher,
				getBinaryCacheDir: () => cacheDir,
				writeLine: (line) => lines.push(line),
			},
		);

		expect(code).toBe(0);
		expect(fetcher).not.toHaveBeenCalled();
		expect(lines).toEqual([`already cached ${current}`]);
		expect(existsSync(current)).toBe(true);
		expect(existsSync(staleLinux)).toBe(false);
		expect(existsSync(staleWindows)).toBe(false);
		expect(existsSync(checksum)).toBe(true);
		expect(existsSync(backup)).toBe(true);
		expect(existsSync(matchingDirectory)).toBe(true);
	});

	it.skipIf(process.platform === "win32")(
		"--prune never follows or deletes a symlink with an agent cache name",
		async () => {
			const cacheDir = makeTempDir();
			const current = agentCachePath(cacheDir, "linux", "x64", TEST_VERSION);
			writeFileSync(current, "current");
			// An out-of-cache file, and an agent-cache-named SYMLINK pointing at it.
			const outsideDir = makeTempDir();
			const outsideTarget = path.join(outsideDir, "outside-binary");
			writeFileSync(outsideTarget, "outside");
			const symlinkName = path.join(cacheDir, "termora-agent-linux-x64-0.3.5");
			symlinkSync(outsideTarget, symlinkName);
			const fetcher = vi.fn(async () => {
				throw new Error("unexpected fetch");
			});

			const code = await cmdAgentFetch(
				parsed(["agent", "fetch", "linux-x64", "--version", TEST_VERSION, "--prune"]),
				{
					fetchAgentBinary: fetcher,
					getBinaryCacheDir: () => cacheDir,
					writeLine: () => {},
				},
			);

			expect(code).toBe(0);
			// lstat (not stat) keeps prune fail-closed: the symlink is neither
			// followed nor deleted, and its out-of-cache target is untouched.
			// A stat-follow mutation would delete the link and fail this.
			expect(lstatSync(symlinkName).isSymbolicLink()).toBe(true);
			expect(existsSync(outsideTarget)).toBe(true);
			expect(readFileSync(outsideTarget, "utf8")).toBe("outside");
		},
	);

	it.skipIf(process.platform === "win32")(
		"does not report a symlinked cache entry as already cached (re-fetches instead)",
		async () => {
			const cacheDir = makeTempDir();
			const cachePath = agentCachePath(cacheDir, "linux", "x64", TEST_VERSION);
			const outside = path.join(makeTempDir(), "outside");
			writeFileSync(outside, "outside");
			// The cache entry is a SYMLINK, not a regular file — it must not be
			// trusted as "already cached"; the command must re-fetch (refresh) it.
			symlinkSync(outside, cachePath);
			const fetcher = vi.fn(async () => cachePath);
			const lines: string[] = [];

			const code = await cmdAgentFetch(
				parsed(["agent", "fetch", "linux-x64", "--version", TEST_VERSION]),
				{
					fetchAgentBinary: fetcher,
					getBinaryCacheDir: () => cacheDir,
					writeLine: (line) => lines.push(line),
				},
			);

			expect(code).toBe(0);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(lines).not.toContain(`already cached ${cachePath}`);
		},
	);

	it.skipIf(process.platform === "win32")(
		"refuses to prune through a symlinked cache directory",
		async () => {
			const realDir = makeTempDir();
			const stale = agentCachePath(realDir, "linux", "x64", "0.3.4");
			writeFileSync(stale, "stale");
			// The cache dir handed to the command is a SYMLINK to realDir. Pruning must
			// not readdir through it and delete the stale file in the link target.
			const linkDir = path.join(makeTempDir(), "link");
			symlinkSync(realDir, linkDir);
			const fetcher = vi.fn(async () => agentCachePath(linkDir, "linux", "x64", TEST_VERSION));

			const code = await cmdAgentFetch(
				parsed(["agent", "fetch", "linux-x64", "--version", TEST_VERSION, "--prune"]),
				{
					fetchAgentBinary: fetcher,
					getBinaryCacheDir: () => linkDir,
					writeLine: () => {},
				},
			);

			expect(code).toBe(0);
			expect(existsSync(stale)).toBe(true);
		},
	);
});

describe("path helpers", () => {
	it("getStateDir returns a non-empty string", () => {
		expect(getStateDir().length).toBeGreaterThan(0);
		expect(getStateDir()).toContain("termora");
	});

	it("getConfigDir returns a non-empty string", () => {
		expect(getConfigDir().length).toBeGreaterThan(0);
		expect(getConfigDir()).toContain("termora");
	});

	it.skipIf(process.platform === "win32")("getStateDir uses XDG_STATE_HOME when set", () => {
		const orig = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = "/tmp/xdg-state";
		expect(getStateDir()).toBe("/tmp/xdg-state/termora");
		process.env.XDG_STATE_HOME = orig;
	});

	it.skipIf(process.platform === "win32")("getConfigDir uses XDG_CONFIG_HOME when set", () => {
		const orig = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = "/tmp/xdg-cfg";
		expect(getConfigDir()).toBe("/tmp/xdg-cfg/termora");
		process.env.XDG_CONFIG_HOME = orig;
	});
});

function parsed(argv: string[]): ParsedArgs {
	const result = parseArgs(argv);
	expect(result).not.toBeNull();
	return result as ParsedArgs;
}

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "termora-cli-agent-fetch-"));
	tempDirs.push(dir);
	return dir;
}

function agentCachePath(cacheDir: string, osName: string, arch: string, version: string): string {
	const target = AGENT_TARGET_TABLE[osName]?.[arch];
	if (!target) throw new Error(`unknown target ${osName}-${arch}`);
	return path.join(cacheDir, `termora-agent-${osName}-${arch}-${version}${target.ext}`);
}

function builtAgentTargetIds(): string[] {
	const ids: string[] = [];
	for (const [osName, arches] of Object.entries(AGENT_TARGET_TABLE)) {
		if (!arches) continue;
		for (const [arch, target] of Object.entries(arches)) {
			if (target.built && target.triple) ids.push(`${osName}-${arch}`);
		}
	}
	return ids;
}
