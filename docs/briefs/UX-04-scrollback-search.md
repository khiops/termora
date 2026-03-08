# UX-04: Scrollback Search

## Overview

In-terminal search with xterm.js SearchAddon, configurable overlay position,
match highlighting, scrollbar markers, and search history.

## Technical Foundation

xterm.js provides SearchAddon out of the box:

```typescript
import { SearchAddon } from "@xterm/addon-search"
const searchAddon = new SearchAddon()
terminal.loadAddon(searchAddon)

searchAddon.findNext("pattern", { regex: false, caseSensitive: false })
searchAddon.findPrevious("pattern")
searchAddon.clearDecorations()
```

Handles: scrollback search, match highlighting, scroll-to-match.
UI work: search overlay, keyboard shortcuts, scrollbar markers, settings.

## Search Overlay

### Position Options (user-configurable)

Default: top-right (VS Code / iTerm2 standard)

```
  Option A (default): Top-right
  +--------------------------------------------------------------+
  | terminal content           +---------------------------+     |
  |                            | search...  1/3  < > x     |     |
  |                            +---------------------------+     |
  |                                                              |
  +--------------------------------------------------------------+

  Option B: Bottom-right
  +--------------------------------------------------------------+
  |                                                              |
  | terminal content                                             |
  |                            +---------------------------+     |
  |                            | search...  1/3  < > x     |     |
  +--------------------------------------------------------------+

  Option C: Bottom full-width (sticky bar)
  +--------------------------------------------------------------+
  |                                                              |
  | terminal content                                             |
  |                                                              |
  +--------------------------------------------------------------+
  | Search: [query...              ]   1/3  < > x  [Aa] [.*] [W]|
  +--------------------------------------------------------------+
```

### Compact vs Expanded

```
  Compact (default):
  +----------------------------------------------+
  | [search...               ]  1/3  [<] [>] [x] |
  +----------------------------------------------+

  Expanded (click toggle or when option active):
  +----------------------------------------------+
  | [search...               ]  1/3  [<] [>] [x] |
  | [Aa] [.*] [W]                                 |
  +----------------------------------------------+

  Aa = case sensitive toggle
  .* = regex toggle
  W  = whole word toggle
```

Option C (full-width) always shows toggles inline (no expand needed).

### Search History Dropdown

```
  +----------------------------------------------+
  | [auth|                   ]  0/0  [<] [>] [x] |
  | +------------------------------------------+ |
  | | auth token                               | |
  | | error                                    | |
  | | connection refused                       | |
  | | ^(\d+)\.                         [.*]    | |
  | +------------------------------------------+ |
  +----------------------------------------------+

  Dropdown appears on focus / click in empty field.
  Regex searches show [.*] badge.
  Max historySize entries (default 20).
```

## Search Scope

| Scope | Trigger | Behavior |
|-------|---------|----------|
| Active pane | Ctrl+Shift+F (default) | Searches scrollback of focused pane only |
| All panes in tab | Toggle in search bar | Searches all panes, navigates across panes |
| All tabs / cross-server | Command palette (future) | Global search, separate feature |

```
  Scope toggle (appears when tab has splits):
  +------------------------------------------------------+
  | [search...     ]  1/3  [<] [>]  [this pane v]  [x]  |
  +------------------------------------------------------+
                                      |
                              +---------------+
                              | This pane     |
                              | All panes     |
                              +---------------+
```

When "All panes" is active and match is in another pane, that pane gets
focus and scrolls to the match. Current pane indicator shown in results:

```
  +------------------------------------------------------+
  | [auth          ]  3/7  [<] [>]  [all panes]    [x]  |
  | Match 3/7 in: Terminal 2                             |
  +------------------------------------------------------+
```

### Searchable Channel States

| State | Searchable | Reason |
|-------|------------|--------|
| Active (running) | Yes | Live scrollback |
| Exited (process ended) | Yes | Frozen output still in buffer |
| Vacant (picker) | No | No terminal content |

## Scrollbar Markers

Yellow markers in the scrollbar showing match positions (VS Code style):

```
  +----+----------------------------------------------+--+
  |    |                                              |  |
  |    | terminal content                             |##|
  |    |                                              |  |
  |    |   some text with [auth] highlighted          |==| <- marker
  |    |                                              |  |
  |    |                                              |  |
  |    |   another [auth] match here                  |==| <- marker
  |    |                                              |  |
  |    |                                              |##|
  +----+----------------------------------------------+--+
                                                       ^
                                                    scrollbar
                                                    with markers
```

Implementation: xterm.js SearchAddon provides decoration positions.
Map decoration line numbers to scrollbar height percentage. Render
markers as thin horizontal lines in a scrollbar overlay div.

Marker color: from theme `searchHighlight` / `searchHighlightActive`
(see UX-06 theme format). Not hardcoded.

In split panes: each pane has its own xterm.js instance, its own
scrollbar, and its own markers. No shared scrollbar.

## Highlight Behavior

| Setting | On close search |
|---------|-----------------|
| "clear" | Highlights removed immediately |
| "fade" | Highlights fade out (300ms transition) |
| "persist" | Highlights stay until next action |

Default: "clear" (configurable).

## Keyboard Shortcuts

| Action | Default shortcut | Notes |
|--------|------------------|-------|
| Open search | Ctrl+Shift+F | Configurable. Not Ctrl+F (may be captured by shell) |
| Next match | Enter or F3 | When search field focused |
| Previous match | Shift+Enter or Shift+F3 | |
| Close search | Escape | Refocus terminal |
| Toggle case | Alt+C | When search open |
| Toggle regex | Alt+R | When search open |
| Toggle whole word | Alt+W | When search open |
| Toggle scope | Alt+S | Switch this pane / all panes |

All shortcuts configurable in settings.

## Settings

```toml
[search]
shortcut = "Ctrl+Shift+F"
position = "top-right"             # "top-right" | "bottom-right" | "bottom-bar"
defaultCaseSensitive = false
defaultRegex = false
defaultWholeWord = false
defaultScope = "pane"              # "pane" | "allPanes"
highlightAll = true                # highlight all matches (not just current)
highlightOnClose = "clear"         # "clear" | "fade" | "persist"
scrollbarMarkers = true
historySize = 20

[search.shortcuts]
open = "Ctrl+Shift+F"
next = "Enter"
previous = "Shift+Enter"
close = "Escape"
toggleCase = "Alt+C"
toggleRegex = "Alt+R"
toggleWholeWord = "Alt+W"
toggleScope = "Alt+S"
```

## Storage

Search history stored in `localStorage` (browser-side). Not persisted to DB.
Per-browser, not synced across clients.

## Future / Backlog

- Global search via command palette (all tabs, cross-server)
- Search-and-replace (for editable terminal buffers, if ever)
- Saved search patterns (like VS Code search bookmarks)
- Search in channel history beyond current scrollback (requires hub-side
  spool.db full-text index — already in Post-MVP backlog)
