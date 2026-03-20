# nexterm — Backlog

## Recently Completed

(Archived → docs/historic/done-2026-03.md)

## Tier 1 — Next Sprint (UX + DX)

### Audit P0-P3

(All 25 items completed — archived → docs/historic/done-2026-03.md)

### Desktop/Tauri (this session)
- [x] ✅ [Desktop] Disable CSP — was blocking Tauri IPC + inline styles + xterm.js (2026-03-19)
- [x] ✅ [Desktop] DevTools in release builds (gated on debug_assertions) (2026-03-19)
- [x] ✅ [Hub] Agent path resolution for SEA/Tauri — use co-located binary (2026-03-19)
- [x] ✅ [Agent] PTY conpty/winpty fix — embed conpty.node in SEA build (2026-03-19)
- [x] ✅ [Hub] Default shell fallback — COMSPEC/cmd.exe on Windows (2026-03-19)
- [x] ✅ [Web] WS race condition — filter ERROR listener by channelId in reattachChannel (2026-03-19)
- [x] ✅ [Hub] Shell auto-discovery on first startup — Windows + Unix (/etc/shells) (2026-03-19)
- [x] ✅ [Hub] Windows Terminal import — POST /api/launch-profiles/import-windows-terminal (2026-03-19)

### Other
- [ ] 🔧 [Desktop] Generate Tauri updater signing key and set pubkey in tauri.conf.json — Priority: M
- [ ] 🔧 [Desktop] Auto-create "local" host on first launch if none exists — Priority: H
- [ ] 🔧 [Hub] `initSync()` deprecation warning — pass `{ module }` object to toml-edit-js — Priority: L
- [ ] 💡 [Hub+Web] SSH key path file picker — server-side file browser API (GET /api/files?dir=~/.ssh) — Priority: M
- [ ] 💡 [Hub+Web] Host icon image upload + upload security bundle (MIME magic-byte validation, disk quota, image bomb detection) — Priority: M
- [ ] 💡 [Web] Keybindings editor with conflict detection — Priority: M
- [ ] 💡 [Web] Settings panel search/filter (VS Code style) — Priority: M
- [ ] 💡 [Desktop] Add permissive CSP for defense-in-depth (review F-004) — Priority: L
- [ ] 💡 [Agent] Embed conpty.node in SEA for full conpty support (verify on Windows 10+) — Priority: M
- [ ] 🔧 [Hub] API route tests for /api/host-groups CRUD + reorder — Priority: M
- [ ] 🔧 [Hub] handleAuthPromptResponse: verify responding clientId matches prompt initiator — Priority: L
- [ ] 🔧 [Hub] pendingAuthPrompts race condition: guard against concurrent SPAWN for same host — Priority: L
- [ ] 🔧 [Hub] SSH TOFU: trust_once not distinct from trust_permanent — both persist fingerprint (review F-001) — Priority: L
- [ ] 🔧 [Web] SSH host-verify: expose "Trust Once" button in HostKeyWarning.vue (review F-001) — Priority: L
- [ ] 🔧 [Hub] SessionManager: flip `if (agent != null)` guard to positive form for readability (review F-003) — Priority: L
- [ ] 💡 [Docs] CORS: document that tauri://localhost custom port needs manual cors_origins entry (review F-004) — Priority: L
- [ ] 🔧 [Hub] SSH reconnect: pass auth callback to SshAgent during reconnect (review F-005) — Priority: M

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
