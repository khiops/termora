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

import { build } from "esbuild";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import type { SeaBuildConfig } from "./build-sea-binary.js";
import { buildSeaBinary } from "./build-sea-binary.js";
import { buildOptions } from "./build-sea-agent.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Binary extension — empty on Linux/macOS, .exe on Windows. */
const EXE_EXT = process.platform === "win32" ? ".exe" : "";

/** Locate the node-pty native addon from the agent's node_modules. */
function locatePtyNode(): string {
	// Primary: agent package symlink (pnpm virtual store)
	const agentNodeModules = join(
		ROOT,
		"packages",
		"agent",
		"node_modules",
		"node-pty",
		"build",
		"Release",
		"pty.node",
	);
	if (existsSync(agentNodeModules)) {
		return agentNodeModules;
	}

	// Fallback: root-level node_modules (hoisted installs / npm/yarn)
	const rootNodeModules = join(
		ROOT,
		"node_modules",
		"node-pty",
		"build",
		"Release",
		"pty.node",
	);
	if (existsSync(rootNodeModules)) {
		return rootNodeModules;
	}

	throw new Error(
		`[package-sea-agent] node-pty addon not found.\n` +
			`  Checked:\n` +
			`    ${agentNodeModules}\n` +
			`    ${rootNodeModules}\n` +
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
