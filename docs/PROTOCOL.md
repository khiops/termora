# nexterm — Protocol Specification

> Version: 1 (MVP)
> Status: draft
> Last updated: 2026-03-02

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

### 2.1 Hub ↔ Agent (SSH stdio)

```
Hub ──── ssh2 session ──── Agent
             │                │
             │ stdin  ◄────── framed messages ──────► stdout
             │                (MessagePack)
             │ stderr ──────  log output (text, not framed)
```

- Agent reads frames from stdin, writes frames to stdout
- stderr reserved for log output (not parsed by hub)
- SSH close = agent gone → hub enters reconnect loop

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
  shell: string,        // "/bin/bash"
  cwd: string,
  env: Record<string, string>,
  cols: number,
  rows: number
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

### 4.6 State Notifications

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

### 4.7 PING / PONG

```typescript
{ type: "PING" }
{ type: "PONG" }
```

Interval: 30s. 2 misses (60s) → client disconnected.

### 4.8 HOST_VERIFY (SSH Fingerprint)

```typescript
// Hub → UI (unknown host fingerprint)
{
  type: "HOST_VERIFY",
  host_id: string,
  fingerprint: string,         // "sha256:XXXXXXXXXXXX"
  algorithm: string            // "ssh-ed25519", "ssh-rsa"
}

// UI → Hub (user decision)
{
  type: "HOST_VERIFY_RESPONSE",
  host_id: string,
  action: "trust_permanent" | "trust_once" | "reject"
}
```

### 4.9 ERROR

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

### 5.4 Write-Lock Transfer

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

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ status, uptime, sessions, channels, clients, spool_bytes }` |
| GET | `/hosts` | — | `Host[]` |
| POST | `/hosts` | CreateHost | `Host` |
| GET | `/hosts/:id` | — | `Host` |
| PUT | `/hosts/:id` | UpdateHost | `Host` |
| DELETE | `/hosts/:id` | — | 204 |
| POST | `/hosts/:id/test` | — | `{ ok, message?, agent_installed }` |
| GET | `/sessions` | — | `Session[]` (query: `?host_id=X`) |
| GET | `/sessions/:id` | — | `Session` (includes channels) |
| DELETE | `/sessions/:id` | — | 204 (close) |
| GET | `/channels` | — | `Channel[]` (query: `?host_id=X`) |
| GET | `/channels/:id` | — | `Channel` |
| GET | `/hosts/:id/groups` | — | `ChannelGroup[]` |
| POST | `/hosts/:id/groups` | CreateGroup | `ChannelGroup` |
| PUT | `/groups/:id` | UpdateGroup | `ChannelGroup` |
| DELETE | `/groups/:id` | — | 204 |
| GET | `/workspaces` | — | `Workspace[]` |
| POST | `/workspaces` | CreateWS | `Workspace` |
| PUT | `/workspaces/:id` | UpdateWS | `Workspace` |
| DELETE | `/workspaces/:id` | — | 204 |
| GET | `/config` | — | ResolvedConfig (merged) |
| GET | `/config/raw` | — | `{ toml: string }` |
| PUT | `/config/raw` | `{ toml }` | 204 |
| POST | `/pair` | — | `{ code, expires_at }` |
| POST | `/pair/verify` | `{ code }` | `{ token }` |

### Request/Response Body Schemas

**CreateHost:**
```typescript
{
  type: 'local' | 'ssh',       // required
  label: string,                // required, 1-64 chars, alphanumeric + dash/underscore, unique
  ssh_host?: string,            // required if type=ssh, "user@hostname" or "user@ip"
  ssh_port?: number,            // default 22, range 1-65535
  ssh_auth?: 'agent' | 'key' | 'password',  // required if type=ssh
  ssh_key_path?: string,        // required if ssh_auth=key
  icon_type?: 'auto' | 'emoji' | 'image',   // default 'auto'
  icon_value?: string,          // emoji char or image path
  color?: string,               // hex "#rrggbb" or null for auto
  default_shell?: string,
  default_cwd?: string,
  trust_remote_hints?: 'apply' | 'ask' | 'ignore'  // default 'apply'
}
```

**UpdateHost:** Same fields as CreateHost, all optional (partial update, deep merge).

**CreateGroup:**
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

**CreateWorkspace:**
```typescript
{
  name: string,                 // required, 1-64 chars, unique
  layout_json: TabLayout        // required (see SPEC.md § 4 TabLayout)
}
```

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
