# Architecture Decisions

Decisions archived from workflow — newest first.

---

## UX-02 — Terminal Title / OSC 0/2 (2026-03-07)

- Dual approach: UI parses OSC locally for instant display (INV-04), agent sends TITLE_CHANGE to hub for DB persistence (INV-05)
- sanitizeTitle in shared/src/sanitize.ts: strips HTML tags (/<[^>]*>/g), strips C0/C1 control chars, trims, truncates to 256 — defense-in-depth (both agent and UI sanitize)
- Tag content preserved during HTML strip (e.g., `<script>alert(1)</script>vim` → `alert(1)vim`) — safe because Vue renders via .textContent, not innerHTML
- Agent debounce: per-channel 100ms last-write-wins timer for TITLE_CHANGE emission (INV-07)
- Hub debounce: per-channel 100ms last-write-wins timer for dynamic_title DB writes (INV-08), but broadcasts to UI immediately
- Empty OSC title suppressed (not sent as TITLE_CHANGE) per INV-09
- Migration 005-dynamic-title.sql: ALTER TABLE channels ADD COLUMN dynamic_title TEXT DEFAULT NULL
- dynamicTitle added to Channel entity + UiAttachOkMessage for reconnect recovery (SC-02)
- HeadlessTerminal.onTitleChange exposed for agent subscription, PtyManager.onTitleChange(channelId, cb)
- useTabTitle composable: INV-01 priority chain — custom > live dynamic > stored dynamic > fallback
- Title stack in useTerminal: max 5 entries, empty titles skipped, top of stack = currentDynamicTitle (SC-05)
- resolveTabLabel updated to accept dynamicTitle in channel objects
- TITLE_CHANGE WS handler in session store routes to channelsStore.setDynamicTitle
- ChannelItem shows dynamicTitle without prefix (SC-15)
- truncateTitle: 3 positions (end/middle/start), U+2026 ellipsis, default maxLength 50
- useWindowTitle: formatWindowTitle with {prefix},{host},{title},{channel},{shell} tokens, trailing/leading separator trimming, debounced 100ms
- TitleConfig interface: source, fallback, fallbackCustom, maxLength, truncation, prefix, windowTitle, windowFormat
- Hub [title] section parser with DEFAULT_TITLE_CONFIG, exposed via UiConfig
- resolvedTitle exposed from useTabTitle for window title composition (raw, no prefix/truncation)
- Prefix prepended BEFORE truncation (counts toward char limit), sidebar excluded from prefix
- Reset Title to Dynamic: clears channel.title via PATCH null, TabContextMenu enabled when isCustom
- clearTitle action in channels store wraps renameChannel(id, null)
- TitleConfig.source='static' disables dynamic titles, TitleConfig.fallback controls fallback strategy (channel/shell/custom)

---

## UX-01 — Tab Actions, Split Panes & Welcome Tab (2026-03-07)

- TabContextMenu: Teleport to body, click-outside listener, fixed positioning from event coords
- Close actions (closeOthers/closeToRight/closeAll): vacate panes in other tabs, tabs stay open (never removed)
- vacateAllPanesInTab: walks layout tree, replaces all terminal nodes with vacant
- closeAll accepts optional exceptWelcomeId for welcome tab protection (INV-06)
- Vacant nodes carry unique id (generateId()) to distinguish multiple vacant slots in same tree
- vacatePane replaces terminal node in-place with vacant (preserving split structure)
- rearrangeVacant collapses parent split; does nothing if root vacant (INV-04: tab never auto-closes)
- onClosePane no longer kills terminals — INV-03 compliance (detach, never kill)
- countPanes exported as standalone function for max-4-pane enforcement (INV-02)
- Welcome tab: per-host, enforced via transaction (clears previous before setting new), migration 003
- Star icon: Unicode ★ with --nt-accent color in both TabBar and ChannelItem
- Cross-tab DnD: vacate-first strategy prevents duplicate channelId in same-tab moves
- DnD: paneId-based targeting for precise node replacement in tree, header as drag handle
- DnD: 5 drop zones (left/right 25%, top/bottom 25%, center 50%)
- Configure Command: migration 004 (icon, args, direct_process columns added to channels)
- SPAWN message extended with args/directProcess; agent PtyManager honors in pty.spawn
- POST /api/channels/:id/restart: kills + re-spawns with saved config
- Exit overlay for directProcess channels: Restart / Configure Command / Close buttons
- Channel sidebar: context menu inline in ChannelItem (no separate component — reduces indirection)
- Open in Current Tab: uses replaceChannelId to swap active tab content
- ConfirmDialog: generic reusable component with "Remember for host" / "Remember globally" checkboxes
- Remember preferences: localStorage nexterm:skipConfirm* keys with explicit actionKey (not title parsing)
- Config sections: [tabs] [panes] [channels] [startup] in config.toml
- Config defaults: confirmCloseAll=true, confirmCloseOthers=true, maxPanes=4, autoOpenWelcome=true
- Welcome endpoint cross-host check: verifies channel.hostId matches path param host ID

