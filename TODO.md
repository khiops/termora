# nexterm — Backlog

## In Progress

### UI/UX Sprint — Briefs Complete (docs/briefs/)
- [ ] 🟡 [UI] UX-06: Theming & Color Schemes (Sprint 1 — foundation)
- [ ] 💡 [UI] UX-01: Tab Actions, Split Panes, Welcome Tab (Sprint 1)
- [ ] 💡 [UI] UX-02: Terminal Title — OSC 0/2 (Sprint 1)
- [ ] 💡 [UI] UX-04: Scrollback Search (Sprint 1)
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
