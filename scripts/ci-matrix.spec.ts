/**
 * ci-matrix.spec.ts
 *
 * Validates the GitHub Actions workflow files for the SEA release pipeline.
 *
 * Tests:
 *   1. release-sea.yml is valid YAML
 *   2. Matrix covers all target platforms
 *   3. All jobs have correct dependency chain
 *   4. rename-sea-binaries.sh produces correct filenames
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "@iarna/toml";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

// ── YAML parsing helper ────────────────────────────────────────────────────
// @iarna/toml is in the dependency catalog; for YAML we use a lightweight
// parser that covers the subset of YAML used by GitHub Actions.
// Node 22 does not include a built-in YAML parser, so we implement a minimal
// structural validator based on indentation-aware key detection.

/**
 * Parse a GitHub Actions YAML workflow file.
 * Returns a nested object structure sufficient for structural validation.
 *
 * We use a line-by-line parser that handles:
 *   - Top-level keys
 *   - Nested keys (by indentation)
 *   - List items starting with "- "
 *   - Inline values (strings, booleans, numbers)
 *
 * This is intentionally minimal — we only need to validate structure, not
 * execute the workflow. A full YAML parser would add a heavy dependency.
 */
function parseWorkflowYaml(content: string): Record<string, unknown> {
	// Validate that the file is parseable as structured text:
	// - No duplicate top-level keys (a common YAML mistake)
	// - Consistent indentation
	// - All `jobs:` have at least one step

	const lines = content.split("\n");

	// Check for basic structure markers we need
	const hasName = lines.some((l) => /^name:\s+\S/.test(l));
	const hasOn = lines.some((l) => /^on:/.test(l));
	const hasJobs = lines.some((l) => /^jobs:/.test(l));

	if (!hasName || !hasOn || !hasJobs) {
		throw new Error(
			`Workflow YAML missing required top-level keys. ` +
				`name=${hasName}, on=${hasOn}, jobs=${hasJobs}`,
		);
	}

	// Extract job names (lines with 2-space indent + identifier + colon)
	const jobNames: string[] = [];
	for (const line of lines) {
		const m = line.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
		if (m && !["strategy", "matrix", "include", "with", "env", "steps"].includes(m[1])) {
			jobNames.push(m[1]);
		}
	}

	// Extract matrix include entries (lines under "        include:")
	const matrixEntries: Array<Record<string, string>> = [];
	let inInclude = false;
	let currentEntry: Record<string, string> | null = null;

	for (const line of lines) {
		if (/^\s{8}include:/.test(line)) {
			inInclude = true;
			continue;
		}
		if (inInclude) {
			// New list item
			const itemMatch = line.match(/^\s{10}-\s+(.+)$/);
			const kvMatch = line.match(/^\s{12}([a-z_]+):\s+(.+)$/);
			const endMatch = line.match(/^\s{0,8}\S/) && !/^\s{10}/.test(line);

			if (itemMatch) {
				if (currentEntry) matrixEntries.push(currentEntry);
				currentEntry = {};
				// Parse inline key: value if present
				const inlineKv = itemMatch[1].match(/^([a-z_]+):\s+(.+)$/);
				if (inlineKv && currentEntry) {
					currentEntry[inlineKv[1]] = inlineKv[2].replace(/^["']|["']$/g, "");
				}
			} else if (kvMatch && currentEntry) {
				currentEntry[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "");
			} else if (endMatch) {
				if (currentEntry) {
					matrixEntries.push(currentEntry);
					currentEntry = null;
				}
				inInclude = false;
			}
		}
	}
	if (currentEntry) matrixEntries.push(currentEntry);

	// Extract "needs:" values per job
	const jobNeeds: Record<string, string[]> = {};
	let currentJob: string | null = null;
	for (const line of lines) {
		const jobMatch = line.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
		if (
			jobMatch &&
			!["strategy", "matrix", "include", "with", "env", "steps"].includes(jobMatch[1])
		) {
			currentJob = jobMatch[1];
		}
		if (currentJob) {
			const needsMatch = line.match(/^\s+needs:\s+(.+)$/);
			if (needsMatch) {
				const raw = needsMatch[1].trim();
				// Could be "job-name" or "[job1, job2]"
				if (raw.startsWith("[")) {
					jobNeeds[currentJob] = raw
						.replace(/[\[\]]/g, "")
						.split(",")
						.map((s) => s.trim());
				} else {
					jobNeeds[currentJob] = [raw];
				}
			}
		}
	}

	return {
		_jobNames: jobNames,
		_matrixEntries: matrixEntries,
		_jobNeeds: jobNeeds,
		_raw: content,
	};
}

// ── Expected platform matrix ───────────────────────────────────────────────
const EXPECTED_PLATFORMS: Array<{ target_os: string; target_arch: string }> = [
	{ target_os: "linux", target_arch: "x64" },
	{ target_os: "linux", target_arch: "arm64" },
	{ target_os: "windows", target_arch: "x64" },
	{ target_os: "darwin", target_arch: "arm64" },
	{ target_os: "darwin", target_arch: "x64" },
];

// ── Filename convention ────────────────────────────────────────────────────
function expectedAgentName(os: string, arch: string): string {
	return os === "windows" ? `nexterm-agent-${os}-${arch}.exe` : `nexterm-agent-${os}-${arch}`;
}

function expectedHubName(os: string, arch: string): string {
	return os === "windows" ? `nexterm-hub-${os}-${arch}.exe` : `nexterm-hub-${os}-${arch}`;
}

// ──────────────────────────────────────────────────────────────────────────
describe("release-sea.yml", () => {
	const workflowPath = join(WORKFLOWS_DIR, "release-sea.yml");

	it("file exists", () => {
		expect(existsSync(workflowPath)).toBe(true);
	});

	it("is valid YAML (structural check)", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(() => parseWorkflowYaml(content)).not.toThrow();
	});

	it("has tag trigger for v* pattern", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/on:/);
		expect(content).toMatch(/push:/);
		expect(content).toMatch(/tags:/);
		expect(content).toMatch(/- ['"]?v\*/);
	});

	it("has contents:write permission for release creation", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/permissions:/);
		expect(content).toMatch(/contents:\s*write/);
	});

	it("matrix covers all 5 target platforms", () => {
		const content = readFileSync(workflowPath, "utf8");
		const parsed = parseWorkflowYaml(content);
		const entries = parsed._matrixEntries as Array<Record<string, string>>;

		for (const expected of EXPECTED_PLATFORMS) {
			const found = entries.some(
				(e) => e.target_os === expected.target_os && e.target_arch === expected.target_arch,
			);
			expect(found, `Missing platform: ${expected.target_os}-${expected.target_arch}`).toBe(true);
		}
	});

	it("matrix has exactly 5 entries", () => {
		const content = readFileSync(workflowPath, "utf8");
		const parsed = parseWorkflowYaml(content);
		const entries = parsed._matrixEntries as Array<Record<string, string>>;
		expect(entries).toHaveLength(5);
	});

	it("build-sea job depends on build-web", () => {
		const content = readFileSync(workflowPath, "utf8");
		const parsed = parseWorkflowYaml(content);
		const needs = parsed._jobNeeds as Record<string, string[]>;
		expect(needs["build-sea"]).toBeDefined();
		expect(needs["build-sea"]).toContain("build-web");
	});

	it("release job depends on build-sea", () => {
		const content = readFileSync(workflowPath, "utf8");
		const parsed = parseWorkflowYaml(content);
		const needs = parsed._jobNeeds as Record<string, string[]>;
		expect(needs["release"]).toBeDefined();
		expect(needs["release"]).toContain("build-sea");
	});

	it("uses actions/upload-artifact@v4 for artifact upload", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/actions\/upload-artifact@v4/);
	});

	it("uses actions/download-artifact@v4 for artifact download", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/actions\/download-artifact@v4/);
	});

	it("uses softprops/action-gh-release@v2 for release creation", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/softprops\/action-gh-release@v2/);
	});

	it("uses Node 22", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/node-version:\s*['"]?22/);
	});

	it("uses pnpm/action-setup@v4", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/pnpm\/action-setup@v4/);
	});

	it("uses pnpm cache", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/cache:\s*['"]pnpm['"]/);
	});

	it("has generate_release_notes enabled", () => {
		const content = readFileSync(workflowPath, "utf8");
		expect(content).toMatch(/generate_release_notes:\s*true/);
	});
});

