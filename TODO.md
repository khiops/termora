# nexterm — Backlog

## Tier 1 — Next Sprint (UX + DX)

- [x] ✅ [Hub+Web] Dead channel purge — DELETE /api/channels/:id purges dead channels, POST /api/channels/purge-dead bulk purge, ChannelItem "Delete" context menu, ChannelSidebar "Clear" header btn (2026-03-09)
- [x] ✅ [Web] Fix: stale tabs persist after hub/agent restart — purgeOrphanedTabs in useLayout (2026-03-09)
- [x] ✅ [Hub+Web] Fix: dead channels hidden from sidebar + stale write-lock label after restart (2026-03-09)
- [x] ✅ [Web] Fix: closeAll/closeOthers/closeToRight remove tabs instead of vacating panes (2026-03-09)

- [ ] 💡 [Hub+Web] SSH key path file picker — server-side file browser API (GET /api/files?dir=~/.ssh) — Priority: M
- [ ] 💡 [Hub+Web] Host icon image upload + upload security bundle (MIME magic-byte validation, disk quota, image bomb detection) — same pattern as wallpapers — Priority: M
- [ ] 💡 [Web] Keybindings editor with conflict detection — Priority: M (from UX-09 spec, P2)
- [ ] 💡 [Web] Settings panel search/filter (VS Code style) — Priority: M (from UX-09 spec, P2)
- [ ] 💡 [Web+Hub] Windows Terminal import in Add Host modal — Priority: M (from UX-03 /adversarial C-01)
- [ ] 🔧 [Hub] API route tests for /api/host-groups CRUD + reorder — Priority: M (from /review F-003)

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
- [x] ✅ [Web] Replace window.prompt for group creation with GroupActionDialog + add channel group context menu (2026-03-09)

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
