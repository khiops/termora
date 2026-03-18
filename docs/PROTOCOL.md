# nexterm — Protocol Specification

> Version: 1 (MVP)
> Status: draft
> Last updated: 2026-03-18

## 1. Framing

All messages (hub↔agent and hub↔UI) use the same framing:

```
┌────────────────┬──────────────────────────────┐
│ 4 bytes LE     │ MessagePack payload          │
│ (payload len)  │ (variable length)            │
└────────────────┴──────────────────────────────┘
```

- **Length prefix:** 4 bytes, little-endian unsigned 32-bit integer
- **Max frame size:** 10 MB (hard limit, reject larger)
- **Payload:** MessagePack-encoded object with `type` field (string)

### 1.1 Why MessagePack

- Native Uint8Array support (no base64 for terminal output)
- ~30% smaller than JSON for binary-heavy payloads
- Same schema flexibility as JSON (no code generation)
- Library: `@msgpack/msgpack`

### 1.2 Frame Reading

```
1. Read 4 bytes → payloadLength (LE uint32)
2. If payloadLength > 10MB → protocol error, close
3. Read payloadLength bytes → payload
4. Decode as MessagePack → message object
5. Dispatch on message.type
```

### 1.3 Debugging

```bash
# Decode frames from a capture file
npx nexterm decode < capture.bin

# Pipe SSH stdio through decoder
ssh user@host "nexterm-agent --stdio" | npx nexterm decode --hex
```

## 2. Transport Layers

### 2.1 Hub ↔ Agent (stdio — SSH or local child process)

```
Hub ──── ssh2 session / child_process ──── Agent
             │                                │
             │ stdin  ◄────── framed messages ──────► stdout
             │                (MessagePack)
             │ stderr ──────  log output (text, not framed)
```

- Agent reads frames from stdin, writes frames to stdout
- stderr reserved for log output (not parsed by hub)
- SSH close = agent gone → hub enters reconnect loop

### 2.1b Hub ↔ Agent (UDS — daemon mode)

```
Hub ──── Unix domain socket / named pipe ──── Agent (daemon)
                    │                              │
                    │ bidirectional framed messages │
                    │ (MessagePack, same framing)   │
```

- Agent runs as a standalone daemon: `nexterm-agent --daemon --socket <path>`
- Hub connects to the UDS via `connectOrLaunch(socketPath, config, binaryPath)`
- Same length-prefixed MessagePack framing as stdio
- Connection displacement: new hub connection immediately replaces the previous one (last-writer-wins)
- Agent buffers output while no hub is connected (`OutputBuffer` ring buffer)
- On reconnect: agent sends HELLO, then enumerates channel state (see section 3.12)

### 2.2 Hub ↔ UI (WebSocket)

```
UI ──── ws://localhost:4100/ws ──── Hub
             │                         │
             │ binary WS frames        │
             │ (one frame = one msg)   │
```

- WS binary mode (opcode 0x02)
- Each WS message = one MessagePack-encoded message (no length prefix needed)
- First message must be AUTH with valid token

### 2.3 Hub ↔ UI (REST)

Standard HTTP JSON API for CRUD. See section 6.

## 3. Message Types — Hub ↔ Agent

### 3.1 HELLO (Agent → Hub)

First message, sent immediately on start.

```typescript
{
  type: "HELLO",
  version: 1,
  agent_version: "0.1.0",
  capabilities: ["multiplex", "snapshot", "resize"],
  visual_hints?: {
    badge?: { text: string, color: string },
    theme_overlay?: Record<string, string>
  }
}
```

**Capability handling:** Hub checks `capabilities` array. If `"snapshot"` is missing, hub will not send SNAPSHOT_REQ (relies on local cache only). If `"resize"` is missing, hub skips RESIZE messages. All capabilities are optional — hub degrades gracefully. `"multiplex"` means agent supports multiple channels per process.

### 3.2 SPAWN / SPAWN_OK / SPAWN_ERR

