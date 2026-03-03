import type { Host } from "@nexterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabases } from "./db.js";
import type { DatabaseManager } from "./db.js";
import { MetaDAL } from "./meta.js";

describe("MetaDAL — Hosts CRUD", () => {
	let dbs: DatabaseManager;
	let dal: MetaDAL;

	beforeEach(() => {
		dbs = openTestDatabases();
		dal = new MetaDAL(dbs.meta);
	});

	afterEach(() => {
		dbs.close();
	});

	describe("createHost", () => {
		it("creates a local host with required fields", () => {
			const host = dal.createHost({ type: "local", label: "My Local" });

			expect(host.id).toBeTruthy();
			expect(host.type).toBe("local");
			expect(host.label).toBe("My Local");
			expect(host.iconType).toBe("auto");
			expect(host.trustRemoteHints).toBe("apply");
			expect(host.createdAt).toBeTruthy();
			expect(host.updatedAt).toBeTruthy();
		});

		it("creates an SSH host with all fields", () => {
			const host = dal.createHost({
				type: "ssh",
				label: "Prod Server",
				sshHost: "192.168.1.100",
				sshPort: 2222,
				sshAuth: "key",
				sshKeyPath: "/home/user/.ssh/id_ed25519",
				iconType: "emoji",
				iconValue: "",
				color: "#ff6600",
				profileJson: '{"fontSize":14}',
				trustRemoteHints: "ask",
				defaultShell: "/bin/zsh",
				defaultCwd: "/home/user",
			});

			expect(host.type).toBe("ssh");
			expect(host.sshHost).toBe("192.168.1.100");
			expect(host.sshPort).toBe(2222);
			expect(host.sshAuth).toBe("key");
			expect(host.sshKeyPath).toBe("/home/user/.ssh/id_ed25519");
			expect(host.iconType).toBe("emoji");
			expect(host.iconValue).toBe("");
			expect(host.color).toBe("#ff6600");
			expect(host.profileJson).toBe('{"fontSize":14}');
			expect(host.trustRemoteHints).toBe("ask");
			expect(host.defaultShell).toBe("/bin/zsh");
			expect(host.defaultCwd).toBe("/home/user");
		});

		it("generates ULID IDs (26 chars, unique)", () => {
			const h1 = dal.createHost({ type: "local", label: "A" });
			const h2 = dal.createHost({ type: "local", label: "B" });

			expect(h1.id).toHaveLength(26);
			expect(h2.id).toHaveLength(26);
			// Both IDs must be valid Crockford Base32 ULID format
			expect(h1.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(h2.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
			// IDs must be distinct
			expect(h1.id).not.toBe(h2.id);
		});

		it("throws on duplicate label (UNIQUE constraint)", () => {
			dal.createHost({ type: "local", label: "Duplicate" });
			expect(() => dal.createHost({ type: "local", label: "Duplicate" })).toThrow();
		});

		it("sets ISO 8601 timestamps", () => {
			const host = dal.createHost({ type: "local", label: "TS Test" });
			// ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
			expect(host.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(host.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});

	describe("getHost", () => {
		it("returns host by ID", () => {
			const created = dal.createHost({ type: "local", label: "Get Me" });
			const found = dal.getHost(created.id);

			expect(found).toBeDefined();
			expect(found?.id).toBe(created.id);
			expect(found?.label).toBe("Get Me");
		});

		it("returns undefined for non-existent ID", () => {
			const result = dal.getHost("non-existent-id");
			expect(result).toBeUndefined();
		});
	});

	describe("getHostByLabel", () => {
		it("returns host by label", () => {
			dal.createHost({ type: "local", label: "FindByLabel" });
			const found = dal.getHostByLabel("FindByLabel");

			expect(found).toBeDefined();
			expect(found?.label).toBe("FindByLabel");
		});

		it("returns undefined for non-existent label", () => {
			const result = dal.getHostByLabel("NoSuchLabel");
			expect(result).toBeUndefined();
		});
	});

	describe("listHosts", () => {
		it("returns empty array when no hosts", () => {
			const hosts = dal.listHosts();
			expect(hosts).toEqual([]);
		});

		it("returns all hosts ordered by created_at", () => {
			dal.createHost({ type: "local", label: "First" });
			dal.createHost({ type: "ssh", label: "Second", sshHost: "10.0.0.1" });
			dal.createHost({ type: "local", label: "Third" });

			const hosts = dal.listHosts();
			expect(hosts).toHaveLength(3);
			expect((hosts[0] as Host).label).toBe("First");
			expect((hosts[1] as Host).label).toBe("Second");
			expect((hosts[2] as Host).label).toBe("Third");
		});
	});

	describe("updateHost", () => {
		it("updates specified fields and changes updated_at", async () => {
			const host = dal.createHost({ type: "local", label: "Before Update" });
			const originalUpdatedAt = host.updatedAt;

			// Small delay to ensure timestamp difference
			await new Promise((r) => setTimeout(r, 10));

			const updated = dal.updateHost(host.id, {
				label: "After Update",
				color: "#123456",
			});

			expect(updated.label).toBe("After Update");
			expect(updated.color).toBe("#123456");
			expect(updated.type).toBe("local"); // unchanged
			expect(updated.updatedAt).not.toBe(originalUpdatedAt);
		});

		it("partial update leaves other fields unchanged", () => {
			const host = dal.createHost({
				type: "ssh",
				label: "Partial",
				sshHost: "10.0.0.1",
				color: "#aabbcc",
			});

			const updated = dal.updateHost(host.id, { color: "#ffffff" });

			expect(updated.color).toBe("#ffffff");
			expect(updated.sshHost).toBe("10.0.0.1"); // unchanged
			expect(updated.label).toBe("Partial"); // unchanged
		});

		it("throws when updating non-existent host", () => {
			expect(() => dal.updateHost("no-such-id", { label: "Ghost" })).toThrow(
				"Host not found after update",
			);
		});
	});

	describe("deleteHost", () => {
		it("deletes an existing host and returns true", () => {
			const host = dal.createHost({ type: "local", label: "To Delete" });

			const deleted = dal.deleteHost(host.id);

			expect(deleted).toBe(true);
			expect(dal.getHost(host.id)).toBeUndefined();
		});

		it("returns false when deleting non-existent host", () => {
			const result = dal.deleteHost("no-such-id");
			expect(result).toBe(false);
		});

		it("removing a host does not error with no child records", () => {
			const host = dal.createHost({ type: "local", label: "No Children" });
			expect(() => dal.deleteHost(host.id)).not.toThrow();
		});
	});
});
