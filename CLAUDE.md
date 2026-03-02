# nexterm — CLAUDE.md

## Vision

Local-first session terminal platform: hub daemon + remote agents + SSH transport + PWA UI.
Sessions survive client disconnects, SSH drops, and device switches.

## Documentation

**Read these FIRST before any implementation:**

| Doc | What | When to read |
|-----|------|-------------|
| `docs/SPEC.md` | Architecture, components, entity model, data flows, config cascade | Always — primary reference |
| `docs/PROTOCOL.md` | MessagePack framing, all message types, REST API schemas | When touching protocol/API |
| `docs/STORAGE.md` | SQLite schemas, chunking, GC, migrations | When touching DB/storage |
| `docs/SECURITY.md` | Threat model, auth, SSH security, input validation | When touching auth/SSH/validation |
| `docs/MVP_ROADMAP.md` | 6 milestones, ~30 blocks, exit criteria, dependencies | For /workflow planning |
| `docs/IDEATION_BRIEF.md` | Original ideation with rationale for all decisions | When questioning "why" |

## Stack

| Key | Value |
|-----|-------|
| Runtime | Node.js >= 20 LTS |
| Language | TypeScript strict (all packages) |
| Monorepo | pnpm workspaces |
| Package manager | pnpm |
| Linter/formatter | biome |
| Test framework | vitest |
| Test pattern | `*.spec.ts` (colocated) |
| PTY | node-pty |
| SSH | ssh2 |
| Terminal (UI) | xterm.js + addon-fit + addon-serialize |
| Terminal (Agent) | xterm.js headless + addon-serialize |
| Codec | @msgpack/msgpack |
| Storage | better-sqlite3 (WAL mode) |
| HTTP/WS | Fastify + @fastify/websocket |
| UI framework | Vue 3 (Composition API) |
| UI build | Vite |
| UI state | Pinia |
| Config parse | @iarna/toml |
| IDs | ulid |

## Monorepo Structure

```
packages/
├── shared/    # @nexterm/shared — types, codec, framing
├── agent/     # @nexterm/agent — remote PTY manager
├── hub/       # @nexterm/hub   — local daemon
└── ui/        # @nexterm/ui    — Vue 3 SPA
```

Dependencies flow: shared ← agent, shared ← hub, shared ← ui.
hub depends on agent types but NOT agent package (agent runs as separate process).

## Commands

```bash
pnpm install              # Install all deps
pnpm dev                  # Start hub + UI dev servers (concurrent)
pnpm build                # Build all packages
pnpm test                 # Run all tests (vitest)
pnpm lint                 # Lint + format check (biome)
pnpm lint:fix             # Auto-fix lint issues
pnpm -F @nexterm/hub test # Test single package
pnpm -F @nexterm/ui dev   # Dev single package
```

## Conventions

### Code

- All protocol messages use **snake_case** on the wire (MessagePack)
- All TypeScript interfaces use **camelCase**
- Codec layer handles conversion at encode/decode boundaries
- IDs: ULID everywhere (sortable, no UUID)
- Timestamps: ISO 8601 strings in DB and protocol
- SQL: parameterized queries ONLY (never interpolate)
- Errors: structured `{ code, message }` — never throw raw strings
- File permissions: chmod 600 for auth.json, DB files

### Dependencies

- External deps via `catalog:` in pnpm-workspace.yaml
- Internal deps via `workspace:*`

### Testing

- Unit: vitest, colocated `*.spec.ts`
- Integration: better-sqlite3 in-memory (`:memory:`)
- E2E (remote): mock SSH server (never real SSH in CI)
- PTY: real node-pty on all platforms
- WS: mock for UI tests, real for E2E

### Git

- Commit format: `type(scope): description`
- Types: feat, fix, refactor, docs, test, chore
- Scopes: shared, agent, hub, ui, root
- Branch: `main` for trunk, `feat/xxx` for features

## Architecture Quick Reference

```
UI (Vue 3 + xterm.js) ──── WS + REST ──── Hub (Fastify, 127.0.0.1:3100)
                                            ├── Local PTY (node-pty)
                                            ├── SSH → Agent (ssh2 + stdio)
                                            ├── meta.db (config, relational)
                                            └── spool.db (output, snapshots)

Agent (remote, via SSH stdio):
  stdin → MessagePack frames → PTY manager → N channels
  stdout ← MessagePack frames ← OUTPUT/SNAPSHOT
```

## Entity Model

Host (permanent) → Session (runtime) → Channel (PTY instance)
ChannelGroup (organizational, per host)
Workspace (layout persistence)

## Config Cascade (4 layers, deep merge, last wins)

1. Built-in defaults (code)
2. `~/.config/nexterm/config.toml` (user)
3. `hosts.profile_json` (per-host, meta.db)
3.5. Agent visual hints (from HELLO, ephemeral)
4. `channels.profile_json` (per-channel, meta.db)

## Common Pitfalls

- xterm.js headless needs DOM polyfill — see spike criteria in SPEC.md § 3.2
- never store SSH passwords (prompt at connect, clear after auth)
- spool.db writes are continuous/heavy — use INCREMENTAL auto_vacuum, not full VACUUM
- MessagePack Uint8Array: use `@msgpack/msgpack` with `useBigInt64: false`
- SQLite cross-DB: no FK between meta.db and spool.db — use cache_index for consistency
- Auth token comparison: always `crypto.timingSafeEqual` (constant-time)