```typescript
// Hub → Agent
{
  type: "SPAWN",
  request_id: string,
  channel_id?: string,  // hub-provided ID for warm restart; if omitted, agent generates one
  shell: string,        // "/bin/bash"
  cwd: string,
  env: Record<string, string>,
  cols: number,         // terminal columns; defaults to 80
  rows: number          // terminal rows; defaults to 24
}

// Agent → Hub (success)
{
  type: "SPAWN_OK",
  request_id: string,
  channel_id: string
}

// Agent → Hub (failure)
{
  type: "SPAWN_ERR",
  request_id: string,
  code: string,         // "SHELL_NOT_FOUND", "PERMISSION_DENIED"
  message: string
}
```

### 3.3 ATTACH / ATTACH_OK

Re-attach to existing channel (after reconnect).

```typescript
// Hub → Agent
{ type: "ATTACH", channel_id: string }

// Agent → Hub
{
  type: "ATTACH_OK",
  channel_id: string,
  snapshot: {
    serialized: string,
    cols: number,
    rows: number,
    cursor_x: number,
    cursor_y: number
  },
  last_seq: number
}
```

### 3.4 INPUT (Hub → Agent)

```typescript
{
  type: "INPUT",
  channel_id: string,
  data: Uint8Array       // raw bytes
}
```

### 3.5 OUTPUT (Agent → Hub)

```typescript
{
  type: "OUTPUT",
  channel_id: string,
  seq: number,           // monotonically increasing per channel
  ts: string,            // ISO 8601
  data: Uint8Array       // raw terminal output (ANSI included)
}
```

**Batching:** Buffer 16ms or 4KB, whichever comes first, then flush.

### 3.6 RESIZE (Hub → Agent)

```typescript
{ type: "RESIZE", channel_id: string, cols: number, rows: number }
```

Agent MUST: pty.resize() AND headless xterm.resize().

### 3.7 SNAPSHOT_REQ / SNAPSHOT_RES

```typescript
// Hub → Agent
{ type: "SNAPSHOT_REQ", channel_id: string }

// Agent → Hub
{
  type: "SNAPSHOT_RES",
  channel_id: string,
  snapshot: { serialized: string, cols: number, rows: number,
              cursor_x: number, cursor_y: number },
  last_seq: number
}
```

### 3.8 CHANNEL_EXIT (Agent → Hub)

```typescript
{
  type: "CHANNEL_EXIT",
  channel_id: string,
  exit_code: number,
  signal?: string        // "SIGTERM", "SIGKILL"
}
```

### 3.9 DESTROY (Hub → Agent)

```typescript
{ type: "DESTROY", channel_id: string }
```

### 3.10 HEARTBEAT

```typescript
{ type: "HEARTBEAT", ts: string }      // Hub → Agent
{ type: "HEARTBEAT_ACK", ts: string }  // Agent → Hub
```

Interval: 15s. 3 consecutive misses (45s) → agent unresponsive.

### 3.11 ERROR

```typescript
{
  type: "ERROR",
  code: string,
  message: string,
  channel_id?: string
}
```

### 3.12 TITLE_CHANGE (Agent → Hub)

Terminal title changed via OSC 0/2 escape sequence. Hub relays to all attached UI clients.

```typescript
{
  type: "TITLE_CHANGE",
  channel_id: string,
  title: string,          // sanitized by agent
  display_title?: string  // formatted version (e.g. with host prefix)
}
```

### 3.13 PROCESS_TITLE (Agent → Hub)

Foreground process name changed (polled from PTY PID). Hub relays to all attached UI clients.

```typescript
{
  type: "PROCESS_TITLE",
  channel_id: string,
  title: string,
  display_title?: string
}
```

### 3.14 BELL (Agent → Hub)

Terminal bell character (`\x07`) received. Hub relays to all attached UI clients.

```typescript
{ type: "BELL", channel_id: string }
```

