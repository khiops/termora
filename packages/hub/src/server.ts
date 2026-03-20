import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { DEFAULT_PORT, MAX_WALLPAPER_SIZE } from "@nexterm/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerChannelRoutes } from "./api/channels.js";
import { registerConfigRoutes } from "./api/config.js";
import { registerFontRoutes } from "./api/fonts.js";
import { registerGroupRoutes } from "./api/groups.js";
import { registerHostGroupRoutes } from "./api/host-groups.js";
import { registerHostRoutes } from "./api/hosts.js";
import { registerLaunchProfileRoutes } from "./api/launch-profiles.js";
import { registerPairRoutes } from "./api/pair.js";
import { registerSessionRoutes } from "./api/sessions.js";
import { registerThemeRoutes } from "./api/themes.js";
import { registerTokenRoutes } from "./api/tokens.js";
import { registerWallpaperRoutes } from "./api/wallpapers.js";
import { touchToken, upsertPrimaryToken, validateToken, validateTokenRecord } from "./auth.js";
import { getConfigDir } from "./cli.js";
import {
	ConfigResolver,
	corsOriginsToRegexps,
	loadAuthConfig,
	loadCorsOrigins,
	loadGcConfig,
	matchCorsOrigin,
} from "./config.js";
import type { AuthConfig } from "./config.js";
import { registerSeaStaticServing } from "./sea-static-server.js";
import { SessionManager } from "./session/session-manager.js";
import { seedShellProfiles } from "./shell-discovery.js";
import type { DatabaseManager } from "./storage/db.js";
import { MetaDAL } from "./storage/meta.js";
import { migrateLegacyShellDefaults } from "./storage/migrate-launch-profiles.js";
import { ThemeManager } from "./theme-manager.js";
import { registerWsRoutes } from "./ws/ws-handler.js";

export interface ServerOptions {
	host?: string; // default: "127.0.0.1"
	port?: number; // default: DEFAULT_PORT (4100)
	logger?: boolean; // default: true
	dbManager?: DatabaseManager; // when provided, WS routes are registered
	authToken?: string; // when provided, Bearer auth is enforced on all routes except /api/health
	authConfig?: AuthConfig; // override auth config (bypasses config.toml, useful for tests)
	configDir?: string; // override config directory (defaults to getConfigDir())
	corsOrigins?: string[]; // override CORS allowlist (bypasses config.toml, useful for tests)
	skipShellDiscovery?: boolean; // disable auto-shell-seeding (useful for tests)
}

