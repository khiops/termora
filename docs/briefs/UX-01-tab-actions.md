# UX-01: Tab Actions, Split Panes & Welcome Tab

## Overview

Tab management, split pane layout, cross-tab DnD, welcome tab, and channel lifecycle.

## App Layout (Discord/VSCode-inspired)

```
+--+-------------+-----------------------------------------------+
|  |             | Tab Bar                                       |
|  | Channels    | [* Welcome] [Terminal 2]           [+]        |
|H |             |-----------------------------------------------|
|o | for         |                                               |
|s | selected    |   Active terminal pane                        |
|t | host        |                                               |
|  |             |   $ npm run dev                               |
|R | * T1 (welc) |   Server running on :3000                     |
|a | . T2        |                                               |
|i | . T3        |                                               |
|l | o T4 (exit) |                                               |
|  |             |                                               |
|  | [+ New]     |                                               |
+--+-------------+-----------------------------------------------+
 ^       ^                        ^
 Host    Channel sidebar          Main area (tabs + panes)
 rail    (per host)
```

## Channel Sidebar States

| Icon | State | Meaning |
|------|-------|---------|
| `*` (filled dot) | active + visible | Terminal is in a tab pane |
| `o` (open dot) | active + detached | Terminal running but not in any tab |
| `.` (dim dot) | exited | Process terminated, output frozen |
| `*` (star) | welcome | Designated welcome tab |

## Tab Bar

- Close button: appears on hover (configurable: hover/always/never)
- Middle-click: closes tab
- Double-click: rename (inline edit, existing feature)
- DnD: reorder tabs by dragging
- `[+]` button: new terminal (uses default shell or configured command)

## Context Menu — Tab

```
Rename                        F2
Reset Title to Dynamic             (only if custom title set)
Configure Command              >
Set as Welcome Tab             *
---
Split Right                    >   (submenu: New Term + available channels)
Split Down                     >   (submenu: New Term + available channels)
---
Close                      Ctrl+W
Close Others
Close to the Right
Close All
```

Split submenus list channels NOT already in the current tab layout.

## Context Menu — Channel (sidebar)

```
Open in New Tab
Open in Current Tab            >   (submenu: pane slots if split)
---
Rename                        F2
Configure Command              >
Set as Welcome Tab             *
---
Restart                            (only if exited)
Destroy                            (kill definitively)
```

## Split Panes

### Layout Engine: Binary Tree

Each tab contains a layout tree:

```typescript
type PaneLayout =
  | { type: "terminal"; channelId: string }
  | { type: "vacant" }
  | { type: "split"; direction: "horizontal" | "vertical";
      ratio: number;  // 0.0-1.0, default 0.5
      first: PaneLayout; second: PaneLayout }
```

Persisted as JSON in `workspaces.layout_json`.

### Max Panes

4 per tab (hardcoded for now, P2: configurable/unlimited).

### Tab Title with Splits

Follows Windows Terminal / WezTerm pattern:
- Tab title = title of the **currently focused pane** (dynamic)
- If user set a custom tab title via F2, it overrides (static)
- To restore dynamic mode after a custom rename: right-click → "Reset title to dynamic"
- Research: Tabby's static first-pane approach (issue #9829) is universally disliked

Title priority (highest wins):
1. Custom (F2 rename) → static, overrides all
2. Dynamic (OSC 0/2 from process) → real-time (see UX-02)
3. Fallback (configurable: channel name / shell / custom string)

### Resize

- Drag separator between panes
- Double-click separator: reset to 50/50
- Keyboard: Alt+Shift+Arrow (configurable)

### Focus Navigation

- Alt+Arrow: move focus between panes (configurable)
- Ctrl+Tab: cycle between tabs (not panes)

### Close Pane Behavior

Closing a pane does NOT kill the terminal. The terminal detaches and becomes
available in the channel sidebar (state: active + detached).

The closed pane becomes a **vacant slot** showing a picker:

```
+---------------------+------------------+
|                     | +------------+   |
|   Terminal 1        | | Open here: |   |
|   (running)         | |            |   |
|                     | | * New Term |   |
|                     | | . Term 2   |   |
|                     | | . Term 3   |   |
|                     | |            |   |
|                     | | -- or --   |   |
|                     | | ~ Rearrange|   |
|                     | +------------+   |
+---------------------+------------------+
```

- "Open here": pick a channel to place in that slot (only channels from the active host — one tab = one host)
- "Rearrange": remove vacant slot, remaining panes fill the space

