# UX-09: Settings Panel (Config Cascade UI)

## Overview

Centralized settings panel with VSCode-style scope tabs mapping to the
4-layer config cascade from SPEC.md.

## Config Cascade Layers

```
1. Built-in defaults (code)
2. config.toml / Global tab         <- user editable
3. hosts.profile_json / Host tab    <- per-host overrides
4. channels.profile_json / Ch. tab  <- per-channel overrides
```

Last wins. Each level overrides the previous.

## Layout

```
+--------------------------------------------------------------+
| Settings                                              [x]    |
|--------------------------------------------------------------|
| Scope: [Global]  [Host: prod-server]  [Channel: btop]       |
|--------------------------------------------------------------|
|                                                              |
|  Left nav          Content                                   |
| +----------+  +------------------------------------------+   |
| |          |  |                                          |   |
| | Appear.  |  |  Color Scheme                            |   |
| |  Themes  |  |  [Catppuccin Mocha v]                    |   |
| |  Opacity |  |                                          |   |
| |  Scroll  |  |  Font                                    |   |
| |          |  |  Family: [Consolas v]                    |   |
| | Terminal |  |  Size:   [14]                            |   |
| |  Title   |  |                                          |   |
| |  Shell   |  |  ...                                     |   |
| |          |  |                                          |   |
| | Tabs     |  |                                          |   |
| | Panes    |  |                                          |   |
| | Search   |  |                                          |   |
| | Startup  |  |                                          |   |
| | Keys     |  |                                          |   |
| |          |  |                                          |   |
| +----------+  +------------------------------------------+   |
+--------------------------------------------------------------+
```

## Scope Tabs

| Tab | Visible when | Edits |
|-----|--------------|-------|
| Global | Always | config.toml (persisted by hub) |
| Host: <name> | A host is selected in sidebar | hosts.profile_json |
| Channel: <name> | A channel is focused | channels.profile_json |

Tabs appear/disappear based on current selection context.

## Override Indicators

Each setting row shows its inheritance status:

```
  Global tab (base values):
  +--------------------------------------------------+
  |  Font Size                                       |
  |  [14]                                            |
  +--------------------------------------------------+

  Host tab (override active):
  +--------------------------------------------------+
  |  Font Size                  [reset to global]    |
  |  [18]                                            |
  |  |  <- blue left bar = overridden                |
  +--------------------------------------------------+

  Host tab (inherited, no override):
  +--------------------------------------------------+
  |  Font Size                  (inherited: 14)      |
  |  [ ]  <- empty/dimmed = inherits parent          |
  +--------------------------------------------------+

  Channel tab (override from host):
  +--------------------------------------------------+
  |  Font Size                  [reset to host]      |
  |  (inherited: 18 -- from Host: prod-server)       |
  |  [ ]                                             |
  +--------------------------------------------------+
```

Visual cues:
- Blue left bar: value is overridden at this level
- (inherited: X): shows effective value from parent level
- (inherited: X -- from <source>): shows which level provides the value
- [reset to <parent>]: removes the override, reverts to parent
- Empty/dimmed field: no override set, parent value applies

## Setting Categories

| Category | Subcategories | Key settings |
|----------|---------------|-------------|
| Appearance | Themes, Opacity, Scrollbar | theme, opacity per surface, scrollbar style/width |
| Terminal | Title, Shell | title source/prefix/format, default shell, env vars |
| Tabs | General, Welcome, Confirmations | close button, new tab position, welcome command |
| Panes | Layout, Navigation, Resize | max panes, focus keys, resize keys |
| Search | General, Shortcuts | position, defaults, history size |
| Startup | Restore | mode (restore/fresh/empty), restore layout |
| Keybindings | All shortcuts | grouped by category, conflict detection |

## API

Settings are read/written via REST API:

```
GET  /api/config/defaults           -> built-in defaults
GET  /api/config                    -> resolved global config
PUT  /api/config                    -> update global config
GET  /api/hosts/:id/profile         -> host profile overrides
PUT  /api/hosts/:id/profile         -> update host profile
GET  /api/channels/:id/profile      -> channel profile overrides
PUT  /api/channels/:id/profile      -> update channel profile
```

All responses include `_resolved` field showing the effective merged value.

## Pinia Store

```typescript
// useSettingsStore
const globalConfig = ref<Config>({})
const hostProfile = ref<Partial<Config>>({})
const channelProfile = ref<Partial<Config>>({})
const resolved = computed(() => deepMerge(defaults, globalConfig, hostProfile, channelProfile))
const activeScope = ref<"global" | "host" | "channel">("global")

function updateSetting(scope: Scope, path: string, value: any) { ... }
function resetSetting(scope: Scope, path: string) { ... }
function isOverridden(scope: Scope, path: string): boolean { ... }
function inheritedFrom(path: string): { value: any, source: string } { ... }
```

## Open for Design

- Search/filter within settings (VS Code has this)
- Settings sync across devices (P2)
- Settings export/import as JSON
- Keyboard shortcut conflict detection in Keybindings section

## Relationship to Other Stories

This panel is the UI for all configurable settings defined in:
- UX-01: tabs, panes, welcome tab (also exposed at Host scope), confirmations, startup
- UX-02: terminal title, prefix (per-host overridable), window title format
- UX-03: host rail, host defaults (shell, keepalive, history retention)
- UX-04: search position, defaults, shortcuts
- UX-05: notifications (activity, bell, scroll behavior)
- UX-06: theme (per-host overridable), opacity, scrollbar, auto-switch
- UX-07: visual profile (host scope only: banner, border, tint, presets)
- Future stories: any new configurable feature adds a section here

The settings panel itself (UX-09) is Tier 3, but its DESIGN is specced
now so all Sprint 1 stories structure their settings correctly.
