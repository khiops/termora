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
- [x] ✅ [UI] UX-01: Tab Actions, Split Panes, Welcome Tab (2026-03-07) — 7 blocks, 802 tests, /review clean
  - [x] Block 1: Tab Context Menu + Close Actions (web)
  - [x] Block 2: Vacant Pane Slots + Picker (web)
  - [x] Block 3: Welcome Tab (web + hub)
  - [x] Block 4: Cross-Tab Pane DnD (web)
  - [x] Block 5: Configure Command + Direct Process (web + hub + agent)
  - [x] Block 6: Channel Sidebar Context Menu + States (web)
  - [x] Block 7: Settings + Confirmations (web + hub)
- [x] ✅ [UI] UX-02: Terminal Title (2026-03-07) — 5 blocks, 892 tests, /review clean
  - [x] Block 1: TITLE_CHANGE Protocol + DB Migration (shared + agent + hub)
  - [x] Block 2: UI Dynamic Title Display + Title Stack (web)
  - [x] Block 3: Title Truncation + Sanitization (shared + web)
  - [x] Block 4: Window Title + Per-Host Prefix (web + hub)
  - [x] Block 5: Title Settings + Reset to Dynamic (web + hub)
- [x] ✅ [UI] UX-04: Scrollback Search (2026-03-07) — 6 blocks, 984 tests, /review clean
  - [x] Block 1: SearchAddon Integration + Basic Search (web) — S
  - [x] Block 2: Search Overlay UI (web) — M
  - [x] Block 3: Search Toggles + Keyboard Shortcuts (web) — S
  - [x] Block 4: Scrollbar Markers (web) — S
  - [x] Block 5: Multi-Pane Search Scope (web) — M
  - [x] Block 6: Search History + Settings (web + hub) — S
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
- [ ] 🔧 [UI] VacantPane: filter detached channels by hostId (currently shows all hosts) — Priority: M (from /review F-006)
- [ ] 🔧 [UI] TerminalPane: channel?.hostId references non-existent field, falls back silently — Priority: M (from /review F-009)
- [ ] 🔧 [UI] useLayout localStorage load: validate max-pane-count (INV-10) — Priority: M (from /review F-011)
- [ ] 🔧 [Hub] session-manager.spec.ts: crash-loop 60s window reset test skipped (timer cascade) — Priority: M (from /review F-003)
- [ ] 🔧 [UI] Tab DnD reorder in tab bar (SC-21, priority:low) — Priority: L (from UX-01, missed in Block 4)
- [ ] 💡 [UI] E2E scenarios for UX-06 + UX-01 + UX-02 + UX-04 — update TESTING_E2E.md after all 4 stories — Priority: M
- [ ] 🔧 [Agent] EADDRINUSE randomized backoff on daemon spawn — Priority: L (from /review F-003, deprioritized)
- [ ] 🔧 [UI] DRY: refactor TerminalPane.paneTitle + App.activeTitle to use useTabTitle composable — Priority: M (from UX-02 /review F-004)
- [ ] 🔧 [UI] DRY: useMultiPaneSearch findNextAll/findPreviousAll near-symmetric (~50 lines each) — Priority: M (from UX-04 /review F-007)

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