### 3.15 NOTIFICATION (Agent → Hub)

OSC 9 desktop notification request. Hub relays to all attached UI clients.

```typescript
{
  type: "NOTIFICATION",
  channel_id: string,
  message: string
}
```

### 3.16 AGENT_CHANNEL_STATE / CHANNEL_STATE_END (Daemon Reconnect)

Sent by the agent to the hub immediately after HELLO when reconnecting to a daemon that has existing channels. The agent enumerates all known channels (alive and dead), then signals the end of enumeration.

```typescript
// Agent → Hub (one per channel)
{
  type: "AGENT_CHANNEL_STATE",
  channel_id: string,
  title: string,
  pid: number,           // OS process ID of the PTY (0 if dead)
  alive: boolean         // true = PTY still running, false = exited
}

// Agent → Hub (signals end of enumeration)
{
  type: "CHANNEL_STATE_END"
}
```

**Reconnect handshake flow (daemon mode):**
```
Hub connects to daemon UDS
  │
  Agent → Hub: HELLO { protocol_version, capabilities, ... }
  Agent → Hub: AGENT_CHANNEL_STATE { channel_id: "ch-1", title: "bash", pid: 4521, alive: true }
  Agent → Hub: AGENT_CHANNEL_STATE { channel_id: "ch-2", title: "vim", pid: 0, alive: false }
  Agent → Hub: CHANNEL_STATE_END
  │
  Hub: reconcileChannelState()
    ├─ ch-1 (alive) → adopt into session, re-attach, resume OUTPUT
    └─ ch-2 (dead) → mark dead in DB, notify UI CHANNEL_STATE { status: "dead" }
  │
  Normal operation (SPAWN, INPUT, OUTPUT, etc.)
```

On a fresh daemon start (no prior channels), the agent sends HELLO followed immediately by CHANNEL_STATE_END (zero AGENT_CHANNEL_STATE messages).

## 4. Message Types — Hub ↔ UI (WS)

### 4.1 AUTH

```typescript
// UI → Hub (must be first message)
{ type: "AUTH", token: string }

// Hub → UI
{ type: "AUTH_OK", client_id: string }
{ type: "AUTH_FAIL", message: string }
```

### 4.2 ATTACH / ATTACH_OK / DETACH

```typescript
// UI → Hub
{ type: "ATTACH", channel_id: string }

// Hub → UI
{
  type: "ATTACH_OK",
  channel_id: string,
  snapshot: { serialized, cols, rows, cursor_x, cursor_y } | null,
  tail: Uint8Array[],          // output since last snapshot
  write_lock_holder: string | null,
  cached: boolean              // true = from local cache, agent unreachable
}

// UI → Hub
{ type: "DETACH", channel_id: string }
```

### 4.3 INPUT / OUTPUT / RESIZE

Same as agent messages (section 3.4–3.6).
Hub verifies write-lock on INPUT. Rejects with ERROR if not holder.
Hub broadcasts RESIZE to other attached clients.

### 4.4 SPAWN / SPAWN_OK

```typescript
// UI → Hub
{
  type: "SPAWN",
  host_id: string,
  shell?: string,     // default: host.default_shell ?? system default (/bin/bash or pwsh)
  cwd?: string,       // default: host.default_cwd ?? user home dir
  env?: Record<string, string>,  // merged with system env (max 100 entries)
  group_id?: string   // optional channel group to place new channel in
}

// Hub → UI
{ type: "SPAWN_OK", channel_id: string, host_id: string, session_id: string }
```

### 4.5 Write-Lock Messages

