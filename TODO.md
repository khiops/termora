# nexterm — Backlog

## In Progress

## Recently Completed

## Pending

### Review Findings
- [ ] 🐛 [UI] Fix pre-existing typecheck failure in useCommandPalette.spec.ts (hostId on Channel type) — Priority: S (from /review F-003)
- [ ] 🔧 [Agent] EADDRINUSE randomized backoff on daemon spawn — Priority: M (from /review F-003)
- [ ] 🔧 [Hub] waitForChannelState() listener cleanup on timeout — Priority: S (from /review F-004)
- [ ] 🔧 [Hub] DRY: extract shared daemon attach logic from _reconnectDaemon/_connectDaemonAgent — Priority: S (from /review F-005)
- [ ] 🔧 [Shared] Add EACCES test for probeSocket() — Priority: S (from /review F-006)
- [ ] 🔧 [Hub] Add waitForSocket() timeout test — Priority: S (from /review F-007)
- [ ] 🔧 [Agent] Add stat() assertion for 0700 socket dir permissions — Priority: S (from /review F-009)

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
