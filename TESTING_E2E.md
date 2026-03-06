# E2E Testing Checklist

Manual E2E tests run via Chrome DevTools (MCP) against `pnpm dev`.
Run these after any change to channel/tab/sidebar/write-lock logic.

## Prerequisites

- `pnpm dev` running (hub + web)
- Chrome DevTools MCP connected to `http://localhost:5173/`
- Start from a clean state (1 host "local", 0 or 1 channel)

---

## 1. Channel creation

- [ ] Click "+" in tab bar → new tab opens with prompt, Writer indicator, green sidebar dot
- [ ] Click "+" in sidebar header → same result
- [ ] Sidebar count increments (GENERAL: N)

## 2. Tab switching

- [ ] Click tab 1 → switches to tab 1, sidebar highlights matching channel
- [ ] Click tab 2 → switches to tab 2, sidebar highlights matching channel
- [ ] Click channel in sidebar → switches to its tab

## 3. Sidebar re-selection

- [ ] Click an already-selected channel → tab stays open (no blank state)
- [ ] Close a tab via "x" button → click the channel in sidebar → tab re-opens

## 4. Shell exit (dead channel — readonly mode)

- [ ] Type `exit` in terminal → "Closed" badge appears, tab stays open (readonly)
- [ ] Sidebar dot turns grey
- [ ] Write-lock indicator (Writer/Release) hidden on dead tab
- [ ] Other channel tabs remain unaffected
- [ ] Can still scroll and select text in dead tab (copy-paste)

## 5. Explicit channel deletion (context menu)

- [ ] Right-click dead channel in sidebar → "Close channel" → tab closes immediately
- [ ] Right-click live channel in sidebar → "Close channel" → tab closes immediately
- [ ] Sidebar count decrements
- [ ] Remaining tabs/channels unaffected
- [ ] No "Starting..." ghost tab appears

## 6. Delete fallback selection

- [ ] Delete the currently selected channel → selection falls back to next alive channel
- [ ] Fallback channel's tab opens/focuses automatically
- [ ] If no channels remain → empty state ("Select a channel or click +")

## 7. Multi-channel lifecycle

- [ ] Open 3 channels (A, B, C)
- [ ] Kill B with `exit` → B shows "Closed", A and C still live
- [ ] Delete B via context menu → B's tab closes, A and C intact
- [ ] Kill C with `exit` → C shows "Closed", A still live
- [ ] Delete A via context menu → falls back to C (dead, readonly)
- [ ] Delete C → empty state

## 8. Page reload persistence

- [ ] With 2 tabs open, reload page → tabs restored from localStorage
- [ ] Active tab preserved after reload
- [ ] Dead channel tabs restored with "Closed" badge

## 9. Write-lock indicator

- [ ] Live channel: shows green dot + "Writer" + "Release" button
- [ ] Dead channel: indicator completely hidden
- [ ] After releasing write lock: shows "No lock" (grey dot)
- [ ] After re-claiming: shows "Writer" again

## 10. Host rail status

- [ ] Local host shows green dot when agent is running
- [ ] Pulsing/red dot when agent is disconnected
- [ ] Status recovers after warm restart

## 11. Terminal I/O

- [ ] Type `echo HELLO` + Enter → output `HELLO` appears in terminal
- [ ] Type `pwd` + Enter → current directory shown
- [ ] Type `ls --color` → colored output renders correctly
- [ ] Rapid typing (paste a long string) → no dropped characters
- [ ] Ctrl+C interrupts a running command (e.g. `sleep 999`)

## 12. Channel rename (inline edit)

- [ ] Double-click channel name in sidebar → inline input appears
- [ ] Type new name + Enter → name updates in sidebar and tab bar
- [ ] Press Escape → cancels rename, original name preserved
- [ ] Double-click tab label → inline input appears (same behavior)
- [ ] Empty name rejected (reverts to original)

## 13. Channel group management

- [ ] Click "+ Add group" → new group appears in sidebar (e.g. "GROUP 2")
- [ ] New channel created in selected group appears under that group
- [ ] Drag channel from GENERAL to GROUP 1 → channel moves, counts update
- [ ] Drag channel back → channel returns to original group
- [ ] Delete empty group → group removed from sidebar
- [ ] Delete group with channels → channels move to default group (GENERAL)

## 14. Daemon survival (hub restart)