```typescript
{ type: "WRITE_CLAIM",    channel_id: string }
{ type: "WRITE_RELEASE",  channel_id: string }
{ type: "WRITE_FORCE",    channel_id: string }

// Hub → current writer: someone requests
{ type: "WRITE_REQUEST",  channel_id: string, from_client_id: string }

// Writer → Hub: response
{ type: "WRITE_GRANT",    channel_id: string, to_client_id: string }
{ type: "WRITE_DENY",     channel_id: string, to_client_id: string }

// Hub → previous writer: lock taken away
{ type: "WRITE_REVOKED",  channel_id: string }

// Hub → ALL on channel: lock state broadcast
{ type: "WRITE_LOCK",     channel_id: string, holder: string | null }
```

### 4.6 STATE_SYNC (Hub → UI)

Sent immediately after `AUTH_OK`. Full snapshot of all active sessions and channels so the UI can hydrate without polling.

```typescript
{
  type: "STATE_SYNC",
  sessions: Array<{
    session_id: string,
    host_id: string,
    status: "starting" | "active" | "detached" | "disconnected" | "closed"
  }>,
  channels: Array<{
    channel_id: string,
    session_id: string,
    status: "born" | "live" | "orphan" | "dead",
    exit_code?: number,
    display_title?: string
  }>
}
```

### 4.7 State Notifications

```typescript
{
  type: "SESSION_STATE",
  session_id: string,
  host_id: string,
  status: "starting" | "active" | "detached" | "disconnected" | "closed"
}

{
  type: "CHANNEL_STATE",
  channel_id: string,
  session_id: string,
  status: "born" | "live" | "orphan" | "dead",
  exit_code?: number
}
```

### 4.8 PING / PONG

```typescript
{ type: "PING" }
{ type: "PONG" }
```

Interval: 30s. 2 misses (60s) → client disconnected.

### 4.9 HOST_VERIFY (SSH Fingerprint)

```typescript
// Hub → UI (unknown host key, or key mismatch warning)
{
  type: "HOST_VERIFY",
  host_id: string,
  fingerprint: string,         // "sha256:XXXXXXXXXXXX"
  algorithm: string,           // "ssh-ed25519", "ssh-rsa"
  old_fingerprint?: string,    // set when stored key differs — MITM warning
  prompt_id?: string           // correlation ID; must be echoed in response for mismatch prompts
}

// UI → Hub (user decision)
{
  type: "HOST_VERIFY_RESPONSE",
  host_id: string,
  action: "trust_permanent" | "trust_once" | "reject",
  prompt_id?: string           // must match HOST_VERIFY.prompt_id when responding to a mismatch
}
```

### 4.10 AUTH_PROMPT / AUTH_PROMPT_RESPONSE (SSH Credentials)

Used when the hub needs to obtain a secret from the user interactively during SSH connection (password auth, key passphrase, or elevation prompt).

```typescript
// Hub → UI
{
  type: "AUTH_PROMPT",
  host_id: string,
  prompt_type: "password" | "passphrase" | "elevation",
  message: string    // human-readable prompt text (e.g. "Enter password for user@host")
}

// UI → Hub
{
  type: "AUTH_PROMPT_RESPONSE",
  host_id: string,
  secret: string | null    // null = user cancelled
}
```

**Security note:** The secret is never persisted — it is used once for the SSH handshake then discarded.

### 4.11 TEST_CONNECT (SSH Connectivity Test)

Allows the UI to test SSH connectivity for a host without creating a full session. The hub may send `AUTH_PROMPT` messages during the test if credentials are needed.

```typescript
// UI → Hub
{
  type: "TEST_CONNECT",
  host_id: string,       // real host ID for saved hosts, client-generated temp ID for unsaved
  hostname: string,
  port: number,
  ssh_auth: "agent" | "key" | "password",
  ssh_key_path?: string,
  ssh_user?: string
}

// Hub → UI (success)
{ type: "TEST_CONNECT_OK", host_id: string }

// Hub → UI (failure)
{ type: "TEST_CONNECT_FAIL", host_id: string, message: string }
```

### 4.12 Terminal Event Relay (Hub → UI)

These messages originate from the agent (see §3.12–3.15, above) and are relayed by the hub to all UI clients attached to the affected channel.