---

## UX-06 — Theming & Color Schemes (2026-03-07)

- CSS custom properties as single source of truth for all chrome colors (--nt-* prefix, 48+ vars in 3 tiers)
- Theme files on disk (~/.config/nexterm/themes/), not DB — portable, git-friendly
- 9 bundled presets (6 dark, 3 light), default catppuccin-mocha, copy-if-missing strategy
- AppearanceConfig = global only; theme NAME = per-host via TerminalProfile cascade
- AppearanceConfig persisted in appearance.json (not config.toml) — simpler read/write
- Theme name validation: /^[a-z0-9-]+$/ with path traversal prevention in get/delete
- NexTermTheme = colors (22 terminal) + ui (15 chrome), validateTheme returns {valid, errors[]}
- BUNDLED_THEMES as Record<string, NexTermTheme> in shared/themes/index.ts
- ThemeManager uses fs/promises (async), ThemeError for structured errors
- Terminal theme propagation via callback Set in theme store — toXtermTheme() + onTerminalThemeChange()
- Per-host theme override: useTerminal checks profile.theme, resolves from availableThemes (SC-03)
- Live preview hover debounced via requestAnimationFrame (INV-08)
- setTheme() disables autoSwitch when enabled (SC-14)
- AppearancePanel as Teleported right-side slide-out panel (480px) with overlay backdrop
- ThemeEditor: deep watcher on draft colors with rAF debounce for live preview
- useAutoSwitch composable with matchMedia listener, onScopeDispose cleanup
- Opacity via --nt-*-alpha CSS vars + rgba(var(--nt-*-rgb), var(--nt-*-alpha)) pattern
- Scrollbar: --nt-scrollbar-width CSS var, style thin/wide/hidden
- deepMerge generic constraint relaxed to T extends object (was Record<string,unknown>)

---

## AGENT-DAEMON — Standalone agent daemon with UDS/named pipe transport (2026-03-06)

- Node.js net module for cross-platform socket transport (UDS + named pipes, same API)
- Socket path per-user: $XDG_RUNTIME_DIR/nexterm/agent.sock (Linux) / \\.\pipe\nexterm-agent-<username> (Windows)
- Socket probing for agent discovery (net.connect then close) — no PID file for liveness
- Hub auto-starts agent as detached process (spawn + unref) if socket not found
- --daemon (new, socket) / --stdio (unchanged, kept for SshAgent until Phase 2)
- Same MessagePack framing over socket as over stdio — only transport layer changes
- AGENT_CHANNEL_STATE + CHANNEL_STATE_END messages for reconnect reconciliation
- Output buffering: configurable per-channel cap (1MB default) + global cap (20MB default), ring buffer
- NextermAgent: single concrete class replacing AgentConnection abstract, constructor(Duplex), factory methods
- LocalAgent + SshAgent untouched — used until Phase 2 replaces SshAgent with SSH tunnel + NextermAgent
- Last-connection-wins: new hub connection displaces previous
- Warm restart (agent died) vs reconnect (hub died) — distinct documented flows
- Agent daemon logs to <stateDir>/agent.log when detached
- EACCES on probe: don't unlink, throw (different user's socket)
- [agent] section in config.toml for buffer caps, socket_path override, log_level
- Tests use real UDS in temp dirs, NOT stdio mocks
- Phase 2 = remote agent daemon via SSH tunnel (NextermAgent.connectTunnel) — separate story

