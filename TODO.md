# nexterm — Backlog

## In Progress

(None — MVP complete)

## Pending

### Review Backlog (Warm Restart)
- [ ] 🔧 [Docs] Update PROTOCOL.md §3.2 and §4.4 with new optional channelId/cols/rows fields — Priority: S (F-002)
- [ ] 🔧 [UI] DRY: extract purgeDeadTabs helper in App.vue — Priority: S (F-004)
- [ ] 🔧 [Hub] Add crash-loop limit test (4th restart within 60s triggers _closeSession) — Priority: S (F-005)
- [ ] 🔧 [Hub] Store last-known cols/rows in meta.db for warm restart (instead of hardcoded 80x24) — Priority: S (F-006)
- [ ] 🔧 [UI] WS_RECONNECT: use separate event channel instead of ProtocolMessage cast — Priority: S (F-007)

### Review Backlog (Channel Names)
- [ ] 🔧 [UI] Decouple getTabLabel from useChannelsStore in useLayout — Priority: S (F-005)
- [ ] 🔧 [UI] DRY: extract "Terminal" fallback constant to @nexterm/shared — Priority: S (F-003)
- [ ] 🔧 [Hub] PATCH /api/channels/:id: add explicit missing-field check or Fastify JSON schema — Priority: S (F-006)
- [ ] 🔧 [Hub] PATCH tests: add missing-field and non-string type test cases — Priority: S (F-007/F-008)

### Review Backlog (M4)
- [ ] 🔧 [Docs] Update STORAGE.md pairing_codes schema to match implementation — Priority: S (F-003)
- [ ] 🔧 [UI] PairingCodeGenerator: parse expires_at from response instead of hardcoded 60 — Priority: S (F-004)
- [ ] 🔧 [Hub] Pairing code collision: add retry loop — Priority: S (F-005)
- [ ] 🔧 [Hub] Auth hook: use pathname parsing for URL matching — Priority: S (F-008)

### Review Backlog (M3)
- [ ] 🔧 [Hub] DRY handleAttach: extract shared snapshot+tail logic — Priority: S (F-003)
- [ ] 🔧 [Hub] SnapshotScheduler: add max concurrent snapshots guard — Priority: S (F-004)
- [ ] 🔧 [Hub] OutputChunker: validate seq monotonicity in tests — Priority: S (F-005)
- [ ] 🔧 [Hub] SnapshotScheduler+OutputChunker: add edge case tests — Priority: S (F-008/F-009)

### Review Backlog (M-Backlog Sweep)
- [ ] 🔧 [Hub] _spawnChannelsForHost: add per-channel SPAWN timeout to prevent listener leak — Priority: S (from /review F-003)
- [ ] 🔧 [Shared] isValidEnv: document or test __proto__/constructor keys — Priority: S (from /review F-006)
- [ ] 🔧 [Hub] spool-gc.spec.ts: add combined Phase 2+3 integration test — Priority: S (from /review F-007)

### Review Backlog (M1)
- [ ] 🔧 [Hub] SPAWN: pass UI cols/rows to agent instead of hardcoded 80x24 — Priority: S (F-002)
- [ ] 🔧 [Hub] WS handler: log malformed MessagePack messages — Priority: S (F-004)
- [ ] 🔧 [UI] TerminalPane: cleanup old channel on remount — Priority: S (F-008)
- [ ] 🔧 [UI] Reconnecting overlay on SESSION_STATE disconnected — Priority: S

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
