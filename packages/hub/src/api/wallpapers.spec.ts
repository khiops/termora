import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";
import { openTestDatabases } from "../storage/db.js";
import type { DatabaseManager } from "../storage/db.js";

// ─── Mock agents so no real PTY / SSH is spawned ─────────────────────────────

vi.mock("../session/local-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockLocalAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { LocalAgent: MockLocalAgent };
});

vi.mock("../session/ssh-agent.js", () => {
	const { EventEmitter } = require("node:events");
	class MockSshAgent extends EventEmitter {
		connected = true;
		start = vi.fn().mockResolvedValue(undefined);
		send = vi.fn();
		close = vi.fn(() => {
			this.connected = false;
			this.emit("close");
		});
	}
	return { SshAgent: MockSshAgent };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_TOKEN = "test-wallpaper-token-64chars-padded-aaaaaaaaaaaaaaaaaaaaaaaaa";

function buildMultipart(
	filename: string,
	content: string,
	contentType = "image/jpeg",
): { payload: string; headers: Record<string, string> } {
	const boundary = "----TestBoundary42";
	const payload = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="image"; filename="${filename}"`,
		`Content-Type: ${contentType}`,
		"",
		content,
		`--${boundary}--`,
	].join("\r\n");
	return {
		payload,
		headers: {
			authorization: `Bearer ${TEST_TOKEN}`,
			"content-type": `multipart/form-data; boundary=${boundary}`,
		},
	};
}

function authHeader(): Record<string, string> {
	return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("Wallpaper endpoints", () => {
	let dbs: DatabaseManager;
	let server: FastifyInstance;
	let configDir: string;

	beforeEach(async () => {
		// Use a unique temp subdir per test to avoid cross-test pollution
		configDir = join(
			tmpdir(),
			`nexterm-wallpaper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(configDir, "wallpapers"), { recursive: true });
		dbs = openTestDatabases();
		server = await createServer({
			logger: false,
			dbManager: dbs,
			skipShellDiscovery: true,
			authToken: TEST_TOKEN,
			configDir,
		});
	});

	afterEach(async () => {
		await server.close();
		dbs.close();
	});

	// ─── GET /api/wallpapers ──────────────────────────────────────────────────

	describe("GET /api/wallpapers", () => {
		it("should return empty list when no wallpapers exist", async () => {
			const res = await server.inject({ method: "GET", url: "/api/wallpapers" });
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ wallpapers: [] });
		});

		it("should list uploaded wallpapers", async () => {
			writeFileSync(join(configDir, "wallpapers", "bg.png"), "fake-png");
			writeFileSync(join(configDir, "wallpapers", "hero.jpg"), "fake-jpg");

			const res = await server.inject({ method: "GET", url: "/api/wallpapers" });
			expect(res.statusCode).toBe(200);
			const body = res.json<{ wallpapers: string[] }>();
			expect(body.wallpapers).toContain("bg.png");
			expect(body.wallpapers).toContain("hero.jpg");
		});

		it("should filter non-image files from listing", async () => {
			writeFileSync(join(configDir, "wallpapers", "script.sh"), "#!/bin/sh");
			writeFileSync(join(configDir, "wallpapers", "image.webp"), "fake-webp");

			const res = await server.inject({ method: "GET", url: "/api/wallpapers" });
			expect(res.statusCode).toBe(200);
			const body = res.json<{ wallpapers: string[] }>();
			expect(body.wallpapers).not.toContain("script.sh");
			expect(body.wallpapers).toContain("image.webp");
		});

		it("should work without auth (public endpoint)", async () => {
			const res = await server.inject({ method: "GET", url: "/api/wallpapers" });
			// No Authorization header — should still be 200
			expect(res.statusCode).toBe(200);
		});
	});

	// ─── POST /api/wallpapers ─────────────────────────────────────────────────

	describe("POST /api/wallpapers", () => {
		it("should upload a valid image file", async () => {
			const { payload, headers } = buildMultipart("test.jpg", "fake-image-data");
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers,
				payload,
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ filename: "test.jpg" });
		});

		it("should reject files with invalid extension", async () => {
			const { payload, headers } = buildMultipart(
				"malware.exe",
				"MZ...",
				"application/octet-stream",
			);
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers,
				payload,
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error.code).toBe("UNSUPPORTED_TYPE");
		});

		it("should reject upload without auth", async () => {
			const boundary = "----TestBoundary42";
			const payload = [
				`--${boundary}`,
				`Content-Disposition: form-data; name="image"; filename="test.jpg"`,
				"Content-Type: image/jpeg",
				"",
				"fake",
				`--${boundary}--`,
			].join("\r\n");
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
				payload,
			});
			expect(res.statusCode).toBe(401);
		});

		it("should handle path traversal in filename", async () => {
			// basename() strips directory parts — "../../etc/passwd" → sanitizeFilename returns null
			// because basename("../../etc/passwd") = "passwd" which !== "../../etc/passwd"
			const { payload, headers } = buildMultipart("../../etc/passwd", "evil");
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers,
				payload,
			});
			// Either 400 INVALID_FILENAME or the safe basename "passwd" (unsupported ext) → 400
			expect(res.statusCode).toBe(400);
		});

		it("should overwrite existing file with same name", async () => {
			writeFileSync(join(configDir, "wallpapers", "bg.png"), "original");

			const { payload, headers } = buildMultipart("bg.png", "updated-content", "image/png");
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers,
				payload,
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ filename: "bg.png" });
		});

		it("should accept files within size limit", async () => {
			// Verifies that a small valid file is accepted end-to-end.
			// The 10 MB ceiling enforced by @fastify/multipart (MAX_WALLPAPER_SIZE) is a
			// framework-level feature trusted at framework level — sending an actual 10 MB+
			// payload in tests would be slow and brittle, so we rely on @fastify/multipart's
			// own test suite for the 413 rejection path and only assert the happy path here.
			const { payload, headers } = buildMultipart("small.jpg", "x".repeat(50));
			const res = await server.inject({
				method: "POST",
				url: "/api/wallpapers",
				headers,
				payload,
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ filename: "small.jpg" });
		});
	});

	// ─── DELETE /api/wallpapers/:filename ─────────────────────────────────────

	describe("DELETE /api/wallpapers/:filename", () => {
		it("should delete an existing wallpaper", async () => {
			writeFileSync(join(configDir, "wallpapers", "old.png"), "data");

			const res = await server.inject({
				method: "DELETE",
				url: "/api/wallpapers/old.png",
				headers: authHeader(),
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ ok: true });
		});

		it("should return 404 for non-existent wallpaper", async () => {
			const res = await server.inject({
				method: "DELETE",
				url: "/api/wallpapers/ghost.jpg",
				headers: authHeader(),
			});
			expect(res.statusCode).toBe(404);
			expect(res.json().error.code).toBe("NOT_FOUND");
		});

		it("should reject delete without auth", async () => {
			const res = await server.inject({
				method: "DELETE",
				url: "/api/wallpapers/something.jpg",
			});
			expect(res.statusCode).toBe(401);
		});

		it("should handle path traversal in filename", async () => {
			const res = await server.inject({
				method: "DELETE",
				url: "/api/wallpapers/..%2Fetc%2Fpasswd",
				headers: authHeader(),
			});
			// Fastify URL-decodes route params — sanitizeFilename rejects traversal → 400
			expect(res.statusCode).toBe(400);
			expect(res.json().error.code).toBe("INVALID_FILENAME");
		});
	});
});
