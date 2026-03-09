# nexterm — Backlog

## In Progress

### UI/UX Sprint — Phase B (deferred)
- [ ] ⏭️ [UI] UX-08: Multi-host Groups (deferred, partially covered by UX-03 host groups)
- [ ] ⏭️ [UI] UX-10: Advanced Theming (absorbed into UX-06)

## Pending

### Review Findings
- [ ] ⏭️ [UI] typecheck useCommandPalette.spec.ts — false positive, hostId not on Channel type
- [ ] 🔧 [UI] Tab DnD reorder in tab bar (SC-21, priority:low) — Priority: L (from UX-01, missed in Block 4)
- [ ] 🔧 [Agent] EADDRINUSE randomized backoff on daemon spawn — Priority: L (from /review F-003, deprioritized)

### Deferred from /adversarial + /llm
- [ ] 💡 [Agent] Configurable socket bind timeout (currently hardcoded 5s) — Priority: L (from /adversarial C-07)
- [ ] 💡 [Agent] Peer UID verification via SO_PEERCRED on Unix socket — Priority: L (needs native C++ addon; 0700 dir perms sufficient for MVP)
- [ ] 💡 [Agent] Windows named pipe ACL hardening (restrict to current user) — Priority: L (needs native FFI/WinAPI binding)
- [ ] 💡 [Agent] Unix socket path length validation (~100 char limit) — Priority: L (from /llm Copilot)

### Deferred from UX-03 /review
- [ ] 🔧 [Web] HostRail tooltip missing channel count + connection duration (SC-17) — Priority: L (from /review F-007)
- [ ] 🔧 [Hub] SQL comment for COALESCE(host_group, '~') tilde sorting trick — Priority: L (from /review F-008)
- [ ] 🔧 [Hub] Batch import: set sshAuth based on IdentityFile presence — Priority: L (from /review F-009)
- [ ] 🔧 [Hub] SSH config parser: add test for alias-only Host block (no HostName) — Priority: L (from /review F-010)

### Deferred from UX-05 /review
- [ ] 🔧 [Web] SC-22 auto mode above threshold no brief badge — Priority: L (from /review F-005)
- [ ] 🔧 [Web] Grouped notification body says 'terminal' instead of channel name — Priority: L (from /review F-006)
- [ ] 🔧 [Web] No audio extension validation (.wav/.mp3/.ogg) in useBellSound — Priority: L (from /review F-008)

### Deferred from UX-07 /review
- [ ] 🔧 [Web] useVisualProfile getVisualProfile: shallow merge drops nested defaults — Priority: L (from /review F-003)

### Deferred from /adversarial Sprint 1
(Archived → docs/historic/done-2026-03.md)

### Deferred from /adversarial Sprint 2
- [ ] 💡 [UI] Windows Terminal import in Add Host modal — Priority: L (from UX-03 /adversarial C-01)
- [ ] 💡 [UI] Host group reorder (DnD group separators) — Priority: L (from UX-03 /adversarial C-02)
- [ ] 💡 [UI] ProxyJump auto-check in batch SSH import — Priority: L (from UX-03 /adversarial C-22)
- [ ] 💡 [UI] Banner position 'aboveTabs' option — Priority: L (from UX-07 /adversarial C-01)
- [ ] 💡 [UI] Collapsible banner with shortText — Priority: L (from UX-07 /adversarial C-02)
- [ ] 💡 [UI] Global notification rate limiter across all channels — Priority: L (from UX-05 /adversarial C-20)

### Deferred from UX-09 /review
- [ ] 🔧 [Web] SettingsPanel: toast notification on scope auto-fallback (SC-17) — Priority: L (from /review F-005)
- [ ] 🔧 [Web] settings store: dead else branch for top-level UI key → would 400 — Priority: L (from /review F-006)
- [ ] 🔧 [Hub] PATCH /api/hosts/:id/profile + channels: add TERMINAL_PROFILE_KEYS validation — Priority: L (from /review F-007)

### Deferred from UX-11 /llm
- [ ] 💡 [Web] Command palette: visible UI trigger button for touch/mouse users — Priority: L (from /llm Gemini)
- [ ] 💡 [Web] Command palette: prefix filter discoverability hint in input placeholder — Priority: L (from /llm Codex)
- [ ] 💡 [Web] Rail subtitle: middle truncation for hostnames (keep unique part) — Priority: L (from /llm Copilot)

### Deferred from UX-09 /spec + /adversarial
- [ ] 💡 [UI] Settings panel search/filter (VS Code style) — Priority: L (from UX-09 spec, P2)
- [ ] 💡 [UI] Settings sync across devices — Priority: L (from UX-09 spec, P2)
- [ ] 💡 [UI] Settings export/import as JSON — Priority: L (from UX-09 spec, P2)
- [ ] 💡 [UI] Keybindings editor with conflict detection — Priority: M (from UX-09 spec, P2)
- [ ] 💡 [UI] Config.toml comment-preserving write (TOML AST editor) — Priority: L (from /adversarial C-01, deferred: full stringify approach simpler)
- [ ] 💡 [Hub] WebSocket events for config changes (reactive settings across clients) — Priority: L (from /llm Copilot, deferred: single-user MVP)

### Deferred from UX-10 /review
- [ ] 🔧 [Web] vue-tsc pre-existing errors in SettingsPanel/AppearanceCategory/SchemaCategory (exactOptionalPropertyTypes) — Priority: L (from /review F-004)
- [ ] 💡 [Hub] Magic-number MIME validation beyond extension check for wallpaper uploads — Priority: L (from /llm review)
- [ ] 💡 [Hub] Disk quota enforcement for wallpapers directory — Priority: L (from /llm review)
- [ ] 💡 [Hub] Image bomb detection (pixel dimension limits) for wallpaper uploads — Priority: L (from /llm review)

### UX-11 user feedback
- [ ] 💡 [Hub+Web] SSH key path file picker — requires server-side file browser API (GET /api/files?dir=~/.ssh), web <input type="file"> gives client files not hub files — Priority: M
- [ ] 💡 [Hub+Web] Host icon image upload — same pattern as wallpapers: POST /api/icons, serve at /public/icons/, DnD in modal — Priority: M

### Phase 2 (follows AGENT-DAEMON)
- [ ] 💡 [Agent] Remote agent daemon via SSH tunnel — PTYs survive SSH drops (NextermAgent.connectTunnel) — Priority: P1

### Post-MVP
- [ ] 💡 [UI] Tauri v2 desktop packaging — Priority: P1
- [ ] 💡 [Hub] Search in scrollback (full-text index) — Priority: P1
- [ ] 💡 [Hub] OS keychain for auth token (keytar) — Priority: P1
- [ ] 💡 [Hub] Workspace export/import with blobs — Priority: P2
- [ ] 💡 [Hub] SQLCipher encryption at rest — Priority: P2
- [ ] 💡 [Hub] OIDC / mTLS — Priority: P2
- [ ] 💡 [Agent] Auto-install agent binary (Node SEA/pkg) — Priority: P2
- [ ] 💡 [Hub] Multi-writer collaboration (CRDT) — Priority: P2

## Completed

(Archived → docs/historic/done-2026-03.md)