---

## channel-delete-flow — DELETE endpoint + dead channel UI + tab scroll (2026-03-06)

- DELETE /api/channels/:id: sends DESTROY to agent, marks dead in DB, broadcasts CHANNEL_STATE
- SessionManager.destroyChannel(): centralizes PTY kill + scheduler/chunker untrack + channel map cleanup
- UI removeChannel: calls DELETE API, marks dead + nextTick (for watcher to close tab), then filters
- WriteLockIndicator isDead prop: hides Force Take / Request Write on dead AND orphan channels
- Tab bar horizontal scroll: visible thin scrollbar, mouse wheel→horizontal, auto-scroll to active tab on selection

---

## host-dot-dead-tab — Fix host status dot + configurable dead channel tab behavior (2026-03-06)

- New [ui] section in config.toml for UI behavioral config (separate from terminal profile)
- on_channel_dead: 'close' (default) | 'readonly' — configurable tab behavior
- GET /api/config/ui endpoint to expose UI config to frontend
- addClient sends initial SESSION_STATE for all active sessions
- sessionStatusToHostStatus: 'detached' maps to 'live' (green) — agent running = host reachable
- listChannels() excludes dead channels (WHERE status != 'dead') — dead channels are internal bookkeeping

---

## s-backlog-sweep — Fix all S-priority review backlog items (2026-03-05)

- DEFAULT_CHANNEL_NAME constant in shared/constants.ts replaces all hardcoded "Terminal"
- purgeDeadTabs and resolveTabLabel as pure functions in useLayout (DI, no store dependency)
- WS_RECONNECT refactored to dedicated onReconnect/onDisconnect lifecycle events on WsClient
- Auth hook uses URL pathname parsing for exact path matching
- Pairing code retry loop (5 attempts) with SQLite UNIQUE constraint catch
- cols/rows stored in meta.db channels table, passed through SPAWN and warm restart
- SnapshotScheduler max 4 concurrent snapshots with inFlight counter
- _spawnChannelsForHost 10s per-channel SPAWN timeout

---

## m-backlog-sweep — Fix all M-priority review backlog items (2026-03-05)

- GC dead_retention_hours and max_size_per_channel_mb configurable via config.toml [gc] section
- SendQueue extracted to shared class with pending/isDraining/frames getters
- Session reuse already implemented — backlog item was obsolete
- WS input validation in shared/validation.ts (ULID, dimensions, data size, env)
- useRename composable with onCommit callback pattern

---

## editable-channel-names — Editable channel names + backpressure + font fix (2026-03-05)