Precondition: 2+ live channels with output, agent running as daemon.

- [ ] Run `echo BEFORE_RESTART` in terminal A
- [ ] Stop hub (`dev-stop.sh` kills hub but agent survives — or restart hub only)
- [ ] Start hub again (`dev-start.sh`)
- [ ] Reload page → channels reappear in sidebar with green dots (alive)
- [ ] Click channel A → scrollback preserved (contains `BEFORE_RESTART`)
- [ ] Type `echo AFTER_RESTART` → terminal still functional
- [ ] Channel B also restored with its scrollback

## 15. Daemon death recovery

- [ ] Kill agent daemon process (`kill <agent-pid>`)
- [ ] Sidebar channels turn grey/dead (agent disconnected)
- [ ] Hub auto-restarts agent daemon (check `agent.sock` reappears)
- [ ] Create new channel → works normally (new agent)
- [ ] Old channels show as dead (PTYs lost with agent process)

## 16. WS reconnect (network blip)

- [ ] With active terminal, disconnect network briefly (disable adapter or DevTools offline)
- [ ] Reconnect → WS auto-reconnects (exponential backoff)
- [ ] Terminal resumes working (type command, see output)
- [ ] No duplicate tabs or ghost channels after reconnect

## 17. Multiple browser tabs (write-lock contention)

- [ ] Open nexterm in two browser tabs
- [ ] Tab A has write lock on channel X
- [ ] Tab B clicks channel X → sees "No lock" (reader mode)
- [ ] Tab B force-takes write lock → Tab A loses lock, shows "No lock"
- [ ] Tab A reclaims → Tab B loses lock

## 18. Page reload with daemon

- [ ] Open 3 channels, type distinct commands in each
- [ ] Reload page (F5) → all 3 tabs restored
- [ ] Each terminal shows its previous scrollback (snapshot restore)
- [ ] Write lock auto-claimed on active tab

---

## Run Log

Each run records which scenarios passed/failed. Commit = HEAD at time of run.

### Run #1 — 2026-03-06 — `feat/agent-daemon` (7bf51c3)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Channel creation | ✅ | + tab bar, sidebar count |
| 2 | Tab switching | ✅ | Tab 1↔2, sidebar highlight |
| 3 | Sidebar re-selection | ✅ | Close tab → reopen via sidebar click |
| 4 | Shell exit (dead channel) | ✅ | Closed badge, grey dot, no write-lock |
| 5 | Channel deletion | ✅ | Context menu → Close channel |
| 6 | Delete fallback | ✅ | Deleted current → fallback to next alive |
| 7 | Multi-channel lifecycle | ✅ | 3 ch: kill B→Closed, delete B→A/C intact, kill C, delete A→fallback C dead, delete C→empty |
| 8 | Page reload persistence | ✅ | 2 tabs restored, active preserved, RELOAD_TEST in scrollback |
| 9 | Write-lock indicator | ✅ | Writer+Release, released→No lock+Request/Force, reclaimed, dead→hidden |
| 10 | Host rail status | ✅ | Green dot (status-dot--live), agent running |
| 11 | Terminal I/O | ✅ | pwd, ls --color, sleep+Ctrl+C |
| 12 | Channel rename | ✅ | Sidebar dbl-click, tab dbl-click, Escape cancels, name syncs everywhere |
| 13 | Group management | ✅ | Create group, move channel↔groups, delete empty group |
| 14 | Daemon survival | ✅ | Hub restart → scrollback preserved, terminal functional |
| 15 | Daemon death recovery | ✅ | kill agent → hub auto-relaunched new daemon, old channels dead, new channels work |
| 16 | WS reconnect | ⏭️ | Requires network disruption — manual test |
| 17 | Multi-browser write-lock | ✅ | Tab A Writer → Tab B force-take → A loses → A reclaims → B loses |
| 18 | Page reload + daemon | ✅ | 5 tabs restored, scrollback preserved, write lock auto-claimed |

**Summary: 17/18 tested, 17 pass, 0 fail, 0 partial, 1 skipped (manual only: WS reconnect)**

---

## Regression markers

When a test fails, note the commit hash and which test. Fix before merging.

| Date | Test | Commit | Issue |
|------|------|--------|-------|
| 2026-03-06 | 3, 5, 6 | 0988ddb | Sidebar re-click + delete didn't open/close tabs |
