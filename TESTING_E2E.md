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

---

## Regression markers

When a test fails, note the commit hash and which test. Fix before merging.

| Date | Test | Commit | Issue |
|------|------|--------|-------|
| 2026-03-06 | 3, 5, 6 | 0988ddb | Sidebar re-click + delete didn't open/close tabs |
