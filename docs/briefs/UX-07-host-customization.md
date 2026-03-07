# UX-07: Host Customization & Visual Profiles

## Overview

Per-host visual identity: environment banner, accent border, background
tint, and icon/color. Makes it impossible to confuse prod with dev.

Most of the "basic" host customization (icon, color, name, default shell)
is already in UX-03 (host management modal). This brief covers the
**visual profile** features that go beyond basic config.

## Environment Banner

Configurable banner displayed between the tab bar and terminal content.
Per-host, in the advanced host settings.

### Position Options

```
  Option A: Above tabs (most visible)
  +--+-------------+----------------------------------------------+
  |  |             | !! PRODUCTION - prod-server !!         [v]  |
  |  |             |----------------------------------------------|
  |  |  Channels   | [>_] zsh  | [>_] build         [+]          |
  |  |             |----------------------------------------------|
  |  |             |  $ _                                         |
  +--+-------------+----------------------------------------------+

  Option B: Between tabs and terminal (less intrusive)
  +--+-------------+----------------------------------------------+
  |  |             | [>_] zsh  | [>_] build         [+]          |
  |  |  Channels   |----------------------------------------------|
  |  |             | !! PRODUCTION - prod-server !!         [v]  |
  |  |             |----------------------------------------------|
  |  |             |  $ _                                         |
  +--+-------------+----------------------------------------------+
```

Position configurable per-host. Default: between tabs and terminal (B).

### Banner Config

```
  Host Settings > Advanced > Environment Banner
  +--------------------------------------------------+
  |  Environment Banner                              |
  |                                                  |
  |  [x] Show banner                                |
  |                                                  |
  |  Text:     [PRODUCTION - {host}              ]  |
  |  Color:    [#e06c75] [pick]   (bg color)        |
  |  Text color: [#ffffff] [pick]                    |
  |  Position: (*) Between tabs and terminal         |
  |            ( ) Above tabs                        |
  |  Collapsible: [x]                                |
  +--------------------------------------------------+

  Tokens available: {host}, {ip}, {user}, {group}
```

### Banner States

```
  Expanded:
  +--------------------------------------------------------------+
  | !! PRODUCTION - prod-server (192.168.1.100) !!         [v]  |
  +--------------------------------------------------------------+

  Collapsed:
  +--------------------------------------------------------------+
  | !! PROD !!                                              [>]  |
  +--------------------------------------------------------------+

  Hidden (banner disabled):
  (nothing - tab bar directly above terminal)
```

Collapsed text: first word of banner text (or configurable short label).
Collapse/expand animation: slide vertical 150ms (CSS transition height).

Visual profile is per-host only. Not per-channel — it's an environment
indicator (prod vs staging), not channel-specific.

## Accent Border

Color indicator on terminal/sidebar edges to reinforce host identity.

### Configuration

```
  Host Settings > Advanced > Visual Profile
  +--------------------------------------------------+
  |  Accent Border                                   |
  |                                                  |
  |  Style:                                          |
  |  ( ) None                                        |
  |  (*) Subtle (left border only, 2px)              |
  |  ( ) Strong (left + right + bottom, 3px)         |
  |                                                  |
  |  Color: [from host color v] [pick]               |
  |  (defaults to host color from UX-03, overridable)|
  +--------------------------------------------------+
```

### Visual

```
  None (local):            Subtle (staging):       Strong (prod):
  |              |         |#             |        |##           ##|
  |  terminal    |         |#  terminal   |        |##  terminal ##|
  |              |         |#             |        |##           ##|
  |              |         |#             |        |##___________##|
                            ^                      ^^            ^^
                            orange 2px             red 3px
                            left only              left+right+bottom
```

Border color defaults to host color (set in UX-03 Add/Edit modal).
Can be overridden specifically for the border in advanced settings.

Color layers (three independent concepts):
- `host.color` (UX-03): identity color → rail tint, badge, sidebar accent
- `appearance.theme` (UX-06): full palette → all rendering
- `visualProfile.border.color`: defaults to host.color, overridable
- `visualProfile.tint.color`: always independent (red for prod, etc.)

Border is CSS on the container div, not inside xterm.js. The terminal
area shrinks by 2-3px — xterm.js `fit()` recalculates automatically.