The tab NEVER auto-closes. Even with all panes vacated, the tab stays open
showing pickers.

Vacant pane timeout: configurable (default: 0 = no timeout, stays as picker).

## Cross-Tab Pane DnD

User can drag a pane from one tab to another:

1. Grab a pane (terminal content area)
2. Drag to another tab in the tab bar
3. That tab activates, showing drop zones on its panes:
   - LEFT / RIGHT / TOP / BOTTOM = split in that direction
   - CENTER = replace pane content
4. Drop zone highlights on hover for clear feedback
5. Drop between two tabs in the tab bar = create new standalone tab

Source tab: the pane becomes vacant (picker shown).

## Welcome Tab

### Concept

Replaces traditional "empty state". A welcome tab is a regular terminal that
runs a configurable command and auto-opens when no other tabs are open.

### Behavior

- Each host can have its own welcome tab config (per-host profile)
- Star icon in tab bar and channel sidebar to distinguish it
- "Sticky": protected from "Close All" (user can close it explicitly)
- When welcome tab is closed explicitly, minimal empty state shown:
  "Click [+] or press Ctrl+T to open a terminal"

### "Set as Welcome Tab"

Available in context menu for both tabs and channels. Toggle — only one
welcome tab per host.

## Process-Spawned Channels (Direct Process)

### Spawn

Instead of always spawning a shell, a channel can run a specific process:

```
SPAWN { shell: "/usr/bin/btop", args: [], directProcess: true }
```

### Exit Behavior

When the process exits, the channel transitions to status "exited" (not destroyed):
- Terminal shows frozen last output
- Overlay with actions: [Restart] [Configure Command] [Close]
- Channel sidebar shows dim dot icon

"Restart" relaunches the same command.
"Configure Command" opens dialog to change program/args/cwd.

## Configure Command Dialog

```
+------------------------------------------+
|  Configure Terminal                      |
|                                          |
|  Icon:  [>_ v]  [preview]               |
|  (preset gallery + custom emoji)         |
|                                          |
|  Program:                                |
|  [/usr/bin/btop                       ]  |
|                                          |
|  Arguments:                              |
|  [                                    ]  |
|                                          |
|  Working directory:                      |
|  [~ (default)                         ]  |
|                                          |
|  [x] Direct process (close on exit)     |
|                                          |
|           [Cancel]    [Apply & Restart]  |
+------------------------------------------+
```

Channel icon (set here) is visible in tab bar + channel sidebar.
Host icon (set in UX-03 host modal) is visible only in host rail.
These are independent — no inheritance.

Accessible from context menu on both tabs and channels.

## Confirmations

"Close All" and "Close Others" show confirmation dialog:

```
+------------------------------------------+
|  Close all 4 terminals?                  |
|                                          |
|  [ ] Remember this choice for this host  |
|  [ ] Remember this choice globally       |
|                                          |
|           [Cancel]    [Close All]         |
+------------------------------------------+
```

Saved preference stored in config cascade (host profile or global).

## Settings

```toml
[tabs]
closeButton = "hover"              # "hover" | "always" | "never"
middleClickClose = true
newTabPosition = "end"             # "end" | "afterCurrent"
dragAndDrop = true                 # reorder tabs
crossTabDnD = true                 # drag panes between tabs

[tabs.title]
mode = "activePane"                # "activePane" | "custom" | "first"

[tabs.confirmations]
closeAll = "ask"                   # "ask" | "always" | "never"
closeOthers = "ask"

[tabs.welcome]
enabled = true
command = ""                       # empty = default shell
args = []
sticky = true                     # protected from "Close All"
# Overridable per-host via host profile

[panes]
maxPanes = 4
defaultSplitDirection = "right"    # "right" | "down"
vacantPaneBehavior = "picker"      # "picker" | "autoRearrange"
vacantPaneTimeout = 0              # 0 = no timeout (seconds)

[panes.navigation]
focusKey = "Alt+Arrow"
resizeKey = "Alt+Shift+Arrow"

[panes.resize]
doubleClickReset = true

[channels]
directProcessCloseOnExit = true

[startup]
mode = "restore"                   # "restore" | "fresh" | "empty"
restoreLayout = true
```

## Future / Deferred

- UX-11: Empty state widget plugins (iframe-based, configurable widgetUrl)
- P2: Max panes > 4 (configurable)
- P2: Pane templates (predefined layouts: 2-col, 2-row, quad, L-shape)