```typescript
// Terminal title changed (OSC 0/2)
{ type: "TITLE_CHANGE",   channel_id: string, title: string, display_title?: string }

// Foreground process name changed
{ type: "PROCESS_TITLE",  channel_id: string, title: string, display_title?: string }

// Terminal bell (\x07)
{ type: "BELL",           channel_id: string }

// OSC 9 desktop notification
{ type: "NOTIFICATION",   channel_id: string, message: string }
```

### 4.13 ERROR

```typescript
{ type: "ERROR", code: string, message: string, channel_id?: string }
```

**Error codes:**

| Code | Meaning |
|------|---------|
| `AUTH_REQUIRED` | No AUTH sent yet |
| `AUTH_INVALID` | Bad token |
| `CHANNEL_NOT_FOUND` | Unknown channel ID |
| `NOT_ATTACHED` | Op requires ATTACH first |
| `WRITE_LOCK_HELD` | INPUT rejected, not the writer |
| `HOST_NOT_FOUND` | Unknown host ID |
| `SSH_FAILED` | SSH connection failed |
| `AGENT_ERROR` | Agent returned error |
| `FRAME_TOO_LARGE` | Payload > 10 MB |
| `PROTOCOL_ERROR` | Malformed message |

## 5. Protocol Sequences

### 5.1 Local Session

```
UI                          Hub
 │── AUTH ──────────────────►│
 │◄── AUTH_OK ──────────────│
 │── SPAWN {host:"local"} ─►│── spawn PTY
 │◄── SPAWN_OK {ch_id} ────│
 │── ATTACH {ch_id} ───────►│
 │◄── ATTACH_OK {snapshot} ─│
 │── INPUT {data} ──────────►│── pty.write()
 │                           │◄── pty.onData()
 │◄── OUTPUT {data} ────────│
 │── RESIZE {cols,rows} ───►│── pty.resize()
 │── DETACH ────────────────►│── channel → ORPHAN
```

### 5.2 Remote Session

```
UI                          Hub                        Agent
 │── AUTH ──────────────────►│                           │
 │◄── AUTH_OK ──────────────│                           │
 │── SPAWN {host:"prod"} ──►│── ssh2.connect() ────────►│
 │                           │◄── HELLO {hints} ────────│
 │                           │── SPAWN {shell} ─────────►│
 │                           │◄── SPAWN_OK {ch_id} ─────│
 │◄── SPAWN_OK ─────────────│                           │
 │── ATTACH ────────────────►│── SNAPSHOT_REQ ──────────►│
 │                           │◄── SNAPSHOT_RES ──────────│
 │◄── ATTACH_OK ────────────│                           │
 │── INPUT ─────────────────►│── INPUT ─────────────────►│
 │                           │◄── OUTPUT ────────────────│
 │◄── OUTPUT ────────────────│                           │
```

### 5.3 Reconnect After SSH Drop

```
Hub                        Agent
 │ ×× SSH drops ×× ─────────│ (agent keeps PTYs)
 │── retry 1s ───────────►  fail
 │── retry 2s ───────────►  fail
 │── retry 4s ───────────►  success
 │◄── HELLO ─────────────────│
 │── ATTACH {ch-1} ─────────►│
 │◄── ATTACH_OK {snapshot} ──│
 │── ATTACH {ch-2} ─────────►│
 │◄── ATTACH_OK {snapshot} ──│
 │  (resume OUTPUT)           │
```

### 5.4 Daemon Reconnect (Hub Restart)

```
Hub                        Agent (daemon, has channels)
 │── connect to UDS ───────►│
 │◄── HELLO ─────────────────│
 │◄── AGENT_CHANNEL_STATE ───│ (ch-1, alive)
 │◄── AGENT_CHANNEL_STATE ───│ (ch-2, alive)
 │◄── AGENT_CHANNEL_STATE ───│ (ch-3, dead)
 │◄── CHANNEL_STATE_END ─────│
 │  reconcile: adopt ch-1,2; mark ch-3 dead
 │── SPAWN (new channel) ───►│
 │◄── SPAWN_OK ──────────────│
 │  (normal operation)        │
```

