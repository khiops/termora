# nexterm — Backlog

## In Progress

### UI/UX Sprint — Briefs Complete (docs/briefs/)
- [x] ✅ [UI] UX-06: Theming & Color Schemes (2026-03-07) — 7 blocks, 748 tests, /review clean
  - [x] Block 1: Theme Model + Bundled Presets (shared)
  - [x] Block 2: Theme File Storage + REST API (hub)
  - [x] Block 3: CSS Variable System + Theme Store (web)
  - [x] Block 4: xterm.js Theme Integration (web)
  - [x] Block 5: Theme Picker + Live Preview (web)
  - [x] Block 6: Theme Editor + Import/Export (web)
  - [x] Block 7: OS Auto-Switch + Opacity + Scrollbar (web)
- [ ] 🟡 [UI] UX-01: Tab Actions, Split Panes, Welcome Tab — spec ready (docs/plans/ux-01-tab-actions.md)
  - [ ] Block 1: Tab Context Menu + Close Actions (web) — M
  - [ ] Block 2: Vacant Pane Slots + Picker (web) — M
  - [ ] Block 3: Welcome Tab (web + hub) — M
  - [ ] Block 4: Cross-Tab Pane DnD (web) — M
  - [ ] Block 5: Configure Command + Direct Process (web + hub + agent) — M
  - [ ] Block 6: Channel Sidebar Context Menu + States (web) — S
  - [ ] Block 7: Settings + Confirmations (web + hub) — S
- [ ] 🟡 [UI] UX-02: Terminal Title — spec ready (docs/plans/ux-02-terminal-title.md)
  - [ ] Block 1: TITLE_CHANGE Protocol + DB Migration (shared + agent + hub) — S
  - [ ] Block 2: UI Dynamic Title Display + Title Stack (web) — S
  - [ ] Block 3: Title Truncation + Sanitization (shared + web) — S
  - [ ] Block 4: Window Title + Per-Host Prefix (web + hub) — S
  - [ ] Block 5: Title Settings + Reset to Dynamic (web + hub) — S
- [ ] 🟡 [UI] UX-04: Scrollback Search — spec ready (docs/plans/ux-04-scrollback-search.md)
  - [ ] Block 1: SearchAddon Integration + Basic Search (web) — S
  - [ ] Block 2: Search Overlay UI (web) — M
  - [ ] Block 3: Search Toggles + Keyboard Shortcuts (web) — S
  - [ ] Block 4: Scrollbar Markers (web) — S
  - [ ] Block 5: Multi-Pane Search Scope (web) — M
  - [ ] Block 6: Search History + Settings (web + hub) — S
### Deferred from /adversarial Sprint 1
- [ ] 💡 [Docs] Config schema documentation — all 4 sprint 1 stories add [sections] to config.toml — Priority: M (from /adversarial X-02)
- [x] ⏭️ [UI] UX-06 Block 6 (Theme Editor) deferral candidate — implemented (2026-03-07)

- [ ] 💡 [UI] UX-03: Host Management (Sprint 2)
- [ ] 💡 [UI] UX-05: Notifications (Sprint 3)
- [ ] 💡 [UI] UX-07: Host Customization & Visual Profiles (Sprint 3)
- [ ] 💡 [UI] UX-09: Settings Panel — Config Cascade UI (Sprint 4)
- [ ] ⏭️ [UI] UX-08: Multi-host Groups (deferred, partially covered by UX-03 host groups)
- [ ] ⏭️ [UI] UX-10: Advanced Theming (absorbed into UX-06)

## Recently Completed

## Pending

### Review Findings
- [x] ✅ [Hub] waitForChannelState() listener cleanup on timeout (2026-03-06) — Promise.race + clearTimeout
- [x] ✅ [Hub] DRY: extract shared daemon attach logic (2026-03-06) — _attachDaemon helper
- [x] ✅ [Shared] Add EACCES test for probeSocket() (2026-03-06)
- [x] ✅ [Hub] Add waitForSocket() timeout test (2026-03-06)
- [x] ✅ [Agent] Add stat() assertion for 0700 socket dir permissions (2026-03-06)
- [ ] ⏭️ [UI] typecheck useCommandPalette.spec.ts — false positive, hostId not on Channel type
- [ ] 🔧 [Agent] EADDRINUSE randomized backoff on daemon spawn — Priority: L (from /review F-003, deprioritized)

### Deferred from /adversarial + /llm
- [ ] 💡 [Agent] Configurable socket bind timeout (currently hardcoded 5s) — Priority: L (from /adversarial C-07)
- [ ] 💡 [Agent] Peer UID verification via SO_PEERCRED on Unix socket — Priority: M (from /adversarial C-08)
- [ ] 💡 [Agent] Windows named pipe ACL hardening (restrict to current user) — Priority: M (from /llm Codex)
- [ ] 💡 [Agent] Unix socket path length validation (~100 char limit) — Priority: L (from /llm Copilot)

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