- channels.title column already exists in DB (nullable) — leverage existing schema
- Default channel name: "Terminal" (simplified from Shell #N counting approach)
- PATCH /api/channels/:id for rename with 1-128 char validation
- Optimistic UI update with rollback on PATCH failure
- Double-click to rename in both sidebar ChannelItem and TabBar
- v-show keep-alive for tabs: prevents terminal replay/destruction on tab switch
- Backpressure across agent→hub pipeline: pause/drain in agent, send queues in LocalAgent/SshAgent
- Font watcher race fix: removed ready.value guard, apply profile unconditionally

---

## [backfill] Channel lifecycle & session persistence (2026-03-04)

- On hub restart: mark all channels dead + sessions closed via startup sweep (markAllChannelsDead)
- ATTACH protocol: TerminalPane sends ATTACH → hub replies ATTACH_OK with snapshot + tail → xterm restore
- Three ATTACH cases: new channel (empty), orphan with live agent (fresh snapshot), orphan with dead agent (cached from spool.db)
- Warm restart: respawn agent with same channel IDs to restore content (optional channelId in SPAWN message)
- CHANNEL_DEAD error code distinguishes "never existed" from "stale after restart"
- CHANNEL_STATE listener moved from App.vue watch to SessionStore.connect() — fixes race condition
- Terminal RESIZE deduplication: track lastSentCols/Rows, debounce 50ms, skip if unchanged
- canWrite ref in useTerminal: default true (single-client), set false until auth confirms ownership

---

## [backfill] Custom fonts & config cascade wiring (2026-03-04)

- Cross-platform font stack: Consolas → Liberation Mono → Courier New → monospace (no embedding, licensing)
- User fonts: drop .woff2/.woff/.ttf/.otf in ~/.config/nexterm/fonts/, auto-discovered
- Font serving: second @fastify/static at /public/fonts/ (decorateReply: false for multi-static)
- Font filename heuristic: family slug from first segment, camelCase→spaces, suffixes→weight (Regular=400, Bold=700)
- GET /api/fonts unauthenticated (font list is non-sensitive metadata)
- Dynamic @font-face injection: <style> element appended to <head> at startup
- Config load bug: ConfigResolver.loadFromFile() was never called — instantiated but not invoked
- Config store: Pinia useConfigStore.load() fetches /api/fonts + /api/config/resolved in parallel
- Profile propagation: useTerminal(containerRef, wsClient, profile?) — optional param, defaults to DEFAULT_PROFILE

---

## MVP-NEXTERM — Implement full nexterm MVP (2026-03-03)

- Plan-provided mode: specs in docs/
- Continuous mode: no pauses between stages
- Model routing: Sonnet implements, Opus reviews, Haiku tests
- HostRail: djb2 hash → HSL palette, 48px column
- ChannelSidebar: groups in localStorage, drag not needed for MVP
- PaneLayout: recursive split tree, localStorage persistence
- CommandPalette: module-level singleton, fuzzy includes match
- ConfigResolver: 4-layer deep merge, null removes key, arrays replace
- CLI: manual argv parser (no yargs/commander), dynamic imports for heavy deps
- Onboarding: auto-create local host, openBrowser via execFile
- Token auth: 32-byte hex, timingSafeEqual, chmod 600 auth.json
- Pairing: 6-digit code (padStart), 60s expiry, max 3 active
- Write-lock: 3-tier (auto-claim, request/grant, force), first-attach=writer
- WriteLockManager: standalone class with DI callbacks
- @xterm/headless CJS: default import + destructure
- Auth hook skips /health and /pair/verify

---

## [backfill] Foundational architecture — Stack & design decisions (2026-03-03)

- HTTP server: Fastify (perf + TS-first + plugin ecosystem)
- Database: SQLite via better-sqlite3 with WAL mode — meta.db (state) + spool.db (output chunks/snapshots)
- PTY: node-pty for local spawn, agent-only PTY control (hub never touches PTY directly)
- SSH: ssh2 library, agent launched via `nexterm-agent --stdio` over SSH
- WebSocket codec: MessagePack binary serialization (snake_case on wire, camelCase in TS)
- UI: Vue 3 + Vite SPA with Pinia state management
- Terminal: xterm.js (browser rendering) + @xterm/headless (snapshot capture without DOM)
- IDs: ULID everywhere (sortable, monotonic, better DB indexing than UUID)
- Monorepo: pnpm workspaces — packages: agent, hub, web, shared, cli
- Protocol: unified protocol.ts — single source of truth for all message schemas (HELLO, SPAWN, ATTACH, AUTH, SNAPSHOT, LOCK...)
- Entity model: Host (permanent) → Session (runtime) → Channel (PTY instance)
- Session state machine: STARTING → ACTIVE → DISCONNECTED → CLOSED, persisted in meta.db
- Architecture: local-first hub daemon, agents spawned as children (local) or via SSH (remote)
- REST API: all routes under /api/ prefix, WebSocket at /ws (no /api)
- Default port: 4100 with zero-conf auto-increment fallback
- Snapshot: event-driven scheduler → chunks in spool.db with cache_index, GC preserves last per channel
- Formatting: biome with tabs
- Tests: vitest, colocated *.spec.ts
