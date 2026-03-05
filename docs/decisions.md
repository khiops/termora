# Architecture Decisions

Decisions archived from workflow — newest first.

---

## m-backlog-sweep — Fix all M-priority review backlog items (2026-03-05)

- GC dead_retention_hours and max_size_per_channel_mb configurable via config.toml [gc] section
- SendQueue extracted to shared class with pending/isDraining/frames getters
- Session reuse already implemented — backlog item was obsolete
- WS input validation in shared/validation.ts (ULID, dimensions, data size, env)
- useRename composable with onCommit callback pattern

---

## editable-channel-names — Editable channel names + backpressure + font fix (2026-03-05)

- channels.title column already exists in DB (nullable) — leverage existing schema
- Default channel name: "Terminal" (simplified from Shell #N counting approach)
- PATCH /api/channels/:id for rename with 1-128 char validation
- Optimistic UI update with rollback on PATCH failure
- Double-click to rename in both sidebar ChannelItem and TabBar
- v-show keep-alive for tabs: prevents terminal replay/destruction on tab switch
- Backpressure across agent→hub pipeline: pause/drain in agent, send queues in LocalAgent/SshAgent
- Font watcher race fix: removed ready.value guard, apply profile unconditionally

---

## MVP-NEXTERM — Implement full nexterm MVP (2026-03-03)

- Plan-provided mode: specs in docs/
- Continuous mode: no pauses between stages
- Model routing: Sonnet implements, Opus reviews, Haiku tests
- HostRail: djb2 hash → HSL palette, 48px column
- ChannelSidebar: groups in localStorage, drag not needed for MVP
- PaneLayout: recursive split tree, localStorage persistence
- CommandPalette: module-level singleton, fuzzy includes match
- ConfigResolver: 4-layer deep merge, null removes key, arrays replace
- CLI: manual argv parser (no yargs/commander), dynamic imports for heavy deps
- Onboarding: auto-create local host, openBrowser via execFile
- Token auth: 32-byte hex, timingSafeEqual, chmod 600 auth.json
- Pairing: 6-digit code (padStart), 60s expiry, max 3 active
- Write-lock: 3-tier (auto-claim, request/grant, force), first-attach=writer
- WriteLockManager: standalone class with DI callbacks
- @xterm/headless CJS: default import + destructure
- Auth hook skips /health and /pair/verify