## Background Tint

Subtle color overlay on terminal background to visually distinguish hosts.
Independent of the theme — works as an additive layer.

### Configuration

```
  Host Settings > Advanced > Visual Profile
  +--------------------------------------------------+
  |  Background Tint                                 |
  |                                                  |
  |  [x] Apply background tint                      |
  |                                                  |
  |  Color:   [#ff0000] [pick]                       |
  |  Opacity: [====|===========] 5%                  |
  |                                                  |
  |  Preview:                                        |
  |  +----------------------------------+            |
  |  | $ ls -la                         |            |
  |  | drwxr-xr-x  user  src/          |            |
  |  | -rw-r--r--  user  file          |  <- subtle |
  |  | $ git status                     |     red    |
  |  +----------------------------------+    tint    |
  |                                                  |
  +--------------------------------------------------+
```

Implementation: CSS `background-color` overlay with very low opacity
(2-10%) blended on top of the theme background. Applied to terminal
pane only, not to sidebar/tabs.

### Default Opacity Range

- Min: 0% (disabled)
- Max: 15% (more would impair readability)
- Default: 5% when enabled
- Slider with live preview

## Combined Visual Profile Example

```
  Local host (no visual profile):
  +--+-------------+----------------------------------------------+
  |  |             | [>_] zsh  | [>_] vim           [+]          |
  |  |  Channels   |----------------------------------------------|
  |  |             |  $ echo "home sweet home"                    |
  |  |             |                                              |
  +--+-------------+----------------------------------------------+

  Prod host (full visual profile):
  +--+-------------+----------------------------------------------+
  |  |             | [>_] zsh  | [>_] deploy         [+]         |
  |  | ┃           |----------------------------------------------|
  |  | ┃ Channels  | !! PRODUCTION - prod (1.2.3.4) !!     [v]  |
  |  | ┃           |----------------------------------------------|
  |  | ┃           |##                                         ##|
  |  | ┃           |##  $ echo "be very careful"               ##|
  |  | ┃           |##                              (red tint) ##|
  |  | ┃           |##                                         ##|
  +--+-------------+----------------------------------------------+
       ^                ^                           ^           ^
    sidebar          banner                      tint       border
    border           (red bg)                  (5% red)    (red 3px)
```

## Preset Profiles

For quick setup, offer presets:

| Preset | Banner | Border | Tint | Use case |
|--------|--------|--------|------|----------|
| None | off | none | off | Local, dev |
| Caution | yellow, "STAGING" | subtle, yellow | 3% yellow | Staging |
| Danger | red, "PRODUCTION" | strong, red | 5% red | Production |
| Custom | user-defined | user-defined | user-defined | |

```
  Host Settings > Advanced > Visual Profile
  +--------------------------------------------------+
  |  Quick Preset:                                   |
  |  ( ) None  (*) Caution  ( ) Danger  ( ) Custom  |
  +--------------------------------------------------+
```

Selecting a preset fills in banner/border/tint values. User can then
customize further (switches to Custom automatically).

## Settings (per-host profile)

```toml
# In host profile (hosts.profile_json)
[visualProfile]
preset = "none"                    # "none" | "caution" | "danger" | "custom"

[visualProfile.banner]
enabled = false
text = ""                          # supports {host}, {ip}, {user}, {group}
shortText = ""                     # collapsed text (default: first word)
bgColor = "#e06c75"
textColor = "#ffffff"
position = "betweenTabsAndTerminal"  # "aboveTabs" | "betweenTabsAndTerminal"
collapsible = true
defaultCollapsed = false

[visualProfile.border]
style = "none"                     # "none" | "subtle" | "strong"
color = ""                         # empty = use host color

[visualProfile.tint]
enabled = false
color = "#ff0000"
opacity = 5                        # 0-15 percent
```

## Future / Backlog

- P2: Command guard / protected mode (confirm dangerous commands on prod)
  - Makes more sense in bastion/web deployment mode
  - Related: stronger auth for remote-deployed hub (beyond pairing code)
  - Note: local deployment = no real benefit (user can SSH directly)
- P2: Auto-detect environment from hostname patterns
  (e.g., *prod* -> Danger preset, *staging* -> Caution preset)
- P2: Visual profile inheritance (group-level defaults)