export async function createServer(options?: ServerOptions): Promise<FastifyInstance> {
	const server = Fastify({
		logger: options?.logger ?? true,
	});

	// CORS — required for Tauri desktop (webview origin differs from hub)
	// and for remote hub access from web clients on other domains.
	// Origins are validated against an allowlist from config.toml [server] cors_origins.
	const configDir = options?.configDir ?? getConfigDir();
	const corsPatterns =
		options?.corsOrigins !== undefined ? options.corsOrigins : loadCorsOrigins(configDir);
	const compiledCorsRegexps = corsOriginsToRegexps(corsPatterns);

	await server.register(cors, {
		origin: (origin, cb) => {
			// No origin header (same-origin or non-browser): deny CORS headers
			if (!origin) return cb(null, false);
			const matched = matchCorsOrigin(origin, compiledCorsRegexps);
			cb(null, matched);
		},
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	});

	// Auth enforcement — applied before route matching
	if (options?.authToken) {
		const primaryToken = options.authToken;
		const db = options.dbManager?.meta ?? null;
		const resolvedAuthConfig =
			options?.authConfig !== undefined ? options.authConfig : loadAuthConfig(configDir);
		const ttlDays = resolvedAuthConfig.tokenTtlDays;

		// When a DB is available, seed the primary token record so all validation
		// goes through the DB path (expiry + revocation checks).
		if (db) {
			upsertPrimaryToken(db, primaryToken);
		}

		server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
			// CORS preflight is handled by @fastify/cors — skip auth.
			if (request.method === "OPTIONS") return;

			// Parse pathname from the raw URL to avoid query-string or path-traversal bypasses.
			const pathname = new URL(request.url, "http://localhost").pathname;

			// Unauthenticated endpoints — exact pathname match
			if (pathname === "/api/health") return;
			if (pathname === "/api/pair/verify") return;
			if (pathname === "/api/fonts") return;
			if (pathname === "/api/wallpapers" && request.method === "GET") return;

			// WebSocket auth is handled at the message level (AUTH → AUTH_OK/AUTH_FAIL),
			// not at the HTTP upgrade level.
			if (pathname === "/ws" || pathname.startsWith("/ws/")) return;

			// Static assets (index.html, JS bundles, etc.) do not require auth —
			// the UI itself handles the pairing/auth flow on first load.
			if (!pathname.startsWith("/api/")) return;

			const authHeader = request.headers.authorization;
			if (!authHeader) {
				server.log.warn({ url: pathname }, "auth: missing Authorization header");
				return reply.code(401).send({
					error: "AUTH_REQUIRED",
					message: "Authorization header required",
				});
			}

			const [scheme, token] = authHeader.split(" ");
			if (scheme !== "Bearer" || !token) {
				server.log.warn({ url: pathname }, "auth: malformed Authorization header");
				return reply.code(401).send({
					error: "AUTH_REQUIRED",
					message: "Authorization header must be: Bearer <token>",
				});
			}

			if (db) {
				// DB-backed validation: checks expiry and revocation status
				const record = validateTokenRecord(db, token);
				if (!record) {
					server.log.warn({ url: pathname }, "auth: invalid, expired, or revoked token");
					return reply.code(401).send({
						error: "AUTH_INVALID",
						message: "Invalid, expired, or revoked token",
					});
				}
				// Sliding-window expiry refresh + last_used_at update (best-effort, non-blocking)
				touchToken(db, record.id, ttlDays);
				server.log.debug({ url: pathname, tokenId: record.id }, "auth: accepted");
			} else {
				// Fallback: direct constant-time comparison (no DB — test/minimal mode)
				if (!validateToken(token, primaryToken)) {
					server.log.warn({ url: pathname }, "auth: invalid token");
					return reply.code(401).send({
						error: "AUTH_INVALID",
						message: "Invalid token",
					});
				}
				server.log.debug({ url: pathname }, "auth: accepted");
			}
		});
	}

	// Health endpoint
	server.get("/api/health", async () => {
		return { status: "ok" };
	});

	// Register WebSocket support and routes when a dbManager is provided
	if (options?.dbManager) {
		const fastifyMultipart = (await import("@fastify/multipart")).default;
		await server.register(fastifyMultipart, { limits: { fileSize: MAX_WALLPAPER_SIZE } });

		await server.register(websocket);

		// Load config from config.toml before creating SessionManager
		const gcConfig = loadGcConfig(configDir);

		// Build configResolver before SessionManager so it can be injected for title resolution
		const metaDalForConfig = new MetaDAL(options.dbManager.meta);
		const configResolver = new ConfigResolver(metaDalForConfig);
		configResolver.loadFromFile(configDir);

		const sessionManager = new SessionManager(
			options.dbManager,
			gcConfig,
			undefined,
			configResolver,
		);
		const metaDal = sessionManager.getMetaDal();
		metaDal.migrateHostGroupData();
		migrateLegacyShellDefaults(metaDal, configResolver);

		// First-run: ensure the built-in "local" host exists
		const wasNew = !metaDal.getHostByLabel("local");
		await sessionManager.ensureLocalHost();
		if (wasNew) {
			server.log.info("Created default local host");
		}

		// First-run: auto-detect and seed launch profiles from available shells.
		// Runs async after startup so it never blocks the server from accepting connections.
		// seedShellProfiles is idempotent — safe to call on every startup.
		// Skipped when skipShellDiscovery is set (e.g. in tests).
		if (!options?.skipShellDiscovery) {
			void seedShellProfiles(metaDal).then((result) => {
				if (result.profilesCreated > 0) {
					server.log.info(
						{
							profilesCreated: result.profilesCreated,
							shells: result.profiles.map((p) => p.shell),
						},
						"auto-detected and created launch profiles for available shells",
					);
				}
			});
		}

		await sessionManager.startup();

		await registerWsRoutes(
			server,
			sessionManager,
			options.authToken,
			options.authToken ? (options.dbManager.meta ?? null) : null,
			options.authToken
				? (options.authConfig ?? loadAuthConfig(configDir)).tokenTtlDays
				: undefined,
		);
		registerHostRoutes(server, metaDal);
		registerHostGroupRoutes(server, metaDal);
		registerLaunchProfileRoutes(server, metaDal);
		registerSessionRoutes(server, metaDal, sessionManager);
		registerChannelRoutes(server, metaDal, sessionManager, sessionManager.getSpoolDal());
		registerGroupRoutes(server, metaDal);
		registerConfigRoutes(server, metaDal, configResolver, sessionManager);
		registerFontRoutes(server, configDir);
		registerWallpaperRoutes(server, configDir);
		const themeManager = new ThemeManager(configDir);
		await themeManager.init();
		registerThemeRoutes(server, themeManager);
		if (options.authToken) {
			const resolvedAuthConfig =
				options.authConfig !== undefined ? options.authConfig : loadAuthConfig(configDir);
			registerPairRoutes(server, {
				authConfig: resolvedAuthConfig,
				db: options.dbManager.meta,
				metaDal,
			});
			registerTokenRoutes(server, { db: options.dbManager.meta });
		}
		await registerUserFonts(server, configDir);
		await registerUserSounds(server, configDir);
		await registerUserWallpapers(server, configDir);
		server.addHook("onClose", async () => {
			await sessionManager.shutdown();
		});
	}

	// Serve the embedded web client.
	// Priority: disk static/ directory → SEA embedded manifest → dev mode (no serving).
	await registerStaticIfExists(server);
	// When running as a SEA binary there is no static/ on disk — fall back to
	// the in-memory manifest embedded in the SEA blob.
	await registerSeaStaticServing(server);

	return server;
}