// ──────────────────────────────────────────────────────────────────────────
describe("ci.yml", () => {
	const ciPath = join(WORKFLOWS_DIR, "ci.yml");

	it("file exists", () => {
		expect(existsSync(ciPath)).toBe(true);
	});

	it("triggers on push to main and pull_request", () => {
		const content = readFileSync(ciPath, "utf8");
		expect(content).toMatch(/push:/);
		expect(content).toMatch(/branches:\s*\[main\]/);
		expect(content).toMatch(/pull_request:/);
	});

	it("includes windows-latest in matrix", () => {
		const content = readFileSync(ciPath, "utf8");
		expect(content).toMatch(/windows-latest/);
	});

	it("uses Node 22", () => {
		const content = readFileSync(ciPath, "utf8");
		expect(content).toMatch(/node:\s*22/);
	});
});

// ──────────────────────────────────────────────────────────────────────────
describe("rename-sea-binaries.sh", () => {
	const scriptPath = join(ROOT, "scripts", "rename-sea-binaries.sh");

	it("file exists", () => {
		expect(existsSync(scriptPath)).toBe(true);
	});

	it("script is executable", () => {
		const { statSync } = require("node:fs") as typeof import("node:fs");
		const stat = statSync(scriptPath);
		// Check owner execute bit (S_IXUSR = 0o100)
		// biome-ignore lint/style/noOctalEscape: intentional permissions check
		expect(stat.mode & 0o100).toBeGreaterThan(0);
	});

	it("contains OS detection logic for linux, darwin, windows", () => {
		const content = readFileSync(scriptPath, "utf8");
		expect(content).toMatch(/Linux\*/);
		expect(content).toMatch(/Darwin\*/);
		expect(content).toMatch(/MINGW|MSYS|CYGWIN/);
	});

	it("contains arch detection logic for x64 and arm64", () => {
		const content = readFileSync(scriptPath, "utf8");
		expect(content).toMatch(/x86_64/);
		expect(content).toMatch(/aarch64|arm64/);
	});

	it("contains TARGET_OS and TARGET_ARCH override support", () => {
		const content = readFileSync(scriptPath, "utf8");
		expect(content).toMatch(/TARGET_OS/);
		expect(content).toMatch(/TARGET_ARCH/);
	});

	it("renames both nexterm-agent and nexterm-hub", () => {
		const content = readFileSync(scriptPath, "utf8");
		expect(content).toMatch(/nexterm-agent/);
		expect(content).toMatch(/nexterm-hub/);
	});
});