### 5.5 Write-Lock Transfer

```
Client A (WRITER)           Hub                Client B (READER)
 │                           │◄── WRITE_CLAIM ──────────│
 │◄── WRITE_REQUEST {B} ────│                           │
 │── WRITE_GRANT {B} ───────►│                           │
 │                           │── WRITE_LOCK {B} ───────►│
 │◄── WRITE_LOCK {B} ───────│                           │
 │  (now READER)             │            (now WRITER)   │
```

## 6. REST API

Base: `http://localhost:4100/api`
Auth: `Authorization: Bearer <token>` (except `/health`).

### Endpoints

Auth column: `●` = `Authorization: Bearer <token>` required, `○` = unauthenticated.

#### Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/health` | ○ | `{ status, version, uptime }` |

#### Hosts

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/hosts` | ● | `Host[]` |
| POST | `/api/hosts` | ● | CreateHost → `Host` (201) |
| PUT | `/api/hosts/reorder` | ● | `{ group_id, host_ids }` → 204 |
| GET | `/api/hosts/:id` | ● | `Host` |
| PUT | `/api/hosts/:id` | ● | UpdateHost → `Host` (partial update, deep merge) |
| DELETE | `/api/hosts/:id` | ● | 204 |
| POST | `/api/hosts/:id/duplicate` | ● | → `Host` (201) |
| PUT | `/api/hosts/:id/welcome` | ● | `{ channel_id }` → 200 |
| DELETE | `/api/hosts/:id/welcome` | ● | 204 |
| GET | `/api/hosts/:id/profiles` | ● | `LaunchProfile[]` (query: `?os=linux\|darwin\|windows`) |
| PUT | `/api/hosts/:id/profiles/:profileId` | ● | `{ override_type, sort_order? }` → 204 |
| DELETE | `/api/hosts/:id/profiles/:profileId` | ● | 204 |

#### SSH Config Import

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/ssh-config` | ● | `{ entries, has_include }` — parses `~/.ssh/config` |
| POST | `/api/hosts/import` | ● | `{ entries: SshConfigImport[] }` → `Host[]` (201) |

#### Sessions

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/sessions` | ● | `Session[]` (query: `?host_id=X`) |
| GET | `/api/sessions/:id` | ● | `Session` (includes channels) |
| DELETE | `/api/sessions/:id` | ● | 204 (close) |

#### Channels

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/channels` | ● | `Channel[]` (query: `?host_id=X`) |
| GET | `/api/channels/:id` | ● | `Channel` |
| PATCH | `/api/channels/:id` | ● | Partial update (e.g. title) → `Channel` |
| POST | `/api/channels/:id/restart` | ● | Restart dead channel → 200 |
| DELETE | `/api/channels/:id` | ● | 204 |
| POST | `/api/channels/purge-dead` | ● | Remove all dead channels → `{ count }` |

#### Channel Groups (tab groups)

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/groups` | ● | `Group[]` |
| POST | `/api/groups` | ● | CreateGroup → `Group` (201) |
| PUT | `/api/groups/reorder` | ● | `{ group_ids }` → 204 |
| PATCH | `/api/groups/:id` | ● | UpdateGroup → `Group` |
| DELETE | `/api/groups/:id` | ● | 204 |

#### Host Groups

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/host-groups` | ● | `HostGroup[]` |
| POST | `/api/host-groups` | ● | CreateHostGroup → `HostGroup` (201) |
| PUT | `/api/host-groups/reorder` | ● | `{ group_ids }` → 204 |
| PUT | `/api/host-groups/:id` | ● | UpdateHostGroup → `HostGroup` |
| DELETE | `/api/host-groups/:id` | ● | 204 |

