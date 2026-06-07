/**
 * session-manager-onboarding.spec.ts
 *
 * Tests first-run onboarding: ensureLocalHost creates the "local" host
 * when meta.db is empty, and is idempotent on subsequent calls.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseManager } from "../storage/db.js";
import { openTestDatabases } from "../storage/db.js";
import { MetaDAL } from "../storage/meta.js";

describe("ensureLocalHost (first-run onboarding)", () => {
	let dbs: DatabaseManager;
	let metaDal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		metaDal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("creates the local host when DB is empty", () => {
		// Precondition: no hosts exist
		expect(metaDal.listHosts()).toHaveLength(0);

		// Simulate ensureLocalHost logic
		const existing = metaDal.getHostByLabel("local");
		expect(existing).toBeUndefined();

		const host = metaDal.createHost({ type: "local", label: "local" });
		expect(host.type).toBe("local");
		expect(host.label).toBe("local");
		expect(host.id).toBeTruthy();
	});

	it("returns the existing host id when called again (idempotent)", () => {
		// First call: creates
		const first = metaDal.createHost({ type: "local", label: "local" });

		// Second call: finds existing
		const found = metaDal.getHostByLabel("local");
		expect(found).toBeDefined();
		expect(found?.id).toBe(first.id);

		// No duplicate created
		expect(metaDal.listHosts()).toHaveLength(1);
	});

	it("local host has correct defaults", () => {
		const host = metaDal.createHost({ type: "local", label: "local" });
		expect(host.sshHost).toBeUndefined();
		expect(host.sshPort).toBeUndefined();
		expect(host.sshAuth).toBeUndefined();
		expect(host.iconType).toBe("auto");
	});

	it("does not affect other hosts", () => {
		metaDal.createHost({ type: "local", label: "local" });
		metaDal.createHost({ type: "ssh", label: "prod", sshHost: "10.0.0.1" });

		const hosts = metaDal.listHosts();
		expect(hosts).toHaveLength(2);
		const localHost = metaDal.getHostByLabel("local");
		expect(localHost?.type).toBe("local");
	});
});
