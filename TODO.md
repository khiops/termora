# nexterm — Backlog

## In Progress

- [ ] 🐛 [Hub/UI] No DELETE /api/channels/:id endpoint — channels cannot be permanently killed from UI. Close tab only detaches, doesn't KILL PTY. Warm restart respawns all non-dead channels. — Priority: M (from host-dot-dead-tab investigation)

## Pending

### Review Findings
- [ ] 🔧 [Hub] Migrate handleSpawn to pendingRequests dispatcher (architectural consistency with warm restart path) — Priority: M (from /review F-001)
- [ ] 🐛 [UI] Fix pre-existing typecheck failure in useCommandPalette.spec.ts (hostId on Channel type) — Priority: S (from /review F-003)

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