#### Launch Profiles

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/launch-profiles` | ● | `LaunchProfile[]` |
| POST | `/api/launch-profiles` | ● | CreateLaunchProfile → `LaunchProfile` (201) |
| POST | `/api/launch-profiles/reorder` | ● | `{ profile_ids }` → 204 |
| GET | `/api/launch-profiles/:id` | ● | `LaunchProfile` |
| PUT | `/api/launch-profiles/:id` | ● | UpdateLaunchProfile → `LaunchProfile` |
| DELETE | `/api/launch-profiles/:id` | ● | 204 |

#### Configuration

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/config/defaults` | ● | Layer 1 built-in defaults |
| GET | `/api/config/ui` | ● | UI behavioral config |
| GET | `/api/config/resolved` | ● | Merged config (query: `?host_id=X&channel_id=Y&session_id=Z`) |
| GET | `/api/config/cascade` | ● | Full 4-layer cascade (query: `?host_id=X&channel_id=Y`) |
| PUT | `/api/config/global` | ● | `{ terminal: {...} }` → `{ ok }` |
| PUT | `/api/config/ui` | ● | `{ <section>: { <key>: value } }` → `{ ok }` |
| PUT | `/api/config/appearance` | ● | `{ theme?, autoSwitch?, ... }` → `{ ok }` |
| GET | `/api/config/elevation` | ● | Current elevation config |
| PUT | `/api/config/elevation` | ● | `{ methodLinux?, methodDarwin?, ... }` → `{ ok }` |
| GET | `/api/hosts/:id/profile` | ● | `{ profile: object }` — raw host Layer 3 profile |
| PATCH | `/api/hosts/:id/profile` | ● | `{ profile: object }` — merge into host Layer 3 profile |
| GET | `/api/channels/:id/profile` | ● | `{ profile: object }` — raw channel Layer 4 profile |
| PATCH | `/api/channels/:id/profile` | ● | `{ profile: object }` — merge into channel Layer 4 profile |

#### Fonts

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/fonts` | ○ | `FontFamily[]` — scans system + user font dirs |

#### Themes

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/themes` | ● | `Theme[]` (built-in + user) |
| GET | `/api/themes/:name` | ● | `Theme` |
| POST | `/api/themes` | ● | CreateTheme → `Theme` (201) |
| PUT | `/api/themes/:name` | ● | UpdateTheme → `Theme` |
| DELETE | `/api/themes/:name` | ● | 204 |

#### Wallpapers

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| GET | `/api/wallpapers` | ○ | `WallpaperFile[]` — user wallpapers |
| POST | `/api/wallpapers` | ● | multipart upload → `{ filename }` (201) |
| DELETE | `/api/wallpapers/:filename` | ● | 204 |

#### Pairing

| Method | Path | Auth | Body / Notes |
|--------|------|------|--------------|
| POST | `/api/pair` | ● | — → `{ code, expires_at }` (201); max 3 active codes |
| POST | `/api/pair/verify` | ○ | `{ code }` → `{ token }` |

#### Static Assets (served by @fastify/static)

| Prefix | Source | Notes |
|--------|--------|-------|
| `/public/fonts/` | `~/.config/nexterm/fonts/` | User custom fonts (unauthenticated) |
| `/public/sounds/` | `~/.config/nexterm/sounds/` | User custom bell sounds (unauthenticated) |
| `/public/wallpapers/` | `~/.config/nexterm/wallpapers/` | User wallpapers (unauthenticated) |
| `/` (fallback) | `static/` dir or SEA blob | Web UI bundle (unauthenticated) |

### Request/Response Body Schemas

