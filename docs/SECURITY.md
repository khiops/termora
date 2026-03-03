# nexterm — Security Specification

> Version: 0.1.0 (MVP)
> Status: draft
> Last updated: 2026-03-02

## 1. Threat Model

### 1.1 Architecture Security Context

```
┌──────────────────────────────────────────────────────────┐
│ User's machine (trusted)                                  │
│                                                           │
│  Browser (PWA) ──── WS/REST ──── Hub daemon               │
│  127.0.0.1:4100     │            127.0.0.1:4100           │
│                      │            ┌───────────────┐       │
│  Token auth          │            │ meta.db       │       │
│  (Bearer header)     │            │ spool.db      │ 0600  │
│                      │            │ auth.json     │       │
│                      │            │ config.toml   │       │
│                      │            └───────────────┘       │
└──────────────────────┼────────────────────────────────────┘
                       │ SSH (encrypted)
                       │ No port opened on remote
┌──────────────────────▼────────────────────────────────────┐
│ Remote machine                                             │
│                                                            │
│  nexterm-agent ──── stdin/stdout ──── SSH server            │
│  (no network listener)               (port 22, standard)  │
│                                                            │
│  PTY processes run as the SSH user                         │
└────────────────────────────────────────────────────────────┘
```

### 1.2 Trust Boundaries

| Boundary | Trust level | Notes |
|----------|-------------|-------|
| Hub process ↔ local filesystem | High | Same user, same machine |
| Browser ↔ Hub (localhost) | Medium | Any local process can connect |
| Hub ↔ Remote (SSH) | High | SSH provides encryption + auth |
| Agent ↔ PTY | High | Same user on remote machine |
| Browser ↔ Internet | N/A | Hub never exposed to internet |

### 1.3 Threat Actors

| Actor | Access | Capability |
|-------|--------|------------|
| Malicious local process | Same machine, different user | Can attempt WS connection to 127.0.0.1:4100 |
| Malicious local process | Same user | Can read auth.json, DB files |
| Network attacker | On same LAN | Cannot reach 127.0.0.1 (loopback only) |
| Compromised remote | Agent's SSH user | Can send crafted protocol messages |

### 1.4 Threat Matrix

| Threat | Vector | Impact | Likelihood | Mitigation |
|--------|--------|--------|------------|------------|
| Unauthorized hub access | Local process connects to WS | HIGH — terminal access | MEDIUM | Token auth required for all WS/REST |
| Token theft | Read auth.json | HIGH — full access | LOW (requires same user) | chmod 600, warn if world-readable |
| Spool data exposure | Read spool.db | MEDIUM — output history | LOW (requires same user) | chmod 600 on all DB files |
| Crafted agent messages | Compromised remote | MEDIUM — protocol abuse | LOW | Validate all agent messages, size limits |
| SSH credential theft | Read key files | HIGH — remote access | LOW (requires same user) | Use ssh-agent, never store passwords |
| DoS via large frames | Agent sends huge output | LOW — hub OOM | LOW | 10 MB frame limit, backpressure |
| Multi-device token sharing | Token copied insecurely | MEDIUM | MEDIUM | Pairing codes (short-lived, one-time) |

## 2. Authentication

### 2.1 Local Token Auth

**Token generation (on first start):**
```
1. Generate 32 bytes of crypto-random data
2. Encode as hex string (64 chars)
3. Write to $NEXTERM_CONFIG_DIR/auth.json: { "token": "<hex>" }
4. Set file permissions: chmod 600 (Linux/macOS) or restrictive ACL (Windows)
```

**Token validation:**
- REST: `Authorization: Bearer <token>` header on every request (except `/health`)
- WS: First message must be `AUTH { token }`. Connection closed if invalid.
- Token comparison: constant-time (crypto.timingSafeEqual)

**Token rotation:**
- `nexterm token rotate` — generates new token, invalidates old
- All connected clients receive AUTH_FAIL and must re-authenticate

### 2.2 Startup Security Check

