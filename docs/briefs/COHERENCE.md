# UX Briefs — Cross-Cutting Index

Quick reference for cross-cutting concerns. Detailed rules are in each brief.

## Protocol Messages (new)

| Message | Direction | Brief | Fields |
|---------|-----------|-------|--------|
| TITLE_CHANGE | Agent -> Hub | UX-02 | channel_id, title |
| BELL | Agent -> Hub | UX-05 | channel_id |
| NOTIFICATION | Agent -> Hub | UX-05 | channel_id, message (OSC 9) |

ATTACH_OK extended with optional `dynamic_title` field (UX-02).

## DB Schema Changes

### channels table
- `dynamic_title TEXT DEFAULT NULL` (UX-02)

### hosts table
- `icon_type TEXT DEFAULT 'auto'` (existing — MVP)
- `icon_value TEXT DEFAULT NULL` (existing — MVP)
- `color TEXT DEFAULT NULL` (existing — MVP)
- `host_group TEXT DEFAULT NULL` (UX-03)
- `sort_order INTEGER DEFAULT 0` (UX-03, backfill existing rows on migration)
- `ssh_config_host TEXT DEFAULT NULL` (UX-03)
- `ssh_user TEXT DEFAULT NULL` (UX-03)
- `keep_alive_seconds INTEGER DEFAULT 60` (UX-03)
- `history_retention_days INTEGER DEFAULT 30` (UX-03)

## Settings Panel Categories -> Brief Mapping

| Category | Settings from |
|----------|---------------|
| Appearance > Themes | UX-06 |
| Appearance > Opacity | UX-06 |
| Appearance > Scrollbar | UX-06 |
| Terminal > Title | UX-02 |
| Terminal > Icon | UX-02 |
| Terminal > Shell | UX-03 (host-level) |
| Tabs > General | UX-01 |
| Tabs > Title | UX-01 |
| Tabs > Welcome | UX-01 (also at Host scope) |
| Tabs > Confirmations | UX-01 |
| Panes | UX-01 |
| Search | UX-04 |
| Notifications | UX-05 |
| Startup | UX-01 |
| Host Rail | UX-03 |
| Host > Visual Profile | UX-07 (host scope only) |
| Host > Connection | UX-03 (host scope only) |
| Keybindings | UX-01, UX-04 |
