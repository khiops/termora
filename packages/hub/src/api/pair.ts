import { randomInt } from "node:crypto";
import { generateId } from "@nexterm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MetaDAL } from "../storage/meta.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PairRouteOptions {
	authToken: string;
	metaDal: MetaDAL;
}

interface VerifyBody {
	code?: unknown;
}

// ─── Rate limit state (in-memory, resets every 60 s) ─────────────────────────

const VERIFY_WINDOW_MS = 60_000;
const VERIFY_MAX = 10;

let verifyCount = 0;
let verifyWindowStart = Date.now();

function checkVerifyRateLimit(): boolean {
	const now = Date.now();
	if (now - verifyWindowStart >= VERIFY_WINDOW_MS) {
		verifyCount = 0;
		verifyWindowStart = now;
	}
	verifyCount += 1;
	return verifyCount <= VERIFY_MAX;
}

// Exported so tests can reset state between runs
export function resetVerifyRateLimit(): void {
	verifyCount = 0;
	verifyWindowStart = Date.now();
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerPairRoutes(server: FastifyInstance, opts: PairRouteOptions): void {
	const { authToken, metaDal } = opts;

	// POST /api/pair — authenticated, generates a one-time pairing code
	server.post("/api/pair", async (_request: FastifyRequest, reply: FastifyReply) => {
		const active = metaDal.countActivePairingCodes();
		if (active >= 3) {
			return reply.code(429).send({
				error: { code: "RATE_LIMIT", message: "Too many active pairing codes" },
			});
		}

		const now = new Date();
		const expiresAt = new Date(now.getTime() + 60_000).toISOString();
		const id = generateId();

		// Generate a unique 6-digit code with retry on collision (UNIQUE constraint).
		const maxAttempts = 5;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
			try {
				metaDal.createPairingCode(id, code, now.toISOString(), expiresAt);
				return reply.code(201).send({ code, expires_at: expiresAt });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "";
				const isUniqueViolation =
					msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT_UNIQUE");
				if (isUniqueViolation && attempt < maxAttempts - 1) continue;
				throw err;
			}
		}
	});

	// POST /api/pair/verify — unauthenticated, exchanges code for token
	server.post<{ Body: VerifyBody }>(
		"/api/pair/verify",
		async (request: FastifyRequest<{ Body: VerifyBody }>, reply: FastifyReply) => {
			if (!checkVerifyRateLimit()) {
				return reply.code(429).send({
					error: { code: "RATE_LIMIT", message: "Too many verification attempts" },
				});
			}

			const { code } = request.body;

			if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
				return reply.code(400).send({
					error: { code: "INVALID_FORMAT", message: "Code must be 6 digits" },
				});
			}

			const row = metaDal.getPairingCodeByCode(code);

			if (!row) {
				return reply.code(404).send({
					error: { code: "CODE_NOT_FOUND", message: "Unknown pairing code" },
				});
			}

			if (row.used !== 0) {
				return reply.code(409).send({
					error: { code: "CODE_USED", message: "Code already redeemed" },
				});
			}

			const now = new Date().toISOString();
			if (row.expires_at < now) {
				return reply.code(410).send({
					error: { code: "CODE_EXPIRED", message: "Code has expired" },
				});
			}

			const clientIp = request.ip ?? "unknown";
			metaDal.markPairingCodeUsed(row.id, now, clientIp);

			return reply.code(200).send({ token: authToken });
		},
	);
}
