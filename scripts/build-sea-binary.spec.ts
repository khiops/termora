/**
 * build-sea-binary.spec.ts
 *
 * Tests for the generic SEA binary builder (build-sea-binary.ts) and
 * the agent-specific packaging script (package-sea-agent.ts).
 */

import { spawnSync } from "node:child_process";
import {
	accessSync,
	existsSync,
	constants as fsConstants,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** True if postject is available via npx (check once, cache). */
let _postjectAvailable: boolean | undefined;
function isPostjectAvailable(): boolean {
	if (_postjectAvailable !== undefined) return _postjectAvailable;
	const result = spawnSync("npx", ["postject", "--version"], {
		timeout: 10_000,
		stdio: "pipe",
	});
	_postjectAvailable = result.status === 0;
	return _postjectAvailable;
}

/** True if this is Node >= 20 (required for SEA). */
function isNodeGte20(): boolean {
	const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
	return major >= 20;
}

/** Check if --experimental-sea-config is available on this Node. */
function isSeaAvailable(): boolean {
	const result = spawnSync(process.execPath, ["--experimental-sea-config", "/dev/null"], {
		stdio: "pipe",
		timeout: 5_000,
	});
	// It fails with non-zero because /dev/null is not a valid config,
	// but it should NOT say "bad option" or "unknown flag".
	const stderr = result.stderr?.toString() ?? "";
	return !stderr.includes("bad option") && !stderr.includes("Unknown option");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 1: generates valid sea-config.json
// ────────────────────────────────────────────────────────────────────────────

describe("buildSeaConfigJson generates valid sea-config.json structure", () => {
	it("includes main, output, assets, disableExperimentalSEAWarning, useCodeCache", async () => {
		const { buildSeaConfigJson } = await import("./build-sea-binary.js");

		const cfg = {
			entryScript: "/abs/path/agent.cjs",
			outputBinary: "/abs/path/nexterm-agent",
			name: "nexterm-agent",
			nativeAddons: { "pty.node": "/abs/path/pty.node" },
			extraAssets: { VERSION: "/abs/path/VERSION" },
			useCodeCache: true,
			disableExperimentalSEAWarning: true,
		};

		const result = buildSeaConfigJson(cfg, "/abs/path/sea-prep.blob");

		expect(result).toMatchObject({
			main: "/abs/path/agent.cjs",
			output: "/abs/path/sea-prep.blob",
			disableExperimentalSEAWarning: true,
			useCodeCache: true,
		});

		// Assets must include both nativeAddons and extraAssets
		expect(result.assets).toMatchObject({
			"pty.node": "/abs/path/pty.node",
			VERSION: "/abs/path/VERSION",
		});
	});

	it("defaults disableExperimentalSEAWarning and useCodeCache to true", async () => {
		const { buildSeaConfigJson } = await import("./build-sea-binary.js");

		const cfg = {
			entryScript: "/a/entry.cjs",
			outputBinary: "/a/out",
			name: "test",
			nativeAddons: {},
		};

		const result = buildSeaConfigJson(cfg, "/a/blob");
		expect(result.disableExperimentalSEAWarning).toBe(true);
		expect(result.useCodeCache).toBe(true);
	});

	it("allows overriding defaults to false", async () => {
		const { buildSeaConfigJson } = await import("./build-sea-binary.js");

		const cfg = {
			entryScript: "/a/entry.cjs",
			outputBinary: "/a/out",
			name: "test",
			nativeAddons: {},
			useCodeCache: false,
			disableExperimentalSEAWarning: false,
		};

		const result = buildSeaConfigJson(cfg, "/a/blob");
		expect(result.useCodeCache).toBe(false);
		expect(result.disableExperimentalSEAWarning).toBe(false);
	});

	it("handles empty nativeAddons and no extraAssets", async () => {
		const { buildSeaConfigJson } = await import("./build-sea-binary.js");

		const cfg = {
			entryScript: "/a/entry.cjs",
			outputBinary: "/a/out",
			name: "test",
			nativeAddons: {},
		};

		const result = buildSeaConfigJson(cfg, "/a/blob");
		expect(result.assets).toEqual({});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 2: locates node-pty native addon
// ────────────────────────────────────────────────────────────────────────────

describe("node-pty native addon location", () => {
	it("pty.node exists under packages/agent/node_modules/node-pty", () => {
		// This verifies the pnpm symlink is in place and the native addon
		// was compiled during pnpm install.
		const ptyNodePath = join(
			ROOT,
			"packages",
			"agent",
			"node_modules",
			"node-pty",
			"build",
			"Release",
			"pty.node",
		);
		expect(existsSync(ptyNodePath)).toBe(true);
	});

	it("pty.node is a non-empty file (compiled native addon)", () => {
		const ptyNodePath = join(
			ROOT,
			"packages",
			"agent",
			"node_modules",
			"node-pty",
			"build",
			"Release",
			"pty.node",
		);
		if (!existsSync(ptyNodePath)) return; // already covered by above
		const stat = readFileSync(ptyNodePath);
		expect(stat.byteLength).toBeGreaterThan(1024);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 3: full agent SEA build produces executable
// ────────────────────────────────────────────────────────────────────────────

describe("full agent SEA build produces executable", { timeout: 120_000 }, () => {
	// Use a separate output path so this test never overwrites the canonical
	// dist/sea/nexterm-agent binary that sea-agent-e2e.spec.ts depends on.
	// Both spec files run concurrently within the "scripts" vitest project.
	const outputBinary = join(ROOT, "dist", "sea", "nexterm-agent-buildtest");

	it.skipIf(!isNodeGte20() || !isPostjectAvailable() || !isSeaAvailable())(
		"builds nexterm-agent binary that is executable and runs",
		async () => {
			// Step a: run esbuild bundle (build-sea-agent.ts)
			const { build } = await import("esbuild");
			const { buildOptions } = await import("./build-sea-agent.js");
			mkdirSync(join(ROOT, "dist", "sea"), { recursive: true });
			const esbuildResult = await build(buildOptions);
			expect(esbuildResult.errors.length).toBe(0);

			// Step b: run SEA packaging (build-sea-binary.ts)
			const { buildSeaBinary } = await import("./build-sea-binary.js");
			const ptyNodePath = join(
				ROOT,
				"packages",
				"agent",
				"node_modules",
				"node-pty",
				"build",
				"Release",
				"pty.node",
			);

			const versionFilePath = join(ROOT, "dist", "sea", "VERSION");
			writeFileSync(versionFilePath, "0.1.0", "utf8");

			await buildSeaBinary({
				entryScript: join(ROOT, "dist", "sea", "nexterm-agent.cjs"),
				outputBinary,
				name: "nexterm-agent",
				nativeAddons: { "pty.node": ptyNodePath },
				extraAssets: { VERSION: versionFilePath },
				useCodeCache: true,
				disableExperimentalSEAWarning: true,
			});

			// Step c: verify output binary exists
			expect(existsSync(outputBinary)).toBe(true);

			// Step d: verify binary is executable
			expect(() => accessSync(outputBinary, fsConstants.X_OK)).not.toThrow();

			// Step e: run binary with --help and verify it doesn't crash
			// The agent binary may not have a --help flag but it should at
			// least start without crashing (prints to stderr or stdout).
			const result = spawnSync(outputBinary, ["--help"], {
				timeout: 10_000,
				stdio: "pipe",
			});
			// Binary must not crash with signal SIGSEGV or similar.
			// Exit code 1 is acceptable (unknown flag), but no signal.
			expect(result.signal).toBeNull();
		},
	);
});

// ────────────────────────────────────────────────────────────────────────────
// Test 4: VERSION asset contains correct version
// ────────────────────────────────────────────────────────────────────────────

describe("VERSION asset contains correct version", () => {
	it("reads version from packages/agent/package.json", () => {
		const pkgPath = join(ROOT, "packages", "agent", "package.json");
		expect(existsSync(pkgPath)).toBe(true);

		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
			version?: string;
		};
		expect(typeof pkg.version).toBe("string");
		// Semver pattern
		expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	it("VERSION file (if present) matches package.json version", () => {
		const versionFilePath = join(ROOT, "dist", "sea", "VERSION");
		if (!existsSync(versionFilePath)) {
			// Not yet built — skip
			return;
		}

		const versionFileContent = readFileSync(versionFilePath, "utf8").trim();
		const pkg = JSON.parse(
			readFileSync(join(ROOT, "packages", "agent", "package.json"), "utf8"),
		) as { version?: string };

		expect(versionFileContent).toBe(pkg.version);
	});
});