On every hub start:

```
1. Check auth.json permissions
   - If world-readable (o+r): HARD FAIL — refuse to start
   - If group-readable (g+r): WARN in logs
   - Expected: 0600 (-rw-------)

2. Check data directory permissions
   - If world-readable: WARN in logs
   - Expected: 0700 (drwx------)

3. Verify auth.json contains valid token (64 hex chars)
   - If missing or invalid: generate new token
```

### 2.3 Multi-Device Pairing

**Problem:** Second device needs the token. Copying files manually is insecure.

**Solution: One-time pairing code**

```
Device A (has token):
  $ nexterm pair
  Pairing code: 847293
  Expires in 60 seconds.
  Enter this code on the other device.

Device B (needs token):
  Opens http://<hub-ip>:4100 → pairing screen
  Enters: 847293
  → Hub verifies code, returns token
  → Device B stores token locally
```

**Pairing flow:**

```
1. POST /api/pair (authenticated — Device A must have token)
   → Hub generates 6-digit code, stores in pairing_codes table
   → Returns { code: "847293", expires_at: "..." }

2. POST /api/pair/verify (unauthenticated — Device B uses code)
   Body: { code: "847293" }
   → Hub checks: code exists, not expired, not used
   → If valid: mark used, return { token: "<the auth token>" }
   → If invalid: return 401

3. Code expires after 60 seconds (cleaned up by GC)
4. Code is single-use (used flag prevents replay)
```

**Security properties:**
- Short-lived (60s)
- Single-use
- 6 digits = 1M combinations (brute force not practical in 60s)
- Requires authenticated user to generate (Device A must have token)
- Rate limit: max 3 active codes, max 10 attempts per minute

## 3. SSH Security

### 3.1 Authentication Methods

| Method | How | Security level |
|--------|-----|---------------|
| **ssh-agent** (recommended) | Hub uses running ssh-agent via `SSH_AUTH_SOCK` | HIGH — keys never touch disk via nexterm |
| Key file | Hub reads private key path | MEDIUM — key on disk, nexterm doesn't copy it |
| Password | Hub sends password over SSH | LOW — password in memory (not stored) |

**MVP:** Support all three. Recommend ssh-agent in UI. Never store passwords in meta.db.

### 3.2 SSH Key Handling

- nexterm NEVER copies private keys
- Key path stored in meta.db (hosts.ssh_key_path) — points to user's existing key
- Passphrase: prompted by ssh2 library callback, never stored
- ssh-agent: preferred — nexterm just requests signing, never sees key material

### 3.3 Known Hosts

- MVP: use system's `~/.ssh/known_hosts` (ssh2 `hostVerifier` callback)
- On first connect to unknown host: prompt user "Trust this host fingerprint? [Yes/No]"
- Store accepted fingerprints in meta.db (hosts table, optional column)

### 3.4 Agent Launch Security

```
ssh user@host "nexterm-agent --stdio"
```

- Agent runs as the SSH user (no privilege escalation)
- Agent has no network listener (stdio only)
- Agent spawns PTYs as the same user
- Hub controls what commands agent receives (validated protocol)

## 4. Data Protection

### 4.1 At Rest

| Data | Location | Protection (MVP) | Protection (P2) |
|------|----------|-------------------|-----------------|
| Auth token | auth.json | chmod 600 | OS keychain |
| SSH key paths | meta.db | chmod 600 on DB | SQLCipher |
| Host configs | meta.db | chmod 600 | SQLCipher |
| Terminal output | spool.db | chmod 600 | SQLCipher |
| Snapshots | spool.db | chmod 600 | SQLCipher |
| Config prefs | config.toml | Standard file perms | — |

### 4.2 In Transit

| Path | Encryption | Notes |
|------|-----------|-------|
| UI ↔ Hub | None (localhost) | 127.0.0.1 only — no network transit |
| Hub ↔ Agent | SSH (AES-256-GCM or ChaCha20) | Standard SSH encryption |

