# nexterm — Backlog

## In Progress

- [x] ✅ [Local Terminal] M1 — Complete (2026-03-03) — 131 tests, reviewed
- [x] ✅ [Remote Terminal] M2 — Complete (2026-03-04) — 190 tests, reviewed
- [x] ✅ [Session Persistence] M3 — Complete (2026-03-04) — 244 tests, reviewed
- [x] ✅ [Multi-Client] M4 — Complete (2026-03-04) — 306 tests, reviewed

## Pending

### MVP — Foundation (M0)
- [x] ✅ [Foundation] Init pnpm monorepo + TypeScript strict + biome + vitest (2026-03-03)
- [x] ✅ [Foundation] Shared types: all protocol message types + ULID helper (2026-03-03)
- [x] ✅ [Foundation] MessagePack encode/decode + frame reader/writer (2026-03-03)
- [x] ✅ [Foundation] Storage layer: meta.db + spool.db schemas, migration runner (2026-03-03)
- [x] ✅ [Foundation] Dev tooling: `pnpm dev` concurrent, CI GitHub Actions (2026-03-03)

### MVP — Local Terminal (M1)
- [x] ✅ [Hub] Fastify HTTP server on 127.0.0.1:4100, health endpoint (2026-03-03)
- [x] ✅ [Agent] Core: stdin/stdout framing, PTY spawn via node-pty, HELLO, SPAWN flow (2026-03-03)
- [x] ✅ [Agent] Multiplexing: multiple channels per agent (2026-03-03)
- [x] ✅ [Hub] Local agent spawn via child_process (--stdio), HELLO handshake (2026-03-03)
- [x] ✅ [Hub] WS transport: upgrade on /ws, MessagePack frames, INPUT→Agent→PTY→OUTPUT pipeline (2026-03-03)
- [x] ✅ [UI] Vue 3 + Vite scaffold, 3-column layout shell (2026-03-03)
- [x] ✅ [UI] xterm.js integration, WS client, fit addon (2026-03-03)

### MVP — Remote Terminal (M2)
- [x] ✅ [Hub] SSH connector via ssh2, launch nexterm-agent --stdio (2026-03-04)
- [x] ✅ [Hub] Session manager: state machine, DB persistence (2026-03-04)
- [x] ✅ [Hub] REST API: /hosts CRUD, /sessions, /hosts/:id/test (2026-03-04)

### MVP — Session Persistence (M3)
- [x] ✅ [Agent] xterm.js headless — no polyfill needed, serialize ~67ms (2026-03-04)
- [x] ✅ [Hub] Snapshot scheduler: idle 3s / forced 5s / on-detach (2026-03-04)
- [x] ✅ [Hub] Output chunking (256KB/1s) + spool writes + GC (2026-03-04)
- [x] ✅ [Hub] ATTACH with snapshot restore + tail replay (2026-03-04)
- [x] ✅ [Hub] SSH reconnect: retry backoff, re-HELLO, re-ATTACH (done in M2, verified)

### MVP — Multi-Client (M4)
- [x] ✅ [Hub] Token auth: generate auth.json, Bearer header, WS AUTH (2026-03-04)
- [x] ✅ [Hub] Pairing flow: POST /pair + /pair/verify, rate limiting (2026-03-04)
- [x] ✅ [Hub] Write-lock 3-tier: claim/grant/deny/force/release/revoked (2026-03-04)
- [x] ✅ [UI] Multi-client UX: write-lock indicators, lock transfer UI (2026-03-04)

### MVP — Polish (M5)
- [ ] [UI] Host rail: auto-icons, color hash, status dots — Priority: H
- [ ] [UI] Channel sidebar: groups, drag reorder, unread indicators — Priority: H
- [ ] [UI] Tabs + split panes + workspace layout persistence — Priority: H
- [ ] [UI] Command palette (Ctrl+P): fuzzy search hosts/channels/actions — Priority: M
- [ ] [Hub] Config cascade: 4-layer deep merge + settings API — Priority: H
- [ ] [Hub] CLI: start/stop, host add/list/test, pair, session list — Priority: H
- [ ] [Root] Onboarding + npx nexterm packaging — Priority: H

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
- [ ] 🔧 [Hub] Session reuse: reuse sessionId for same host instead of new per SPAWN — Priority: M (F-001, fix in M2)
- [ ] 🔧 [Hub] SPAWN: pass UI cols/rows to agent instead of hardcoded 80x24 — Priority: S (F-002, fix in M2)
- [ ] 🔧 [Hub] WS handler: log malformed MessagePack messages — Priority: S (F-004, fix in M2)
- [ ] 🔧 [Hub] WS input validation: channelId ULID, cols/rows range, data size, env count — Priority: M (F-009, fix before M4)
- [ ] 🔧 [UI] TerminalPane: cleanup old channel on remount — Priority: S (F-008, fix in M5)
- [ ] 🔧 [UI] Reconnecting overlay on SESSION_STATE disconnected — Priority: S (M3 cosmetic, fix in M5)

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

- [x] ✅ [Foundation] M0 — Foundation: monorepo, shared types, storage, dev tooling (2026-03-03)
- [x] ✅ [Local Terminal] M1 — Hub HTTP, agent core+mux, local spawn, WS transport, Vue+xterm (2026-03-03)
- [x] ✅ [Remote Terminal] M2 — SSH connector, session SM, REST API, review fixes (2026-03-04)
- [x] ✅ [Session Persistence] M3 — Headless xterm, snapshots, chunking, ATTACH restore, GC (2026-03-04)
- [x] ✅ [Multi-Client] M4 — Token auth, pairing, write-lock 3-tier, multi-client UX (2026-03-04)

## Blocked / Deferred

- [x] ⏭️ [Agent] xterm.js headless feasibility — RESOLVED: @xterm/headless works natively, no polyfill needed
