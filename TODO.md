# nexterm — Backlog

## Recently Completed

- [x] ✅ [Desktop] Auto-auth flow: invoke `get_hub_auth_token` before token gate in App.vue (2026-03-13)
- [x] ✅ [Desktop] TitleBar z-index above PairingScreen overlay (2026-03-13)
- [x] ✅ [Desktop] Fix sidecar path: `nexterm-hub` not `binaries/nexterm-hub` (2026-03-13)
- [x] ✅ [Desktop] Custom NSIS installer: license, per-user/global, component selection (Hub/Agent) (2026-03-13)
- [x] ✅ [CI] Fix artifact glob: upload NSIS `.exe` not `.nsis` (was uploading only MSI) (2026-03-14)
- [x] ✅ [Desktop] Hub sidecar: pass `start` arg (was exiting immediately with code 0) (2026-03-14)
- [x] ✅ [Desktop] Hub sidecar logging to `hub.log` (stdout/stderr/exit capture) (2026-03-14)
- [x] ✅ [Web] Absolute URLs for Tauri: `hubBaseUrl()` / `hubWsUrl()` utility (15 files) (2026-03-14)
- [x] ✅ [Hub] SEA: invoke `main()` via esbuild footer (cli.ts exported but never self-called) (2026-03-14)
- [x] ✅ [Hub] SEA: embed toml-edit WASM as asset (`getRawAsset` + `initSync`) (2026-03-14)
- [x] ✅ [Hub] SEA: bundle better-sqlite3 JS + shim `bindings` → `__seaSqliteExports` (2026-03-14)
- [x] ✅ [Agent] SEA: extract winpty.dll + winpty-agent.exe BEFORE pty.node dlopen (2026-03-14)
- [x] ✅ [Hub] CORS: `@fastify/cors` for Tauri cross-origin + remote hub support (2026-03-15)
- [x] ✅ [Desktop] Dynamic hub port: detect existing hub via runtime.json, `get_hub_port` invoke (2026-03-15)
- [x] ✅ [Test] SEA E2E tests: skip outside CI (`process.env.CI` gate) (2026-03-13)
- [x] ✅ [CI] Add `workflow_dispatch` trigger for manual reruns (2026-03-14)

## Tier 1 — Next Sprint (UX + DX)

- [ ] 🔧 [Desktop] Generate Tauri updater signing key and set pubkey in tauri.conf.json — Priority: M
- [ ] 🔧 [Desktop] Auto-create "local" host on first launch if none exists — Priority: H
- [ ] 🔧 [Hub] `initSync()` deprecation warning — pass `{ module }` object to toml-edit-js — Priority: L
- [ ] 💡 [Hub+Web] SSH key path file picker — server-side file browser API (GET /api/files?dir=~/.ssh) — Priority: M
- [ ] 💡 [Hub+Web] Host icon image upload + upload security bundle (MIME magic-byte validation, disk quota, image bomb detection) — Priority: M
- [ ] 💡 [Web] Keybindings editor with conflict detection — Priority: M
- [ ] 💡 [Web] Settings panel search/filter (VS Code style) — Priority: M
- [ ] 💡 [Web+Hub] Windows Terminal import in Add Host modal — Priority: M
- [ ] 🔧 [Hub] API route tests for /api/host-groups CRUD + reorder — Priority: M
- [ ] 🔧 [Hub] handleAuthPromptResponse: verify responding clientId matches prompt initiator — Priority: L
- [ ] 🔧 [Hub] pendingAuthPrompts race condition: guard against concurrent SPAWN for same host — Priority: L

## Tier 2 — Quick Wins (batchable)

- [ ] 💡 [Hub+Agent] Configurable logging — `[logging]` section in config.toml (level, format text/json, output stderr/file) — Priority: M
- [ ] 💡 [Web+Hub] Dead channel display policy as setting (show/hide/auto-purge) with per-host override — Priority: L
- [ ] 💡 [Web] Rail subtitle: middle truncation for hostnames (keep unique part) — Priority: L
- [ ] 💡 [Web+Hub] ProxyJump auto-check in batch SSH import — Priority: L
- [ ] 💡 [Web] Global notification rate limiter across all channels — Priority: L
- [ ] 💡 [Web] Banner position 'aboveTabs' option — Priority: L
- [ ] 💡 [Web] Collapsible banner with shortText — Priority: L
- [ ] 💡 [Hub] Upload security: apply MIME/quota/image-bomb to wallpapers too (currently extension-only) — Priority: L
- [ ] 💡 [Hub] Color field validation on host-groups API (hex regex or allowlist) — Priority: L
- [ ] 🔧 [Web] Design system: define missing --nt-* vars (bg-raised, input-bg, hover, danger, fg-muted, bg-surface) in base.css — Priority: L
- [ ] 🔧 [Hub] Remove dead DAL methods renameHostGroup/deleteHostGroup/listHostGroups (legacy string-based) — Priority: L
- [ ] 💡 [Web] Env key warning for dangerous keys (PATH, LD_PRELOAD, LD_LIBRARY_PATH) in profile editor — Priority: L
- [ ] 🔧 [Shared] Rename `directProcess` → `mode` in AgentSpawnMessage (breaking change, next protocol version) — Priority: L
- [ ] 💡 [Agent] Windows SSH elevation via native helper (`CreateProcessWithLogonW`) — Priority: L

## Tier 3 — Strategic (milestones)

- [ ] 💡 [Agent] Remote agent daemon via SSH tunnel — PTYs survive SSH drops — Priority: P1
- [ ] 💡 [Hub] Search in scrollback (FTS5 full-text index + search UI) — Priority: P1
- [ ] 💡 [Hub] OS keychain for auth token (keytar) — Priority: P1

## Tier 4 — Deferred (revisit in 3 months)

- [ ] 💡 [UI] Settings sync across devices — Priority: P2
- [ ] 💡 [UI] Settings export/import as JSON — Priority: P2
- [ ] 💡 [Hub] WebSocket events for config changes (reactive settings across clients) — Priority: P2
- [ ] 💡 [Hub] Workspace export/import with blobs — Priority: P2
- [ ] 💡 [Hub] SQLCipher encryption at rest — Priority: P2
- [ ] 💡 [Hub] OIDC / mTLS — Priority: P2
- [ ] 💡 [Hub] Multi-writer collaboration (CRDT) — Priority: P2
- [ ] 💡 [Agent] Peer UID verification via SO_PEERCRED on Unix socket — Priority: P2
- [ ] 💡 [Agent] Windows named pipe ACL hardening (restrict to current user) — Priority: P2

## Completed

(Archived → docs/historic/done-2026-03.md)
