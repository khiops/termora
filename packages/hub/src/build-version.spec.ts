import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HUB_VERSION } from "./build-version.js";

describe("build-version", () => {
	it("resolves HUB_VERSION from the hub package.json, not the 0.0.0 fallback", () => {
		// Regression guard: a wrong relative path (e.g. ../../package.json) makes the
		// require fail and HUB_VERSION collapse to "0.0.0", which silently breaks
		// version-aware agent fetch/deploy in source runs.
		const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
		const pkgVersion = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
		expect(HUB_VERSION).toBe(pkgVersion);
		expect(HUB_VERSION).not.toBe("0.0.0");
		expect(HUB_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
