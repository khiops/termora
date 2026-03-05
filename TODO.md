# nexterm — Backlog

## In Progress

(None — MVP complete)

## Pending

### Review Backlog (Warm Restart)
- [ ] 🔧 [Hub] DRY: extract shared SPAWN-sending loop from _warmRestartLocal and _reAttachChannels — Priority: M (F-001)
- [ ] 🔧 [Docs] Update PROTOCOL.md §3.2 and §4.4 with new optional channelId/cols/rows fields — Priority: S (F-002)
- [x] ✅ [Hub] DRY: extract _computeSnapshotSeq helper from handleAttach + _wireAgentEvents — Priority: S (F-003) (2026-03-05)
- [ ] 🔧 [UI] DRY: extract purgeDeadTabs helper in App.vue — Priority: S (F-004)
- [ ] 🔧 [Hub] Add crash-loop limit test (4th restart within 60s triggers _closeSession) — Priority: S (F-005)
- [ ] 🔧 [Hub] Store last-known cols/rows in meta.db for warm restart (instead of hardcoded 80x24) — Priority: S (F-006)
- [ ] 🔧 [UI] WS_RECONNECT: use separate event channel instead of ProtocolMessage cast — Priority: S (F-007)

### Review Backlog (Channel Names)
- [ ] 🔧 [UI] DRY: extract useRename composable from ChannelItem + TabBar — Priority: M (F-004)
- [ ] 🔧 [UI] Decouple getTabLabel from useChannelsStore in useLayout — Priority: S (F-005)

### Review Backlog (M5)
- [ ] 🔧 [UI] Add unit tests for composables (useLayout, useCommandPalette, useHostIcon) — Priority: M (F-005)

### Review Backlog (M4)
- [ ] 🔧 [Docs] Update STORAGE.md pairing_codes schema to match implementation — Priority: S (F-003)
- [ ] 🔧 [UI] PairingCodeGenerator: parse expires_at from response instead of hardcoded 60 — Priority: S (F-004)
- [ ] 🔧 [Hub] Pairing code collision: add retry loop — Priority: S (F-005)
- [ ] 🔧 [Hub] ATTACH_OK: populate writeLockHolder from WriteLockManager — Priority: S (F-006)
- [ ] 🔧 [UI] writelock store: wire setInitialHolder or remove dead code — Priority: S (F-007)
- [ ] 🔧 [Hub] Auth hook: use pathname parsing for URL matching — Priority: S (F-008)

### Review Backlog (M3)
- [ ] 🔧 [Hub] GC: add max-size-per-channel + dead-channel cleanup (steps 2+3) — Priority: M (F-002)
- [ ] 🔧 [Hub] DRY handleAttach: extract shared snapshot+tail logic — Priority: S (F-003)
- [ ] 🔧 [Hub] SnapshotScheduler: add max concurrent snapshots guard — Priority: S (F-004)
- [ ] 🔧 [Hub] OutputChunker: validate seq monotonicity in tests — Priority: S (F-005)
- [ ] 🔧 [Hub] ATTACH: add channelId ULID validation — Priority: S (F-007)
- [ ] 🔧 [Hub] SnapshotScheduler+OutputChunker: add edge case tests — Priority: S (F-008/F-009)

### Review Backlog (M1)
- [ ] 🔧 [Hub] Session reuse: reuse sessionId for same host instead of new per SPAWN — Priority: M (F-001)
- [ ] 🔧 [Hub] SPAWN: pass UI cols/rows to agent instead of hardcoded 80x24 — Priority: S (F-002)
- [ ] 🔧 [Hub] WS handler: log malformed MessagePack messages — Priority: S (F-004)
- [ ] 🔧 [Hub] WS input validation: channelId ULID, cols/rows range, data size, env count — Priority: M (F-009)
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
