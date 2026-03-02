# nexterm — Architecture Specification

> Version: 0.1.0 (MVP)
> Status: draft
> Last updated: 2026-03-02

## 1. Vision

nexterm is a **local-first session terminal platform** that lets developers and SREs manage persistent terminal sessions across local and remote machines from a modern web UI. Sessions survive client disconnects, SSH drops, and device switches.

**Core differentiators:**
- Hub owns state (cache + snapshot) independently of UI clients
- SSH stdio transport — zero ports opened on remote machines
- Discord-style UI with per-host visual identity
- Remote visual hints — agents can impose badges/themes on their terminals
- Config cascade — 4-layer deep merge (defaults → user TOML → host profile → channel profile)

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI (PWA / Tauri)                        │
│   Vue 3 + xterm.js — served at http://localhost:3100            │
│   Discord-style: host rail │ channel sidebar │ terminal panes   │
└──────────┬──────────────────────────────┬───────────────────────┘
           │ REST (/api/*)                │ WS (/ws)
           │ CRUD: hosts, sessions,       │ Realtime: INPUT, OUTPUT,
           │ workspaces, config, pair     │ ATTACH, DETACH, RESIZE,
           │                              │ SNAPSHOT, WRITE_*, HEARTBEAT
┌──────────▼──────────────────────────────▼───────────────────────┐
│                        Hub (Node.js daemon)                     │
│   Binds 127.0.0.1:3100 — single HTTP server (REST + WS)        │
│                                                                  │
│   ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌────────────┐  │
│   │ Client   │ │ Session      │ │ Cache      │ │ Config     │  │
│   │ Manager  │ │ Manager      │ │ Manager    │ │ Resolver   │  │
│   │          │ │              │ │            │ │            │  │
│   │ WS conns │ │ Local PTY    │ │ Snapshots  │ │ 4-layer    │  │
│   │ Auth     │ │ SSH → Agent  │ │ Tail spool │ │ cascade    │  │
│   │ WriteLock│ │ Reconnect    │ │ GC policy  │ │ deep merge │  │
│   └──────────┘ └──────────────┘ └────────────┘ └────────────┘  │
│                                                                  │
│   ┌───────────────────────────────────────────────────────────┐  │
│   │ Storage: meta.db (hosts, sessions, channels, workspaces) │  │
│   │          spool.db (output chunks, snapshots)              │  │
│   └───────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────────────────────────────────────┘
           │ SSH (ssh2 library)
           │ Launches: nexterm-agent --stdio
           │ Transport: MessagePack framed over stdio
           │
┌──────────▼──────────────────────────────────────────────────────┐
│                    Agent (Node.js, remote machine)              │
│   Launched via SSH, communicates over stdin/stdout               │
│                                                                  │
│   ┌──────────────┐ ┌────────────────┐ ┌──────────────────────┐  │
│   │ PTY Manager  │ │ Screen Model   │ │ Protocol Handler     │  │
│   │              │ │                │ │                      │  │
│   │ node-pty     │ │ xterm.js       │ │ MessagePack framed   │  │
│   │ spawn/resize │ │ headless       │ │ stdin/stdout         │  │
│   │ N channels   │ │ serialize()    │ │ multiplexed channels │  │
│   └──────────────┘ └────────────────┘ └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Component Details

### 3.1 Shared Package (`@nexterm/shared`)

TypeScript library used by hub, agent, and UI.

**Responsibilities:**
- Protocol message type definitions (TypeScript discriminated unions)
- MessagePack codec: encode/decode with Uint8Array support
- Frame encoder/decoder: 4-byte LE length prefix + MessagePack payload
- Config types (theme, keybindings, profile)
- Entity types (Host, Session, Channel, Workspace, ChannelGroup)
- Constants (protocol version, default port, default config values)

### 3.2 Agent (`@nexterm/agent`)

Runs on remote machines (or locally for local sessions). Launched via SSH in stdio mode.

**Responsibilities:**
- Protocol handshake (HELLO with version, capabilities, visual_hints)
- PTY lifecycle: spawn, resize, destroy (via node-pty)
- Screen model: xterm.js headless terminal per channel — maintains accurate screen state
- Snapshot: serialize() on demand or periodic (3s idle, 5s forced)
- Channel multiplexing: N channels per agent process
- Backpressure: pause PTY read when output buffer exceeds threshold

**Process model:**
```
ssh user@host "nexterm-agent --stdio"
  → Agent starts, writes HELLO to stdout
  → Hub reads HELLO, sends SPAWN commands
  → Each SPAWN creates a PTY + headless xterm
  → OUTPUT flows: PTY → headless xterm (for state) → framed stdout → SSH → Hub
  → INPUT flows: Hub → SSH → framed stdin → Agent → PTY
```

**Headless xterm.js (spike required):**
- Needs minimal DOM polyfill (jsdom or custom shim)
- Purpose: maintain accurate screen state for serialize()
- Serialize addon: produces string that can restore full terminal state in UI xterm.js
- **Spike success criteria:** polyfill bundle < 1 MB, serialize() < 100ms for 120×40 + 5000 scrollback
- **Fallback if spike fails:** skip serialize addon, use raw screen buffer capture (cursor position + visible lines only, no scrollback restoration). This degrades reconnect UX but unblocks MVP.

**Agent installation (MVP):**
- Agent is NOT auto-installed via npx in MVP (chicken-egg: package not yet published)
- MVP: hub runs `ssh user@host "nexterm-agent --stdio"` — agent must be pre-installed
- `scripts/install-agent.sh` copies agent build to remote via scp
- UI shows warning if agent not found: "nexterm-agent not found. [Install instructions]"
- P2: auto-install via bundled single-file binary (Node SEA)

### 3.3 Hub (`@nexterm/hub`)

Local daemon, single process, binds to 127.0.0.1.

**Responsibilities:**

**HTTP Server (single port, default 3100):**
- REST API: CRUD for hosts, sessions, channels, workspaces, config
- WebSocket upgrade on `/ws` path
- Static file serving for UI (production build)
- Health endpoint (`GET /api/health`)

**Session Manager:**
- Local sessions: spawn PTY directly via node-pty
- Remote sessions: open SSH via ssh2, launch agent, pipe stdio
- Session state machine: STARTING → ACTIVE ↔ DISCONNECTED → CLOSED, with DETACHED branch
- Reconnect: exponential backoff (1s, 2s, 4s, ... 30s max, 5min total timeout)
- Channel multiplexing: multiple PTYs per SSH connection

**Client Manager:**
- Track connected WS clients
- Auth: verify token on WS connect and REST requests
- Fanout: OUTPUT from one channel → all attached clients
- Write-lock: track who holds write per channel, handle claim/release/force

**Cache Manager:**
- Write-through: every OUTPUT chunk → spool.db
- Periodic snapshots: store serialized screen state
- Cache index: track last snapshot + last seq per channel
- GC: enforce retention policy (max age, max size per channel)
- Offline view: serve cached snapshot + tail when agent unreachable

**Config Resolver:**
- Layer 1: built-in defaults (code)
- Layer 2: ~/.config/nexterm/config.toml (user file)
- Layer 3: host.profile_json (meta.db)
- Layer 3.5: agent visual_hints (from HELLO, if trust policy allows)
- Layer 4: channel.profile_json (meta.db)
- Resolution: deep merge in order, last wins

**CLI:**
- `nexterm start` — start daemon (foreground or background)
- `nexterm stop` — stop daemon
- `nexterm status` — show daemon status, active sessions
- `nexterm host add|list|test|remove` — manage hosts
- `nexterm session list|attach` — manage sessions
- `nexterm workspace export|import` — workspace portability
- `nexterm config edit` — open config.toml in $EDITOR
- `nexterm pair` — generate pairing code for multi-device
- `nexterm decode` — decode MessagePack frames from stdin (debug tool)

### 3.4 Web Client (`@nexterm/web`)

Vue 3 SPA built with Vite. Served by hub in production, dev server in development.

**Layout — Discord-style 3-column:**

| Column | Width | Content |
|--------|-------|---------|
| Host rail | 48px | Host icons (auto-initial + color), status dots, settings, [+] add |
| Channel sidebar | ~200px | Channels grouped by user-defined categories, collapsible |
| Main area | Remaining | Tab bar + split terminal panes |

**Components:**
- `HostRail` — vertical icon list, click to select, right-click for settings
- `ChannelSidebar` — channels for selected host, grouped, drag-reorder
- `TabBar` — open channels as tabs, [+] new, right-click context menu
- `TerminalPane` — xterm.js instance, fit addon, badge overlay
- `PaneSplitter` — horizontal/vertical split, drag resize
- `CommandPalette` — Ctrl+P, fuzzy search hosts/channels/actions
- `AddHostDialog` — form: label, host, port, auth, icon, color
- `HostSettings` — connection, appearance, theme override, remote hints policy
- `SettingsOverlay` — global settings (theme, keybindings, hub config)
- `StatusBar` — session count, host count, hub health, current channel info

**Connection flow:**
1. UI loads → `fetch /api/health` to verify hub
2. WS connect to `/ws` with auth token
3. `fetch /api/hosts` → populate host rail
4. User selects host → `fetch /api/channels?hostId=X` → populate sidebar
5. User clicks channel → WS: ATTACH → receive SNAPSHOT → restore xterm → stream OUTPUT

**State management:**
- Pinia store for: hosts, sessions, channels, config, write-locks
- Reactive: WS messages update store → Vue reactivity updates UI
- Persistent: workspace layout saved to hub via REST on change

## 4. Entity Model

```
Host (permanent config)
 ├── id: ULID
 ├── type: 'local' | 'ssh'
 ├── label: string (unique)
 ├── sshConfig: { host, port, username, authMethod, keyPath? }
 ├── icon: { type: 'auto'|'emoji'|'image', value?: string }
 ├── color: string (hex, auto from label hash if null)
 ├── profile: TerminalProfile (layer 3 overrides)
 ├── trustRemoteHints: 'apply' | 'ask' | 'ignore'
 ├── defaultShell: string?
 ├── defaultCwd: string?
 ├── channelGroups: ChannelGroup[]
 └── sessions: Session[] (runtime)

ChannelGroup (organizational, per host)
 ├── id: ULID
 ├── hostId: FK → Host
 ├── name: string
 ├── sortOrder: number
 └── collapsed: boolean

Session (runtime, tied to connection)
 ├── id: ULID
 ├── hostId: FK → Host
 ├── status: 'starting' | 'active' | 'detached' | 'disconnected' | 'closed'
 ├── sshPid: number? (for remote)
 └── channels: Channel[]

Channel (PTY instance)
 ├── id: ULID
 ├── sessionId: FK → Session
 ├── groupId: FK → ChannelGroup?
 ├── title: string (user-editable, default: shell name)
 ├── shell: string
 ├── cwd: string
 ├── env: Record<string, string>
 ├── cols: number
 ├── rows: number
 ├── status: 'born' | 'live' | 'orphan' | 'dead'
 └── profile: TerminalProfile? (layer 4 overrides)

Workspace (layout persistence)
 ├── id: ULID
 ├── name: string (unique)
 └── layout: TabLayout (tree of tabs/panes/channels)

CacheIndex (per channel, hub-side)
 ├── channelId: FK → Channel
 ├── lastSnapshotChunkId: FK → Chunk?
 ├── lastSeq: number
 └── lastSeenAt: ISO timestamp

TerminalProfile (config override — used in layers 3 & 4)
 ├── fontFamily?: string
 ├── fontSize?: number
 ├── theme?: Record<string, string>   // color overrides
 ├── cursorStyle?: 'block' | 'underline' | 'bar'
 ├── scrollback?: number
 └── [key: string]: unknown            // extensible for future settings

TabLayout (workspace persistence)
 ├── type: 'tabs'
 └── tabs: TabEntry[]
     ├── channelId: string
     ├── label?: string
     └── panes?: PaneLayout
         ├── direction: 'horizontal' | 'vertical'
         ├── ratio: number              // 0–1 split ratio
         ├── first: PaneLayout | { channelId: string }
         └── second: PaneLayout | { channelId: string }
```

### 4.1 Naming Convention

All protocol messages use **snake_case** for field names (e.g., `channel_id`, `cursor_x`). TypeScript interfaces in `@nexterm/shared` use **camelCase** (e.g., `channelId`, `cursorX`). The MessagePack codec layer handles conversion at encode/decode boundaries.

### 4.2 State Transition Rules

**Session transitions:**

| From | To | Trigger |
|------|----|---------|
| starting | active | SSH connected + HELLO received (or local PTY spawned) |
| active | disconnected | SSH connection lost (ssh2 'close' event) |
| active | detached | All clients DETACH from all channels in session AND no channels LIVE |
| disconnected | active | SSH reconnect succeeds + HELLO received |
| disconnected | closed | Reconnect timeout (5 min) |
| detached | active | Any client sends ATTACH for a channel in this session |
| detached | closed | Session detach timeout (configurable, default 1h) |

**Channel transitions:**

| From | To | Trigger |
|------|----|---------|
| born | live | First client sends ATTACH for this channel |
| live | orphan | Last attached client DETACHes (PTY still running) |
| orphan | live | Client sends ATTACH |
| live | dead | Agent reports CHANNEL_EXIT (PTY process exited) |
| orphan | dead | Agent reports CHANNEL_EXIT or session CLOSED |

### 4.3 Local Host Initialization

On **first hub start** (meta.db is empty — schema_version table has version 1 but hosts table has 0 rows):

1. Hub creates a local host record: `{ type: 'local', label: 'local', icon_type: 'auto', color: null }`
2. This host appears in the host rail as the first entry (always present, cannot be deleted)
3. On first UI load with no active channels: auto-spawn a local shell channel and open it

### 4.4 Remote Visual Hints Lifecycle

Agent visual hints from HELLO are **ephemeral** (session-scoped, not persisted):

1. Agent sends HELLO with `visual_hints: { badge, theme_overlay }`
2. Hub stores hints **in memory** (on the Session object, not in DB)
3. Config resolver applies hints as Layer 3.5 for all channels of this session
4. On session CLOSED: hints are discarded
5. On SSH reconnect: agent sends new HELLO with fresh hints
6. Rationale: hints may change between agent restarts (e.g., load badge)

User-configured host overrides (Layer 3) are persistent in meta.db and are not affected by agent hints.

### 4.5 SSH Auth Method

Each host record specifies exactly one auth method via `ssh_auth` field (`'agent'`, `'key'`, `'password'`). There is **no fallback chain**. If the chosen method fails, the connection fails and the user must reconfigure.

- `agent`: use SSH_AUTH_SOCK (ssh-agent). Fail if agent unavailable.
- `key`: read private key from `ssh_key_path`. If passphrase-protected, prompt user via UI dialog.
- `password`: prompt user via UI dialog at connect time. **Never stored.**

### 4.6 Known Hosts Verification

On first SSH connect to an unknown host (fingerprint not in `~/.ssh/known_hosts`):

1. Hub receives fingerprint from ssh2 `hostVerifier` callback
2. Hub sends a UI notification: `{ type: "HOST_VERIFY", hostId, fingerprint, algorithm }`
3. UI shows modal: "Trust host fingerprint? [sha256:XXXX] — [Trust once] [Trust permanently] [Cancel]"
4. "Trust permanently": hub appends to `~/.ssh/known_hosts` + stores in meta.db hosts table
5. "Trust once": hub accepts for this session only
6. "Cancel": connection aborted, session CLOSED

## 5. Data Flow Diagrams

### 5.1 Local PTY — Input/Output

```
User types "ls\n"
  │
  UI: xterm.js onData("ls\n")
  │
  UI → Hub (WS): INPUT { channelId: "ch-1", data: [0x6c, 0x73, 0x0a] }
  │
  Hub: find channel ch-1, verify write-lock
  │
  Hub → PTY (node-pty): pty.write(data)
  │
  PTY → Hub: pty.onData(output)  // echoed input + command output
  │
  Hub: assign seqNo, write to spool.db (chunk)
  │
  Hub → ALL attached clients (WS): OUTPUT { channelId: "ch-1", seqNo: 42, ts, data }
  │
  UI: xterm.js terminal.write(data) → renders on screen
```

### 5.2 Remote PTY — Input/Output

```
User types "ls\n"
  │
  UI → Hub (WS): INPUT { channelId: "ch-1", data }
  │
  Hub: find channel → session → SSH connection
  │
  Hub → Agent (SSH stdio): [4-byte len][msgpack INPUT { channelId, data }]
  │
  Agent: find PTY for ch-1 → pty.write(data)
  │
  PTY → Agent: pty.onData(output)
  │
  Agent: feed output to headless xterm (for screen state)
  Agent → Hub (SSH stdio): [4-byte len][msgpack OUTPUT { channelId, seqNo, ts, data }]
  │
  Hub: write to spool.db (chunk), update cache_index
  │
  Hub → ALL attached clients (WS): OUTPUT { channelId, seqNo, ts, data }
  │
  UI: xterm.js terminal.write(data)
```

### 5.3 Attach + Snapshot Restore

```
Client connects, user clicks channel #bash (ORPHAN)
  │
  UI → Hub (WS): ATTACH { channelId: "ch-1" }
  │
  Hub: channel status ORPHAN → check if agent reachable
  │
  ┌─ Agent reachable:
  │  Hub → Agent: SNAPSHOT_REQ { channelId: "ch-1" }
  │  Agent → Hub: SNAPSHOT_RES { channelId, serialized, cols, rows, cursorX, cursorY }
  │  Hub: update cache (spool.db snapshot chunk + cache_index)
  │  Hub → UI: ATTACH_OK { channelId, snapshot, writeLockHolder, tailSinceSnapshot: [...] }
  │
  └─ Agent unreachable (cached mode):
     Hub: read last snapshot from spool.db
     Hub: read tail chunks since snapshot
     Hub → UI: ATTACH_OK { channelId, snapshot, writeLockHolder: null,
               tailSinceSnapshot: [...], cached: true }

UI: xterm.js restore snapshot → write tail chunks → channel LIVE (or cached READ-ONLY)
```

### 5.4 SSH Connection Lifecycle

```
User clicks [+ channel] on remote host
  │
  Hub: session exists for host?
  │
  ├─ No → create Session (STARTING)
  │  Hub: ssh2.connect(host.sshConfig)
  │  ├─ Success:
  │  │  ssh2.exec("nexterm-agent --stdio")
  │  │  Read HELLO from agent stdout
  │  │  Session → ACTIVE
  │  │  Proceed to SPAWN
  │  └─ Failure:
  │     Session → FAILED → CLOSED
  │     UI: error notification
  │
  └─ Yes (ACTIVE) → reuse SSH connection
     Hub → Agent: SPAWN { shell, cwd, env, cols, rows }
     Agent: spawn PTY, create headless xterm
     Agent → Hub: SPAWN_OK { channelId: "ch-new" }
     Hub: create Channel record (meta.db), status: BORN → LIVE
     Hub → UI: channel available, auto-ATTACH
```

### 5.5 Disconnect + Reconnect

```
SSH connection drops (network issue)
  │
  Hub: ssh2 'close' event
  Session → DISCONNECTED
  Hub → ALL clients: SESSION_STATE { sessionId, status: 'disconnected' }
  UI: overlay "Reconnecting..." on affected panes
  │
  Hub: reconnect loop (backoff: 1s, 2s, 4s, ... 30s cap)
  │
  ├─ SSH recovers:
  │  Agent HELLO → Hub checks channels
  │  ├─ Agent still running: ATTACH each channel → SNAPSHOT → delta to UI → LIVE
  │  └─ Agent restarted (reboot): channels DEAD, session CLOSED
  │
  └─ Timeout (5min): session CLOSED, channels DEAD
     UI: host icon 🔴, cached content still viewable
```

### 5.6 Write-Lock Flow

```
Channel ch-1: Client A = WRITER, Client B = READER

── Tier 1: Auto-release ──
A disconnects → lock freed → Hub broadcasts WRITE_LOCK { holder: null }
B sends WRITE_CLAIM → lock granted → Hub broadcasts WRITE_LOCK { holder: B }

── Tier 2: Request/Approve ──
B → Hub: WRITE_CLAIM
Hub → A: WRITE_REQUEST { from: B }
A → Hub: WRITE_GRANT { to: B }  (or WRITE_DENY)
Hub: transfer lock → broadcast WRITE_LOCK { holder: B }

── Tier 3: Force override ──
B → Hub: WRITE_FORCE
Hub: immediately transfer → A gets WRITE_REVOKED
Hub: broadcast WRITE_LOCK { holder: B }
```

## 6. Config Cascade

```
Layer 1: Built-in defaults (code)
  │ font: "monospace", fontSize: 14, theme: catppuccin-mocha
  │
Layer 2: ~/.config/nexterm/config.toml (user)
  │ Overrides: font, theme, keybindings, hub settings
  │
Layer 3: Host profile (meta.db hosts.profile_json)
  │ Overrides: theme colors, badge — per host
  │
Layer 3.5: Agent visual hints (from HELLO)
  │ Overrides: badge, theme_overlay — if trust policy = "apply"
  │
Layer 4: Channel profile (meta.db channels.profile_json)
  │ Overrides: any terminal setting — per channel
  ▼
Resolved config → xterm.js instance
```

**Deep merge:** Object keys merge recursively. Scalars overwrite. `null` removes key. Arrays replace.

## 7. File System Layout

```
~/.config/nexterm/
├── config.toml              # User preferences (layer 2)
├── auth.json                # { token: "crypto-random-hex" } (chmod 600)
└── data/
    ├── meta.db              # Hosts, sessions, channels, workspaces, groups
    ├── meta.db-wal
    ├── spool.db             # Output chunks, snapshots
    └── spool.db-wal
```

## 8. Monorepo Structure

### 8.1 npm Naming Strategy

| Package | npm name | Published? | Purpose |
|---------|----------|-----------|---------|
| Root | `nexterm` | Yes | CLI entrypoint (`npx nexterm`) |
| shared | `@nexterm/shared` | Yes | Types, codec, framing |
| agent | `@nexterm/agent` | Yes | Remote PTY manager (installed on remotes) |
| hub | `@nexterm/hub` | Yes | Local daemon (imported by root CLI) |
| web | `@nexterm/web` | No | Vue SPA (built + served by hub) |
| desktop | `@nexterm/desktop` | No (P1) | Tauri desktop app |

Root `nexterm` package is a thin CLI wrapper that depends on `@nexterm/hub`.
`npx nexterm` launches the hub daemon. `npx @nexterm/agent` is available for remote install.

### 8.2 Directory Layout

```
nexterm/
├── package.json             # nexterm (root CLI entrypoint)
├── pnpm-workspace.yaml
├── tsconfig.base.json       # Shared TS config (strict)
├── biome.json               # Linter/formatter config
├── docs/
│   ├── SPEC.md
│   ├── PROTOCOL.md
│   ├── STORAGE.md
│   ├── SECURITY.md
│   └── MVP_ROADMAP.md
├── packages/
│   ├── shared/              # @nexterm/shared — types, codec, framing
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts     # Barrel export
│   │       ├── protocol.ts  # Message types (discriminated unions)
│   │       ├── codec.ts     # MessagePack encode/decode + snake_case↔camelCase
│   │       ├── framing.ts   # Length-prefixed frame encoder/decoder
│   │       ├── config.ts    # Config types (TerminalProfile, TabLayout) + deep merge
│   │       ├── entities.ts  # Host, Session, Channel, Workspace, ChannelGroup
│   │       └── constants.ts # Protocol version, defaults, error codes
│   ├── agent/               # @nexterm/agent — remote PTY manager
│   │   ├── package.json
│   │   └── src/
│   │       ├── main.ts      # Entry point (--stdio flag)
│   │       ├── pty.ts       # PTY manager (node-pty wrapper)
│   │       ├── screen.ts    # Headless xterm.js screen model
│   │       ├── handler.ts   # Protocol message handler
│   │       └── config.ts    # Agent config (visual_hints)
│   ├── hub/                 # @nexterm/hub — local daemon
│   │   ├── package.json
│   │   └── src/
│   │       ├── main.ts      # Daemon start (exported for root CLI)
│   │       ├── server.ts    # HTTP + WS server (Fastify)
│   │       ├── api/         # REST route handlers
│   │       ├── ws/          # WS message handlers
│   │       ├── session/     # Session manager (local + SSH)
│   │       ├── ssh.ts       # SSH connection manager
│   │       ├── cache.ts     # Cache manager
│   │       ├── storage/     # SQLite DAL (meta.db + spool.db)
│   │       │   └── migrations/
│   │       │       ├── meta/    # 001-initial.sql, ...
│   │       │       └── spool/   # 001-initial.sql, ...
│   │       ├── config.ts    # Config resolver (4-layer cascade)
│   │       ├── auth.ts      # Token auth + pairing
│   │       └── cli.ts       # CLI commands (start, stop, host, pair, ...)
│   └── clients/
│       ├── web/             # @nexterm/web — Vue 3 SPA (MVP)
│       │   ├── package.json
│       │   ├── vite.config.ts
│       │   └── src/
│       │       ├── App.vue
│       │       ├── stores/      # Pinia (hosts, sessions, channels, config)
│       │       ├── composables/ # useTerminal, useWs, useConfig
│       │       ├── components/  # HostRail, ChannelSidebar, TerminalPane, ...
│       │       └── services/    # API client, WS client
│       └── desktop/         # @nexterm/desktop — Tauri v2 (P1, placeholder)
│           └── README.md
└── scripts/
    ├── dev.sh               # Start hub + web dev servers
    └── install-agent.sh     # Install agent on remote via SSH
```

### 8.3 Dependency Graph

```
nexterm (root CLI)
  └── @nexterm/hub
        ├── @nexterm/shared
        ├── @nexterm/web (build output embedded as static files)
        ├── better-sqlite3
        ├── ssh2
        ├── node-pty
        └── fastify + @fastify/websocket

@nexterm/agent
  ├── @nexterm/shared
  ├── node-pty
  └── xterm-headless + @xterm/addon-serialize

@nexterm/web
  ├── @nexterm/shared (types only, tree-shaken)
  ├── vue 3
  ├── pinia
  ├── xterm + @xterm/addon-fit + @xterm/addon-serialize
  └── @msgpack/msgpack

@nexterm/desktop (P1)
  └── @nexterm/web (embedded in Tauri webview)
```

## 9. Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js ≥ 20 LTS | Hub + Agent |
| Language | TypeScript (strict) | All packages |
| Monorepo | pnpm workspaces | Package management |
| PTY | node-pty | Terminal spawn/resize |
| SSH | ssh2 | Remote connections |
| Terminal (UI) | xterm.js + addon-fit + addon-serialize | Rendering + restore |
| Terminal (Agent) | xterm.js headless + addon-serialize | Screen model |
| Codec | @msgpack/msgpack | Binary protocol framing |
| Storage | better-sqlite3 | SQLite WAL persistence |
| HTTP/WS | Fastify + @fastify/websocket | REST + WS server |
| UI Framework | Vue 3 (Composition API) | Reactive UI |
| UI Build | Vite | Dev + production build |
| UI State | Pinia | Store management |
| Config parse | @iarna/toml | TOML config file |
| IDs | ulid | Sortable unique IDs |
| Desktop (P1) | Tauri v2 | Optional packaging |

## 10. Cross-Cutting Concerns

### 10.1 Observability

- Structured JSON logs, one line per event
- Trace IDs: `sid:<session-id>` and `cid:<channel-id>` prefixes
- Log levels: trace, debug, info, warn, error
- Health: `GET /api/health` → `{ status, uptime, sessions, channels, spool_size_bytes }`

### 10.2 Error Handling

- Hub: never crash on client error — log + respond ERROR message
- Agent crash: hub detects SSH close → reconnect loop
- SSH: try/catch with structured errors, retry with backoff
- Storage: WAL handles concurrency; busy_timeout for lock contention

### 10.3 Platform Support

| Platform | Hub | Agent | UI |
|----------|:---:|:-----:|:--:|
| Linux x64 | ✅ | ✅ | ✅ |
| macOS arm64/x64 | ✅ | ✅ | ✅ |
| Windows x64 | ✅ | ❌ (WSL) | ✅ |
| WSL | ✅ | ✅ | ✅ |

Windows hub spawns local PTYs for: PowerShell, cmd, wsl.exe.
Agent on Windows not supported MVP (use WSL).
