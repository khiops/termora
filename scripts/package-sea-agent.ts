/**
 * package-sea-agent.ts
 *
 * Agent-specific SEA packaging script.
 *
 * Steps:
 *   1. Run build-sea-agent.ts (esbuild: agent → nexterm-agent.cjs)
 *   2. Run build-sea-binary.ts (SEA: nexterm-agent.cjs → nexterm-agent binary)
 *
 * Usage:
 *   pnpm run package:sea-agent
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildOptions } from "./build-sea-agent.js";
import type { SeaBuildConfig } from "./build-sea-binary.js";
import { buildSeaBinary } from "./build-sea-binary.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Binary extension — empty on Linux/macOS, .exe on Windows. */
const EXE_EXT = process.platform === "win32" ? ".exe" : "";

/** Map process.platform + process.arch to node-pty prebuild directory name. */
function prebuildDir(): string {
	const platform = process.platform; // linux, darwin, win32
	const arch = process.arch; // x64, arm64
	return `${platform}-${arch}`;
}

/** Locate the node-pty native addon from the agent's node_modules. */
function locatePtyNode(): string {
	const ptyBase = join(ROOT, "packages", "agent", "node_modules", "node-pty");
	const rootPtyBase = join(ROOT, "node_modules", "node-pty");

	const candidates = [
		// Compiled build
		join(ptyBase, "build", "Release", "pty.node"),
		// Prebuilt binary (node-pty v1.x ships prebuilds per platform)
		join(ptyBase, "prebuilds", prebuildDir(), "pty.node"),
		// Root-level fallback (hoisted installs)
		join(rootPtyBase, "build", "Release", "pty.node"),
		join(rootPtyBase, "prebuilds", prebuildDir(), "pty.node"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`[package-sea-agent] node-pty addon not found.\n` +
			`  Checked:\n${candidates.map((c) => `    ${c}`).join("\n")}\n` +
			`  Run \`pnpm install\` to build native addons first.`,
	);
}

/** Read the agent package version from its package.json. */
function readAgentVersion(): string {
	const pkgPath = join(ROOT, "packages", "agent", "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
		version?: string;
	};
	return pkg.version ?? "0.0.0";
}

async function main(): Promise<void> {
	console.log("[package-sea-agent] starting agent SEA packaging...");

	// ------------------------------------------------------------------
	// Step 1: esbuild bundle (agent TS → nexterm-agent.cjs)
	// ------------------------------------------------------------------
	console.log("[package-sea-agent] step 1/2: esbuild bundle");
	const esbuildResult = await build(buildOptions);
	if (esbuildResult.errors.length > 0) {
		console.error("[package-sea-agent] esbuild failed:");
		for (const err of esbuildResult.errors) {
			console.error("  ", err.text);
		}
		process.exit(1);
	}
	console.log("[package-sea-agent] esbuild bundle complete");

	// ------------------------------------------------------------------
	// Step 2: SEA binary packaging
	// ------------------------------------------------------------------
	console.log("[package-sea-agent] step 2/2: SEA binary packaging");

	const ptyNodePath = locatePtyNode();
	const version = readAgentVersion();

	console.log(`[package-sea-agent] node-pty addon: ${ptyNodePath}`);
	console.log(`[package-sea-agent] agent version: ${version}`);

	const outputBinary = join(ROOT, "dist", "sea", `nexterm-agent${EXE_EXT}`);

	// Write VERSION file content into a temp buffer — embed the version string.
	// We use a temporary file path; buildSeaBinary will embed it as an asset.
	const versionFilePath = join(ROOT, "dist", "sea", "VERSION");
	const { mkdirSync, writeFileSync } = await import("node:fs");
	mkdirSync(join(ROOT, "dist", "sea"), { recursive: true });
	writeFileSync(versionFilePath, version, "utf8");

	const seaCfg: SeaBuildConfig = {
		entryScript: join(ROOT, "dist", "sea", "nexterm-agent.cjs"),
		outputBinary,
		name: "nexterm-agent",
		nativeAddons: {
			"pty.node": ptyNodePath,
		},
		extraAssets: {
			VERSION: versionFilePath,
		},
		useCodeCache: true,
		disableExperimentalSEAWarning: true,
	};

	await buildSeaBinary(seaCfg);

	console.log("[package-sea-agent] packaging complete.");
	console.log(`[package-sea-agent] binary: ${outputBinary}`);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err: unknown) => {
		console.error("[package-sea-agent] fatal:", err);
		process.exit(1);
	});
}
