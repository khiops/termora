# nexterm — Backlog

## In Progress

- [x] ✅ [Local Terminal] M1 — Complete (2026-03-03) — 131 tests, reviewed, findings fixed

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
- [ ] [Hub] SSH connector via ssh2, launch nexterm-agent --stdio — Priority: H
- [ ] [Hub] Session manager: state machine, DB persistence — Priority: H
- [ ] [Hub] REST API: /hosts CRUD, /sessions, /hosts/:id/test — Priority: H

### MVP — Session Persistence (M3)
- [ ] [Agent] xterm.js headless + DOM polyfill (SPIKE first) — Priority: H
- [ ] [Hub] Snapshot scheduler: idle 3s / forced 5s / on-detach — Priority: H
- [ ] [Hub] Output chunking (256KB/1s) + spool writes + GC — Priority: H
- [ ] [Hub] ATTACH with snapshot restore + tail replay — Priority: H
- [ ] [Hub] SSH reconnect: retry backoff, re-HELLO, re-ATTACH — Priority: H

### MVP — Multi-Client (M4)
- [ ] [Hub] Token auth: generate auth.json, Bearer header, WS AUTH — Priority: H
- [ ] [Hub] Pairing flow: POST /pair + /pair/verify, rate limiting — Priority: H
- [ ] [Hub] Write-lock 3-tier: claim/grant/deny/force/release/revoked — Priority: H
- [ ] [UI] Multi-client UX: write-lock indicators, lock transfer UI — Priority: H

### MVP — Polish (M5)
- [ ] [UI] Host rail: auto-icons, color hash, status dots — Priority: H
- [ ] [UI] Channel sidebar: groups, drag reorder, unread indicators — Priority: H
- [ ] [UI] Tabs + split panes + workspace layout persistence — Priority: H
- [ ] [UI] Command palette (Ctrl+P): fuzzy search hosts/channels/actions — Priority: M
- [ ] [Hub] Config cascade: 4-layer deep merge + settings API — Priority: H
- [ ] [Hub] CLI: start/stop, host add/list/test, pair, session list — Priority: H
- [ ] [Root] Onboarding + npx nexterm packaging — Priority: H

### Review Backlog (M1)
- [ ] 🔧 [Hub] Session reuse: reuse sessionId for same host instead of new per SPAWN — Priority: M (F-001, fix in M2)
- [ ] 🔧 [Hub] SPAWN: pass UI cols/rows to agent instead of hardcoded 80x24 — Priority: S (F-002, fix in M2)
- [ ] 🔧 [Hub] WS handler: log malformed MessagePack messages — Priority: S (F-004, fix in M2)
- [ ] 🔧 [Hub] WS input validation: channelId ULID, cols/rows range, data size, env count — Priority: M (F-009, fix before M4)
- [ ] 🔧 [UI] TerminalPane: cleanup old channel on remount — Priority: S (F-008, fix in M5)

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

## Blocked / Deferred

- [ ] ⏸️ [Agent] xterm.js headless feasibility — needs spike to validate DOM polyfill size (before M3)
