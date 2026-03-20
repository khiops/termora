/**
 * Tests for seedShellProfiles — separated from shell-discovery.spec.ts
 * because those tests mock node:fs globally which breaks openTestDatabases.
 */
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedShellProfiles } from "./shell-discovery.js";
import type { DatabaseManager } from "./storage/db.js";
import { openTestDatabases } from "./storage/db.js";
import { MetaDAL } from "./storage/meta.js";

function makeProfile(
	overrides: Partial<Parameters<MetaDAL["createLaunchProfile"]>[0]> = {},
) {
	return {
		name: "My Shell",
		shell: "/bin/bash",
		mode: "shell" as const,
		elevated: false,
		supportedOs: "any" as const,
		iconType: "auto" as const,
		sortOrder: 0,
		...overrides,
	};
}

// Mock only existsSync for shell probing — NOT readFileSync (needed by DB migrations)
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
	};
});

const mockExistsSync = vi.mocked(existsSync);

describe("seedShellProfiles", () => {
	let dbs: DatabaseManager;
	let dal: MetaDAL;

	beforeEach(() => {
		// existsSync spy wraps real function by default — DB migrations work fine
		dbs = openTestDatabases();
		dal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
		vi.unstubAllEnvs();
		mockExistsSync.mockReset();
	});

	it("returns zero when profiles already exist (idempotency)", async () => {
		dal.createLaunchProfile(makeProfile({ name: "existing" }));

		const result = await seedShellProfiles(dal);
		expect(result.profilesCreated).toBe(0);
		expect(result.profiles).toHaveLength(0);
	});

	it("creates profiles for discovered shells", async () => {
		vi.stubEnv("SHELL", "/bin/bash");
		mockExistsSync.mockImplementation((p) => p === "/bin/bash");

		const result = await seedShellProfiles(dal);

		expect(result.profilesCreated).toBeGreaterThanOrEqual(1);
		const profiles = dal.listLaunchProfiles();
		expect(profiles.length).toBeGreaterThanOrEqual(1);
		const bash = profiles.find((p) => p.shell === "/bin/bash");
		expect(bash).toBeDefined();
	});

	it("returns zero when no shells are discovered", async () => {
		vi.stubEnv("SHELL", "");
		mockExistsSync.mockReturnValue(false);

		const result = await seedShellProfiles(dal);
		expect(result.profilesCreated).toBe(0);
		expect(dal.listLaunchProfiles()).toHaveLength(0);
	});

	it("assigns sequential sort_order to created profiles", async () => {
		vi.stubEnv("SHELL", "/bin/zsh");
		mockExistsSync.mockImplementation(
			(p) => p === "/bin/zsh" || p === "/bin/bash",
		);

		await seedShellProfiles(dal);

		const profiles = dal.listLaunchProfiles();
		expect(profiles.length).toBeGreaterThanOrEqual(2);
		const orders = profiles.map((p) => p.sortOrder).sort((a, b) => a - b);
		expect(orders[0]).toBe(0);
		expect(orders[1]).toBe(1);
	});

	it("sets correct mode and elevated defaults", async () => {
		vi.stubEnv("SHELL", "/bin/bash");
		mockExistsSync.mockImplementation((p) => p === "/bin/bash");

		await seedShellProfiles(dal);

		const profiles = dal.listLaunchProfiles();
		for (const p of profiles) {
			expect(p.mode).toBe("shell");
			expect(p.elevated).toBe(false);
		}
	});
});
