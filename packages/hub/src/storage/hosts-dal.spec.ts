import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabases } from "./db.js";
import type { DatabaseManager } from "./db.js";
import { HostsDAL } from "./hosts-dal.js";

describe("HostsDAL — agent SHA256 pinning", () => {
	let dbs: DatabaseManager;
	let dal: HostsDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		dal = new HostsDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	it("stores and retrieves agent SHA256", () => {
		const host = dal.createHost({ type: "ssh", label: "Remote Server" });
		const sha256 = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

		dal.updateHostAgentSha256(host.id, sha256);

		expect(dal.getHostAgentSha256(host.id)).toBe(sha256);
	});

	it("returns null when no SHA256 pinned", () => {
		const host = dal.createHost({ type: "ssh", label: "Fresh Server" });

		expect(dal.getHostAgentSha256(host.id)).toBeNull();
	});

	it("clears SHA256 with null", () => {
		const host = dal.createHost({ type: "ssh", label: "Pinned Server" });
		const sha256 = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

		dal.updateHostAgentSha256(host.id, sha256);
		expect(dal.getHostAgentSha256(host.id)).toBe(sha256);

		dal.updateHostAgentSha256(host.id, null);
		expect(dal.getHostAgentSha256(host.id)).toBeNull();
	});

	it("reflects agentSha256 in getHost result after update", () => {
		const host = dal.createHost({ type: "ssh", label: "Mapped Server" });
		const sha256 = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

		dal.updateHostAgentSha256(host.id, sha256);

		const fetched = dal.getHost(host.id);
		expect(fetched?.agentSha256).toBe(sha256);
	});

	it("agentSha256 is absent on host when not set", () => {
		const host = dal.createHost({ type: "ssh", label: "No Pin Server" });

		const fetched = dal.getHost(host.id);
		expect(fetched?.agentSha256).toBeUndefined();
	});
});
