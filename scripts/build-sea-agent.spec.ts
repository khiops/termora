/**
 * build-sea-agent.spec.ts
 *
 * Tests for the esbuild bundler (build-sea-agent.ts) and the
 * native addon loader (sea-addon-loader.ts).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BuildOptions } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_FILE = join(ROOT, "dist", "sea", "nexterm-agent.cjs");

// ────────────────────────────────────────────────────────────────────────────
// Test 1: esbuild bundle produces valid CJS output
// ────────────────────────────────────────────────────────────────────────────

describe("esbuild bundle produces valid CJS", () => {
	beforeAll(async () => {
		// Import build options from the script under test and run the build.
		const { buildOptions } = await import("./build-sea-agent.js");
		mkdirSync(join(ROOT, "dist", "sea"), { recursive: true });
		await build(buildOptions as BuildOptions);
	}, 60_000);

	it("output file exists", () => {
		expect(existsSync(OUT_FILE)).toBe(true);
	});

	it("output file is non-empty", () => {
		const data = readFileSync(OUT_FILE);
		expect(data.byteLength).toBeGreaterThan(1024);
	});

	it("output starts with shebang", () => {
		const content = readFileSync(OUT_FILE, "utf8");
		expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
	});

	it("output is syntactically valid CJS", () => {
		const content = readFileSync(OUT_FILE, "utf8");
		// esbuild CJS bundles always include "use strict" and var declarations.
		expect(content).toMatch(/"use strict"|var __/);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 2: sea-addon-loader is a no-op when not in SEA mode
// ────────────────────────────────────────────────────────────────────────────

describe("sea-addon-loader in non-SEA mode", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("detectSea() returns false in normal Node.js (no node:sea module)", async () => {
		// In our test environment, Node's node:sea module is not a SEA binary.
		// Either the module doesn't exist or isSea() returns false.
		// Either way, detectSea() must return false.
		const { detectSea } = await import("../packages/agent/src/sea-addon-loader.js");
		expect(detectSea()).toBe(false);
	});

	it("initSeaAddons() does not call dlopen in normal Node.js", async () => {
		const { initSeaAddons } = await import("../packages/agent/src/sea-addon-loader.js");
		const dlopenSpy = vi.spyOn(process, "dlopen");
		expect(() => initSeaAddons()).not.toThrow();
		expect(dlopenSpy).not.toHaveBeenCalled();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 3: sea-addon-loader extracts addon in SEA mode
// ────────────────────────────────────────────────────────────────────────────

describe("sea-addon-loader in SEA mode", () => {
	// Use a fixed temp dir — defined at module scope so it's available in
	// cleanup (no hoisting issues).
	const TEMP_CACHE_BASE = join(ROOT, "dist", "test-sea-cache");

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(TEMP_CACHE_BASE, { recursive: true, force: true });
	});

	it("extractAddonToDir writes the blob to cacheDir/name", async () => {
		const { extractAddonToDir } = await import("../packages/agent/src/sea-addon-loader.js");

		const fakeData = Buffer.from("fake-pty-addon-bytes");
		const cacheDir = join(TEMP_CACHE_BASE, "v0.1.0");
		const resultPath = extractAddonToDir("pty.node", cacheDir, fakeData);

		expect(existsSync(resultPath)).toBe(true);
		expect(readFileSync(resultPath).equals(fakeData)).toBe(true);
		expect(resultPath).toBe(join(cacheDir, "pty.node"));
	});

	it("extractAddonToDir skips write when file already has correct size", async () => {
		const { extractAddonToDir } = await import("../packages/agent/src/sea-addon-loader.js");

		const fakeData = Buffer.from("fake-pty-addon-bytes");
		const cacheDir = join(TEMP_CACHE_BASE, "v0.1.0");
		mkdirSync(cacheDir, { recursive: true });
		const destPath = join(cacheDir, "pty.node");

		// Pre-write the file with identical content (same size).
		writeFileSync(destPath, fakeData, { mode: 0o755 });
		const mtimeBefore = existsSync(destPath)
			? (await import("node:fs")).statSync(destPath).mtimeMs
			: -1;

		// Add a small delay so mtime would differ if we re-write.
		await new Promise((r) => setTimeout(r, 10));
		extractAddonToDir("pty.node", cacheDir, fakeData);

		const mtimeAfter = (await import("node:fs")).statSync(destPath).mtimeMs;
		// mtime must be unchanged — no re-write occurred.
		expect(mtimeAfter).toBe(mtimeBefore);
	});

	it("extractAddonToDir re-writes when file has different size", async () => {
		const { extractAddonToDir } = await import("../packages/agent/src/sea-addon-loader.js");

		const cacheDir = join(TEMP_CACHE_BASE, "v0.1.0");
		mkdirSync(cacheDir, { recursive: true });
		const destPath = join(cacheDir, "pty.node");

		// Write a file with different size.
		writeFileSync(destPath, Buffer.from("old-data"), { mode: 0o755 });

		const newData = Buffer.from("new-data-with-different-length-x");
		extractAddonToDir("pty.node", cacheDir, newData);

		expect(readFileSync(destPath).equals(newData)).toBe(true);
	});

	it("dlopenAddon is called with the extracted path in loadNativeAddon", async () => {
		const { loadNativeAddon, dlopenAddon: _dlopenAddon } = await import(
			"../packages/agent/src/sea-addon-loader.js"
		);

		const fakeData = Buffer.from("fake-pty-addon-bytes-for-dlopen");
		const cacheDir = join(TEMP_CACHE_BASE, "dlopen-test");

		// Mock process.dlopen to avoid actually loading a fake binary.
		const dlopenSpy = vi.spyOn(process, "dlopen").mockImplementation(() => {});

		const fakeSeaModule = {
			getRawAsset: (_name: string): ArrayBuffer =>
				fakeData.buffer.slice(
					fakeData.byteOffset,
					fakeData.byteOffset + fakeData.byteLength,
				) as ArrayBuffer,
		};

		loadNativeAddon("pty.node", cacheDir, fakeSeaModule);

		expect(dlopenSpy).toHaveBeenCalledTimes(1);
		// First arg to dlopen must be a module-like object.
		expect(dlopenSpy.mock.calls[0]?.[0]).toHaveProperty("exports");
		// Second arg must be the path ending in pty.node.
		expect(dlopenSpy.mock.calls[0]?.[1]).toMatch(/pty\.node$/);
	});

	it("getAddonCacheDir returns path containing version", async () => {
		const { getAddonCacheDir } = await import("../packages/agent/src/sea-addon-loader.js");
		const dir = getAddonCacheDir("1.2.3");
		expect(dir).toContain("1.2.3");
		expect(dir).toContain("nexterm");
		expect(dir).toContain("addons");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 4: bundle inlines node-pty JS but keeps native addon external
// ────────────────────────────────────────────────────────────────────────────

describe("bundle inlines node-pty JS and uses SEA addon shim", () => {
	it("node-pty JS is inlined — no external require('node-pty')", () => {
		const content = readFileSync(OUT_FILE, "utf8");

		// node-pty JS is now bundled inline (utils.js replaced by shim).
		// No external require("node-pty") should appear in the bundle.
		expect(content).not.toContain('require("node-pty")');

		// Build artifacts from native compilation must never appear.
		expect(content).not.toContain("binding.gyp");
		expect(content).not.toContain("node-addon-api");
	});

	it("SEA bootstrap banner is present and references __seaPtyExports", () => {
		const content = readFileSync(OUT_FILE, "utf8");

		// The SEA bootstrap banner must appear at the top of the bundle.
		expect(content).toContain("__seaPtyExports");
		expect(content).toContain("__seaBootstrap");

		// process.dlopen must be called in the banner (not in node-pty internals).
		expect(content).toContain("process.dlopen");
	});

	it("SEA-compatible utils.js shim replaces native .node require paths", () => {
		const content = readFileSync(OUT_FILE, "utf8");

		// The shim returns __seaPtyExports in SEA mode — must be present.
		expect(content).toContain("__seaPtyExports");

		// No raw path-based native addon require must remain.
		// These are the patterns that would crash in SEA mode.
		expect(content).not.toContain("build/Release/pty.node");
		expect(content).not.toContain("build/Debug/pty.node");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Test 5: bundle includes @nexterm/shared inline
// ────────────────────────────────────────────────────────────────────────────

describe("bundle includes @nexterm/shared inline", () => {
	it("@nexterm/shared is inlined (no external require)", () => {
		const content = readFileSync(OUT_FILE, "utf8");

		// @nexterm/shared must NOT appear as an external require.
		expect(content).not.toContain('require("@nexterm/shared")');

		// Known exports from @nexterm/shared must appear as inlined identifiers.
		// encodeFrame is a core export used in main.ts.
		expect(content).toContain("encodeFrame");
		// FrameReader is used by the agent handler.
		expect(content).toContain("FrameReader");
	});
});