export async function startServer(
	server: FastifyInstance,
	options?: ServerOptions,
): Promise<string> {
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? DEFAULT_PORT;

	const address = await server.listen({ host, port });
	return address;
}

// ─── Static file helper ────────────────────────────────────────────────────────

/**
 * Register @fastify/static to serve the embedded web client from the
 * `static/` directory adjacent to this module.
 *
 * Graceful degradation: if the directory does not exist (i.e. during
 * development, where Vite serves the UI on a separate port), we simply
 * skip registration without throwing.
 */

/**
 * Register a second @fastify/static instance to serve user-provided fonts
 * from the config directory's `fonts/` subdirectory.
 *
 * The fonts directory is created on startup (mkdir -p) so users can just
 * drop .woff2 files in there.
 */
async function registerUserFonts(server: FastifyInstance, configDir: string): Promise<void> {
	const { mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const fontsDir = join(configDir, "fonts");
	mkdirSync(fontsDir, { recursive: true });

	const fastifyStatic = (await import("@fastify/static")).default;
	await server.register(fastifyStatic, {
		root: fontsDir,
		prefix: "/public/fonts/",
		decorateReply: false, // required for multiple @fastify/static plugins
	});

	server.log.info({ fontsDir }, "serving user fonts from config dir");
}

/**
 * Register a @fastify/static instance to serve user-provided sound files
 * from the config directory's `sounds/` subdirectory.
 *
 * The sounds directory is created on startup (mkdir -p) so users can just
 * drop audio files in there for custom bell sounds.
 */
async function registerUserSounds(server: FastifyInstance, configDir: string): Promise<void> {
	const { mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const soundsDir = join(configDir, "sounds");
	mkdirSync(soundsDir, { recursive: true });

	const fastifyStatic = (await import("@fastify/static")).default;
	await server.register(fastifyStatic, {
		root: soundsDir,
		prefix: "/public/sounds/",
		decorateReply: false, // required for multiple @fastify/static plugins
	});

	server.log.info({ soundsDir }, "serving user sounds from config dir");
}

/**
 * Register a @fastify/static instance to serve wallpaper images
 * from the config directory's `wallpapers/` subdirectory.
 */
async function registerUserWallpapers(server: FastifyInstance, configDir: string): Promise<void> {
	const { mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const wallpapersDir = join(configDir, "wallpapers");
	mkdirSync(wallpapersDir, { recursive: true });

	const fastifyStatic = (await import("@fastify/static")).default;
	await server.register(fastifyStatic, {
		root: wallpapersDir,
		prefix: "/public/wallpapers/",
		decorateReply: false,
		setHeaders: (res) => {
			res.setHeader("X-Content-Type-Options", "nosniff");
		},
	});

	server.log.info({ wallpapersDir }, "serving user wallpapers from config dir");
}

async function registerStaticIfExists(server: FastifyInstance): Promise<void> {
	const { existsSync } = await import("node:fs");
	const { join, dirname } = await import("node:path");
	const { fileURLToPath } = await import("node:url");

	// Resolve static/ relative to this source file:
	// - In the compiled dist/ tree: dist/server.js → ../../static/ (i.e. package root/static/)
	// - In source under src/: src/server.ts → ../../static/ (same result)
	const thisFile = fileURLToPath(import.meta.url);
	const staticDir = join(dirname(thisFile), "..", "static");

	if (!existsSync(staticDir)) {
		server.log.debug(
			{ staticDir },
			"static dir not found — skipping static file serving (dev mode)",
		);
		return;
	}

	// Lazy import so @fastify/static is not loaded when the dir is absent
	const fastifyStatic = (await import("@fastify/static")).default;
	await server.register(fastifyStatic, {
		root: staticDir,
		prefix: "/",
		// SPA fallback: serve index.html for any path not matching a real file
		// so that Vue Router client-side routes work after a hard refresh.
		wildcard: false,
	});

	server.log.info({ staticDir }, "serving web UI from static dir");
}
