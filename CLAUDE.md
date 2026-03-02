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
nexterm (root)        → npm: nexterm (CLI entrypoint, `npx nexterm`)
packages/
├── shared/           → npm: @nexterm/shared (published)
├── agent/            → npm: @nexterm/agent  (published)
├── hub/              → npm: @nexterm/hub    (published)
└── clients/
    ├── web/          → @nexterm/web (NOT published, embedded by hub)
    └── desktop/      → @nexterm/desktop (P1, Tauri)
```

Dependencies: shared ← agent, shared ← hub, shared ← web.
hub depends on agent types but NOT agent package (agent runs as separate process).
hub embeds web build output as static files.
Root `nexterm` CLI wraps `@nexterm/hub`.

## Commands

```bash
pnpm install              # Install all deps
pnpm dev                  # Start hub + UI dev servers (concurrent)
pnpm build                # Build all packages
pnpm test                 # Run all tests (vitest)
pnpm lint                 # Lint + format check (biome)
pnpm lint:fix             # Auto-fix lint issues
pnpm -F @nexterm/hub test # Test single package
pnpm -F @nexterm/web dev  # Dev single package
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
- Scopes: shared, agent, hub, web, desktop, root
- Branch: `main` for trunk, `feat/xxx` for features

## Workflow Execution Strategy

This project uses `/workflow` in **plan-provided mode** — specs are pre-written in `docs/`.
The orchestrating session MUST be **Sonnet**. Launch with: `claude --model sonnet`

### Model Routing (MANDATORY — no discretion)

| Task | Model | How | Why |
|------|-------|-----|-----|
| **Orchestration** (workflow state, stage transitions, TODO tracking) | **Sonnet** | Main session | Mechanical protocol following, cost-efficient |
| **Code implementation** (write blocks, fix findings) | **Opus** | `Task(general-purpose, opus)` | Architecture decisions, code quality |
| **Code review** | **Opus** | `Task(senior-code-reviewer, opus)` | Deep analysis, security, patterns |
| **Tests, lint, build** | **Haiku** | `Task(Bash, haiku)` | Mechanical execution, cheapest |
| **File exploration, codebase search** | **Haiku** | `Task(Explore, haiku)` | Read-only, no judgment needed |
| **Git push, PR, merge** | **Haiku** | `Task(Bash, haiku)` | Mechanical git operations |

### Block Implementation Pattern

For each implementation block, Sonnet orchestrator MUST delegate like this:

```
1. Sonnet reads MVP_ROADMAP.md block description + exit criteria
2. Sonnet reads relevant spec sections (SPEC.md, PROTOCOL.md, etc.)
3. Sonnet formulates detailed prompt with:
   - Block description + exit criteria
   - Relevant spec excerpts (copy the sections, don't say "read file X")
   - Files to create/modify (from SPEC.md § 8.2 directory layout)
   - Test requirements
4. Task(general-purpose, opus, "Implement block N.M: [description]... [full context]")
5. Opus writes code + tests
6. Task(Bash, haiku, "cd ~/dev/nexterm && pnpm test && pnpm lint")
7. If tests fail → Task(general-purpose, opus, "Fix: [error output]")
8. Loop until green
9. Sonnet updates .workflow-state.json + TODO.md
```

### What Sonnet Orchestrator Does NOT Do

- **NEVER** write implementation code directly (always delegate to Opus)
- **NEVER** run tests directly (always delegate to Haiku)
- **NEVER** explore codebase directly (delegate to Haiku Explore)
- **NEVER** make architectural decisions — if an ambiguity arises that specs don't cover, STOP and ask the user

### What Sonnet Orchestrator DOES Do

- Read and update `.workflow-state.json`
- Read and update `TODO.md`
- Formulate delegation prompts with full context (specs + block details)
- Route results between stages (implement → test → review → fix → finalize)
- Track progress, announce checkpoints

### Review Pattern

After all blocks in a milestone are complete:

```
Task(senior-code-reviewer, opus, "Review all code changes for milestone MN.
  Check against: docs/SPEC.md, docs/PROTOCOL.md, docs/STORAGE.md, docs/SECURITY.md.
  Focus: architecture compliance, security (OWASP), test coverage, naming conventions.")
```

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