**Note:** If hub bind is changed to 0.0.0.0 (not recommended), TLS should be added. MVP does not support this — warn user in config comment.

### 4.3 In Memory

- Auth token: kept in memory for comparison
- SSH passwords: cleared after authentication (not stored)
- Terminal output: buffer limited by backpressure (max ~1MB per channel in memory)
- Snapshots: kept in cache, limited by GC policy

## 5. Input Validation

### 5.1 Protocol Messages

All incoming messages (from agent or UI) must be validated:

| Field | Validation |
|-------|-----------|
| `type` | Must be a known message type string |
| `channel_id` | Must be a valid ULID, must exist in session |
| `host_id` | Must be a valid ULID, must exist |
| `data` (Uint8Array) | Max 1 MB per message |
| `cols`, `rows` | Positive integers, 1 ≤ cols ≤ 500, 1 ≤ rows ≤ 200 |
| `shell` | Non-empty string, no null bytes |
| `cwd` | Non-empty string, no null bytes |
| `env` | Object with string keys/values, max 100 entries |
| Frame size | Max 10 MB total |

### 5.2 REST API

| Field | Validation |
|-------|-----------|
| Host label | 1-64 chars, alphanumeric + dash/underscore |
| SSH host | Valid hostname or IP, no shell metacharacters |
| SSH port | 1-65535 |
| Workspace name | 1-64 chars, alphanumeric + dash/underscore/space |
| Config TOML | Parse-validated before saving |
| Pairing code | Exactly 6 digits |

### 5.3 SQL Injection Prevention

- Use parameterized queries exclusively (better-sqlite3 `prepare().run()`)
- Never interpolate user input into SQL strings
- JSON columns: validate JSON structure before storing

## 6. Rate Limiting

| Endpoint / Action | Limit | Window |
|-------------------|-------|--------|
| POST /api/pair/verify | 10 attempts | 1 minute |
| POST /api/pair | 3 active codes | — |
| WS AUTH_FAIL | 5 failures → 30s cooldown | Per IP |
| SPAWN requests | 20 per host | 1 minute |

## 7. Logging & Audit

### 7.1 Security Events (always logged at INFO)

| Event | Log fields |
|-------|-----------|
| Hub start | bind address, port, permissions check result |
| Auth success | client_id, source IP (always 127.0.0.1 MVP) |
| Auth failure | source IP, reason |
| Pairing code generated | expires_at (NOT the code) |
| Pairing code verified | client_id |
| SSH connect | host_id, host label, auth method |
| SSH disconnect | host_id, reason |
| Write-lock force | channel_id, by client_id, from client_id |
| Token rotated | timestamp |

### 7.2 What is NOT logged

- Auth tokens (never in logs)
- SSH passwords (never in logs)
- Terminal output content (never in logs — goes to spool.db only)
- Pairing codes (never in logs — only expiry time)

## 8. Security Recommendations for Users

Included in first-run output and `nexterm --help`:

```
Security notes:
  • Hub listens on 127.0.0.1 only (not exposed to network)
  • Use ssh-agent for key management (recommended over key files)
  • auth.json must be readable only by you (chmod 600)
  • Do not share your auth token — use 'nexterm pair' for other devices
  • Terminal output is stored locally in data dir (see SPEC.md § 7 for platform paths)
  • To encrypt stored data, enable SQLCipher (P2 feature)
```

## 9. Future Security Enhancements (post-MVP)

| Feature | Priority | Description |
|---------|----------|-------------|
| SQLCipher | P2 | Encrypt meta.db and spool.db at rest |
| OS keychain | P1 | Store auth token in OS keychain (keytar) |
| TLS for non-localhost | P2 | If hub exposed beyond loopback |
| OIDC | P2 | Enterprise SSO for multi-user |
| mTLS | P2 | Mutual TLS for hub ↔ remote |
| Audit log | P1 | Persistent security event log |
| Session recording | P2 | Immutable audit trail of terminal sessions |
