# nexterm — Backlog

## Recently Completed

- [x] ✅ [Web] Refactor tab identity — decouple from channelId: Tab.id ULID, activePaneIds tracking, localStorage migration, PaneLayout focus-pane events (2026-03-11)
- [x] ✅ [Web] Fix splitPane no limit — enforce MAX_PANE_COUNT=4 in useLayout.ts (2026-03-11)
- [x] ✅ [Web] Fix split direction inversion — command palette action:split-right/split-down had swapped directions (2026-03-11)

(Archived → docs/historic/done-2026-03.md)

## 🟡 IN PROGRESS: Launch Profiles

**Spec:** docs/plans/launch-profiles.md
**Brief:** docs/briefs/launch-profiles.md

- [x] ✅ Block 1: Data Model + DAL + REST API (shared, hub) (2026-03-12)
- [x] ✅ Block 2: Agent Shell Discovery (agent, hub) (2026-03-12)
- [x] ✅ Block 3: Spawn Resolution + Variable Expansion (shared, hub, agent) (2026-03-12)
- [x] ✅ Block 4: Elevation Support (agent, hub) (2026-03-12)
- [x] ✅ Block 5: Migration Logic (hub) (2026-03-12)
- [x] ✅ Block 6: UI — "+" Dropdown (web) (2026-03-12)
- [x] ✅ Block 7: UI — Settings > Profiles Tab (web) (2026-03-12)
- [ ] Block 8: Command Palette + Keyboard Shortcuts (web)

## Tier 1 — Next Sprint (UX + DX)

- [ ] 💡 [Hub+Web] SSH key path file picker — server-side file browser API (GET /api/files?dir=~/.ssh) — Priority: M
- [ ] 💡 [Hub+Web] Host icon image upload + upload security bundle (MIME magic-byte validation, disk quota, image bomb detection) — same pattern as wallpapers — Priority: M
- [ ] 💡 [Web] Keybindings editor with conflict detection — Priority: M (from UX-09 spec, P2)
- [ ] 💡 [Web] Settings panel search/filter (VS Code style) — Priority: M (from UX-09 spec, P2)
- [ ] 💡 [Web+Hub] Windows Terminal import in Add Host modal — Priority: M (from UX-03 /adversarial C-01)
- [ ] 🔧 [Hub] API route tests for /api/host-groups CRUD + reorder — Priority: M (from /review F-003)

- [ ] 🔧 [Hub] handleAuthPromptResponse: verify responding clientId matches prompt initiator — Priority: L (from /review F-004)
- [ ] 🔧 [Hub] pendingAuthPrompts race condition: guard against concurrent SPAWN for same host — Priority: L (from /review F-005)

## Tier 2 — Quick Wins (batchable)

- [ ] 💡 [Web+Hub] Dead channel display policy as setting (show/hide/auto-purge) with per-host override — Priority: L
- [ ] 💡 [Web] Rail subtitle: middle truncation for hostnames (keep unique part) — Priority: L
- [ ] 💡 [Web+Hub] ProxyJump auto-check in batch SSH import — Priority: L (from UX-03 /adversarial C-22)
- [ ] 💡 [Web] Global notification rate limiter across all channels — Priority: L (from UX-05 /adversarial C-20)
- [ ] 💡 [Web] Banner position 'aboveTabs' option — Priority: L (from UX-07 /adversarial C-01)
- [ ] 💡 [Web] Collapsible banner with shortText — Priority: L (from UX-07 /adversarial C-02)
- [ ] 💡 [Hub] Upload security: apply MIME/quota/image-bomb to wallpapers too (currently extension-only) — Priority: L
- [ ] 💡 [Hub] Color field validation on host-groups API (hex regex or allowlist) — Priority: L (from /review F-004)
- [ ] 🔧 [Hub] Remove dead DAL methods renameHostGroup/deleteHostGroup/listHostGroups (legacy string-based) — Priority: L (from /review F-005)
- [ ] 💡 [Web] Env key warning for dangerous keys (PATH, LD_PRELOAD, LD_LIBRARY_PATH) in profile editor — Priority: L (from /adversarial C-08)
- [ ] 🔧 [Shared] Rename `directProcess` → `mode` in AgentSpawnMessage (breaking change, next protocol version) — Priority: L (from /adversarial C-20)
- [ ] 💡 [Agent] Windows SSH elevation via native helper (`CreateProcessWithLogonW`) — deferred to agent packaging milestone (from /adversarial + /llm)

## Tier 3 — Strategic (milestones)

- [ ] 💡 [Agent] Remote agent daemon via SSH tunnel — PTYs survive SSH drops (NextermAgent.connectTunnel) — Priority: P1
- [ ] 💡 [UI] Desktop packaging (Tauri v2 or alternative) — Priority: P1 (see docs/plans/packaging-strategy.md)
- [ ] 💡 [Hub] Search in scrollback (FTS5 full-text index + search UI) — Priority: P1
- [ ] 💡 [Hub] OS keychain for auth token (keytar) — Priority: P1

## Tier 4 — Deferred (revisit in 3 months)

- [ ] 💡 [UI] Settings sync across devices — Priority: P2 (single-user MVP)
- [ ] 💡 [UI] Settings export/import as JSON — Priority: P2
- [ ] 💡 [Hub] WebSocket events for config changes (reactive settings across clients) — Priority: P2 (single-user MVP)
- [ ] 💡 [Hub] Workspace export/import with blobs — Priority: P2
- [ ] 💡 [Hub] SQLCipher encryption at rest — Priority: P2
- [ ] 💡 [Hub] OIDC / mTLS — Priority: P2
- [ ] 💡 [Agent] Auto-install agent binary — Priority: P2 (depends on packaging decision)
- [ ] 💡 [Hub] Multi-writer collaboration (CRDT) — Priority: P2
- [ ] 💡 [Agent] Peer UID verification via SO_PEERCRED on Unix socket — Priority: P2 (needs native addon; 0700 dir perms sufficient)
- [ ] 💡 [Agent] Windows named pipe ACL hardening (restrict to current user) — Priority: P2 (needs native FFI/WinAPI)

## Completed

(Archived → docs/historic/done-2026-03.md)