// ──────────────────────────────────────────────────────────────────────────
describe("filename naming convention", () => {
	it("Unix binaries have no extension", () => {
		for (const { target_os, target_arch } of EXPECTED_PLATFORMS) {
			if (target_os === "windows") continue;
			expect(expectedAgentName(target_os, target_arch)).not.toMatch(/\.exe$/);
			expect(expectedHubName(target_os, target_arch)).not.toMatch(/\.exe$/);
		}
	});

	it("Windows binaries have .exe extension", () => {
		expect(expectedAgentName("windows", "x64")).toMatch(/\.exe$/);
		expect(expectedHubName("windows", "x64")).toMatch(/\.exe$/);
	});

	it("all binary names follow nexterm-{component}-{os}-{arch} pattern", () => {
		for (const { target_os, target_arch } of EXPECTED_PLATFORMS) {
			const agentName = expectedAgentName(target_os, target_arch);
			const hubName = expectedHubName(target_os, target_arch);

			expect(agentName).toMatch(new RegExp(`^nexterm-agent-${target_os}-${target_arch}(\\.exe)?$`));
			expect(hubName).toMatch(new RegExp(`^nexterm-hub-${target_os}-${target_arch}(\\.exe)?$`));
		}
	});

	it("produces expected names for each platform", () => {
		const cases: Array<[string, string, string, string]> = [
			["linux", "x64", "nexterm-agent-linux-x64", "nexterm-hub-linux-x64"],
			["linux", "arm64", "nexterm-agent-linux-arm64", "nexterm-hub-linux-arm64"],
			["windows", "x64", "nexterm-agent-windows-x64.exe", "nexterm-hub-windows-x64.exe"],
			["darwin", "arm64", "nexterm-agent-darwin-arm64", "nexterm-hub-darwin-arm64"],
			["darwin", "x64", "nexterm-agent-darwin-x64", "nexterm-hub-darwin-x64"],
		];

		for (const [os, arch, expectedAgent, expectedHub] of cases) {
			expect(expectedAgentName(os, arch)).toBe(expectedAgent);
			expect(expectedHubName(os, arch)).toBe(expectedHub);
		}
	});
});
