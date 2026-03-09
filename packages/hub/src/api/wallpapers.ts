import { readdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { WALLPAPER_EXTENSIONS } from "@nexterm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

function isValidExtension(filename: string): boolean {
	const ext = extname(filename).toLowerCase().slice(1);
	return WALLPAPER_EXTENSIONS.includes(ext);
}

function sanitizeFilename(raw: string): string | null {
	const name = basename(raw);
	if (name !== raw || name.includes("..") || name.includes("/") || name.includes("\\")) {
		return null;
	}
	if (!name || name === "." || name === "..") {
		return null;
	}
	return name;
}

export function registerWallpaperRoutes(server: FastifyInstance, configDir: string): void {
	const wallpapersDir = join(configDir, "wallpapers");

	// GET /api/wallpapers — no auth (bypassed in server.ts hook)
	server.get("/api/wallpapers", async () => {
		let entries: string[];
		try {
			entries = await readdir(wallpapersDir);
		} catch {
			return { wallpapers: [] };
		}
		const wallpapers = entries.filter((f) => isValidExtension(f)).sort();
		return { wallpapers };
	});

	// POST /api/wallpapers — upload a wallpaper image
	server.post("/api/wallpapers", async (request: FastifyRequest, reply: FastifyReply) => {
		const file = await request.file();
		if (!file) {
			return reply.code(400).send({ error: "NO_FILE", message: "No file uploaded" });
		}

		const sanitized = sanitizeFilename(file.filename);
		if (!sanitized) {
			return reply.code(400).send({ error: "INVALID_FILENAME", message: "Invalid filename" });
		}

		if (!isValidExtension(sanitized)) {
			return reply.code(400).send({ error: "UNSUPPORTED_TYPE", message: "Unsupported file type" });
		}

		const buffer = await file.toBuffer();
		const target = join(wallpapersDir, sanitized);

		// Directory containment check
		if (!resolve(target).startsWith(resolve(wallpapersDir))) {
			return reply.code(400).send({ error: "INVALID_PATH", message: "Invalid filename" });
		}

		await writeFile(target, buffer);
		return { filename: sanitized };
	});

	// DELETE /api/wallpapers/:filename
	server.delete<{ Params: { filename: string } }>(
		"/api/wallpapers/:filename",
		async (request, reply) => {
			const sanitized = sanitizeFilename(request.params.filename);
			if (!sanitized) {
				return reply.code(400).send({ error: "INVALID_FILENAME", message: "Invalid filename" });
			}

			const target = join(wallpapersDir, sanitized);

			// Directory containment check
			if (!resolve(target).startsWith(resolve(wallpapersDir))) {
				return reply.code(400).send({ error: "INVALID_PATH", message: "Invalid filename" });
			}

			try {
				await unlink(target);
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code === "ENOENT") {
					return reply.code(404).send({ error: "NOT_FOUND", message: "Wallpaper not found" });
				}
				throw err;
			}

			return { ok: true };
		},
	);
}
