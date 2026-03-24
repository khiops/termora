# nexterm — Backlog

## Recently Completed: LOGGING-DAEMON (2026-03-21)

(8 blocks archived → docs/historic/done-2026-03.md)

### Review findings (M — deferred)
- [ ] 🔧 [Logging] Async I/O for loggers — replace appendFileSync with createWriteStream (from /review F-002) — Priority: M
- [ ] 🔧 [Logging] Streaming readJsonl — use readline for log search API instead of readFileSync (from /review F-003) — Priority: M
- [ ] 🔧 [Web] Frontend tests for LogViewer.vue and useLogs.ts composable (from /review F-008) — Priority: M

### Out-of-scope
- [ ] 💡 [Logging] Log format config (always JSONL for now) — Priority: L

## Completed: Rust Agent Rewrite

**Spec:** `docs/plans/rust-agent.md` | **Brief:** `docs/briefs/rust-agent.md`

- [x] ✅ Block 1: async-xpty — Unix PTY (spawn, I/O, resize, exit) (2026-03-21)
- [x] ✅ Block 2: async-xpty — Windows ConPTY + \x1b[6n fix (2026-03-21) — code only, Windows CI needed
- [x] ✅ Block 3: nexterm-agent — Scaffold + framing + HELLO + shell detection (2026-03-21)
- [x] ✅ Block 4: nexterm-agent — SPAWN + INPUT/OUTPUT/RESIZE + batching + var expansion (2026-03-21)
- [x] ✅ Block 5: nexterm-agent — Terminal mirror (vt100) + snapshots + title/bell/notification (2026-03-21)
- [x] ✅ Block 6: nexterm-agent — Process title polling (2026-03-21)
- [x] ✅ Block 7: nexterm-agent — Elevation wrapping (2026-03-21)
- [x] ✅ Block 8: nexterm-agent — Daemon mode (UDS, connection displacement, output buffer) (2026-03-21)
- [x] ✅ Block 9: nexterm-agent — HEARTBEAT, ATTACH, backpressure, graceful shutdown (2026-03-21)
- [x] ✅ Block 10: Integration tests + CI (2026-03-21)

### Review findings (all resolved)
- [x] ✅ F-001: ERROR frame on INPUT/RESIZE dead channel (2026-03-21)
- [x] ✅ F-002: Unknown message → ERROR INVALID_MESSAGE, no crash (2026-03-21)
- [x] ✅ F-003: Extract spawn_reader_task from handle_spawn (2026-03-21)
- [x] ✅ F-004: DRY HELLO — build_hello() shared function (2026-03-21)
- [x] ✅ F-005: Pre-build argv/envp before fork — POSIX safety (2026-03-21)
- [x] ✅ F-006: XDG_RUNTIME_DIR for ASKPASS tmpdir (2026-03-21)
- [x] ✅ F-007: Document Zeroizing gap in protocol.rs (2026-03-21)

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
- [ ] 💡 [Agent-RS] MessagePack alloc optimization — pool/arena if profiling shows overhead — Priority: L (from /adversarial, deferred: optimize only if measured)
- [ ] 💡 [Web] Dead channel UX: show last snapshot behind exit overlay, restart resumes on same terminal (seamless) — Priority: H
- [ ] 🟡 [All] Build versioning — git commit hash in /api/health, title bar, package.json — Priority: H
- [ ] 🔧 [Desktop] Generate Tauri updater signing key and set pubkey in tauri.conf.json — Priority: M
- [ ] 🔧 [Desktop] Auto-create "local" host on first launch if none exists — Priority: H
- [ ] 🔧 [Hub] `initSync()` deprecation warning — pass `{ module }` object to toml-edit-js — Priority: L
- [x] ✅ [Hub+Web] SSH key path file picker — Browse modal in HostModal + GET/POST/DELETE /api/ssh-keys (2026-03-24)
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
- [ ] 💡 [Hub+Web] SSH passphrase "remember for session" — cache decrypted key in memory per session, checkbox in AUTH_PROMPT modal — Priority: M
- [ ] 💡 [Hub] Remote agent auto-deploy — upload agent binary via SSH/SFTP on first connect to remote host — Priority: H
- [ ] 🐛 [Agent-RS] BELL WS message not sent for WSL shells — contains_bell heuristic may miss BEL in some contexts — Priority: L

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
