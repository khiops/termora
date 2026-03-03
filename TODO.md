# nexterm — Backlog

## In Progress

(none)

## Pending

### MVP — Foundation (M0)
- [ ] [Foundation] Init pnpm monorepo + TypeScript strict + biome + vitest — Priority: H
- [ ] [Foundation] Shared types: all protocol message types + ULID helper — Priority: H
- [ ] [Foundation] MessagePack encode/decode + frame reader/writer — Priority: H
- [ ] [Foundation] Storage layer: meta.db + spool.db schemas, migration runner — Priority: H
- [ ] [Foundation] Dev tooling: `pnpm dev` concurrent, CI GitHub Actions — Priority: H

### MVP — Local Terminal (M1)
- [ ] [Hub] Fastify HTTP server on 127.0.0.1:4100, health endpoint — Priority: H
- [ ] [Agent] Core: stdin/stdout framing, PTY spawn via node-pty, HELLO, SPAWN flow — Priority: H (moved from M2 — agent needed for local sessions)
- [ ] [Agent] Multiplexing: multiple channels per agent — Priority: H (moved from M2)
- [ ] [Hub] Local agent spawn via child_process (--stdio), HELLO handshake — Priority: H
- [ ] [Hub] WS transport: upgrade on /ws, MessagePack frames, INPUT→Agent→PTY→OUTPUT pipeline — Priority: H
- [ ] [UI] Vue 3 + Vite scaffold, 3-column layout shell — Priority: H
- [ ] [UI] xterm.js integration, WS client, fit addon — Priority: H

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

(none)

## Blocked / Deferred

- [ ] ⏸️ [Agent] xterm.js headless feasibility — needs spike to validate DOM polyfill size (before M3)
