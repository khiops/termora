# nexterm — Backlog

## In Progress

### UI/UX Sprint — Phase B
- [ ] 🟡 [UI] UX-05: Notifications — spec ready (docs/plans/ux-05-notifications.md), 7 blocks, 32 BDD, adversarial+llm×2
- [ ] 🟡 [UI] UX-07: Host Customization — spec ready (docs/plans/ux-07-host-customization.md), 5 blocks, 20 BDD, adversarial+llm×2
- [ ] 💡 [UI] UX-09: Settings Panel — Config Cascade UI (Sprint 4)
- [ ] ⏭️ [UI] UX-08: Multi-host Groups (deferred, partially covered by UX-03 host groups)
- [ ] ⏭️ [UI] UX-10: Advanced Theming (absorbed into UX-06)

## Pending

### Review Findings
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

### Deferred from UX-03 /review
- [ ] 🔧 [Web] DeleteHostModal: hasActiveSessions always false — needs session store data — Priority: M (from /review F-004)
- [ ] 🔧 [Hub] testSshConnectivity returns ok:true for auth failures — confusing UX — Priority: M (from /review F-005)
- [ ] 🔧 [Web] HostRail tooltip missing channel count + connection duration (SC-17) — Priority: L (from /review F-007)
- [ ] 🔧 [Hub] SQL comment for COALESCE(host_group, '~') tilde sorting trick — Priority: L (from /review F-008)
- [ ] 🔧 [Hub] Batch import: set sshAuth based on IdentityFile presence — Priority: L (from /review F-009)
- [ ] 🔧 [Hub] SSH config parser: add test for alias-only Host block (no HostName) — Priority: L (from /review F-010)

### Deferred from /adversarial Sprint 1
- [ ] 💡 [Docs] Config schema documentation — all 4 sprint 1 stories add [sections] to config.toml — Priority: M (from /adversarial X-02)

### Deferred from /adversarial Sprint 2
- [ ] 💡 [UI] Windows Terminal import in Add Host modal — Priority: L (from UX-03 /adversarial C-01)
- [ ] 💡 [UI] Host group reorder (DnD group separators) — Priority: L (from UX-03 /adversarial C-02)
- [ ] 💡 [UI] ProxyJump auto-check in batch SSH import — Priority: L (from UX-03 /adversarial C-22)
- [ ] 💡 [UI] Banner position 'aboveTabs' option — Priority: L (from UX-07 /adversarial C-01)
- [ ] 💡 [UI] Collapsible banner with shortText — Priority: L (from UX-07 /adversarial C-02)
- [ ] 💡 [UI] Global notification rate limiter across all channels — Priority: L (from UX-05 /adversarial C-20)

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