**CreateHost:**
```typescript
{
  type: 'local' | 'ssh',             // required
  label: string,                      // required, 1-64 chars, alphanumeric + dot/dash/underscore, unique
  ssh_host?: string,                  // required if type=ssh, "hostname" or "ip"
  ssh_port?: number,                  // default 22, range 1-65535
  ssh_user?: string,                  // SSH username
  ssh_auth?: 'agent' | 'key' | 'password',  // required if type=ssh
  ssh_key_path?: string,              // required if ssh_auth=key
  ssh_config_host?: string,           // Host alias from ~/.ssh/config
  icon_type?: 'auto' | 'emoji' | 'image',   // default 'auto'
  icon_value?: string,                // emoji char or image path
  color?: string,                     // hex "#rrggbb" or null for auto
  default_shell?: string,
  default_cwd?: string,
  trust_remote_hints?: 'apply' | 'ask' | 'ignore',  // default 'apply'
  host_group?: string,                // group name (legacy)
  host_group_id?: string,             // host group ID
  keep_alive_seconds?: number,        // SSH keepalive interval
  history_retention_days?: number,    // spool retention
  profile_json?: string | object,     // host-level terminal profile (Layer 3)
  elevation_method?: string,          // e.g. "sudo", "doas", "pkexec", "gsudo"
  custom_command?: string,            // custom SSH/connect command template
  os?: 'linux' | 'darwin' | 'windows' | null,
  arch?: 'x64' | 'arm64' | null
}
```

**UpdateHost:** Same fields as CreateHost, all optional (partial update, deep merge).

**CreateGroup:** (tab channel groups)
```typescript
{
  name: string,                 // required, 1-64 chars
  sort_order?: number           // default 0
}
```

**UpdateGroup:**
```typescript
{
  name?: string,
  sort_order?: number,
  collapsed?: boolean
}
```

**CreateHostGroup:**
```typescript
{
  name: string,                 // required, 1-64 chars
  sort_order?: number
}
```

**UpdateHostGroup:**
```typescript
{
  name?: string,
  sort_order?: number,
  collapsed?: boolean
}
```

**CreateLaunchProfile:**
```typescript
{
  name: string,                 // required, 1-64 chars, unique
  shell?: string,               // shell binary path
  args?: string[],              // shell arguments
  cwd?: string,                 // working directory
  env?: Record<string, string>, // environment variables (values masked in responses)
  description?: string,
  color?: string,               // hex "#rrggbb"
  icon?: string,                // emoji
  os_filter?: 'linux' | 'darwin' | 'windows' | null,
  sort_order?: number
}
```

**UpdateLaunchProfile:** Same fields as CreateLaunchProfile, all optional.

**Error responses:**
```typescript
// All non-2xx responses return:
{
  error: string,                // machine-readable code (e.g., "NOT_FOUND", "VALIDATION_ERROR")
  message: string               // human-readable description
}
```

### Agent Error Codes

Complete list of codes returned in SPAWN_ERR and ERROR messages:

| Code | Origin | Meaning |
|------|--------|---------|
| `SHELL_NOT_FOUND` | Agent | Shell binary not found at path |
| `PERMISSION_DENIED` | Agent | Cannot spawn PTY (user/cgroup restriction) |
| `PTY_SPAWN_FAILED` | Agent | node-pty.spawn() threw (generic) |
| `CHANNEL_LIMIT` | Agent | Max channels reached (default 50 per agent) |
| `CHANNEL_NOT_FOUND` | Agent | ATTACH/INPUT for unknown channel_id |
| `INVALID_MESSAGE` | Both | Unrecognized or malformed message |
| `VERSION_MISMATCH` | Hub | Agent protocol version too new |

### Pairing Code Format

- 6 numeric digits (`0-9`), leading zeros allowed (e.g., `007293`)
- Generated via `crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')`
- Expires: ISO 8601 timestamp, 60 seconds from creation

## 7. Version Negotiation

HELLO includes `version: 1`. Hub checks:

| Agent | Hub | Result |
|:-----:|:---:|--------|
| 1 | 1 | Compatible |
| 1 | 2 | Hub downgrades to v1 |
| 2 | 1 | Hub sends ERROR, closes |

Unknown message types MUST be ignored (forward compatibility).
