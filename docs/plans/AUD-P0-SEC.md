---
doc-meta:
  status: canonical
  adversarial_applied: true
  implemented: 2026-03-18
---

# AUD-P0-SEC — P0 Security Audit Fixes

> **Story:** Fix 3 P0 security findings before going public
> **Scope:** packages/hub, packages/shared, packages/clients/web
> **Dependencies:** none (independent of each other)

## Context

Codebase audit identified 3 P0 security issues:
- **AUD-001**: CORS `origin: true` accepts all origins
- **AUD-002**: SSH host key verification not implemented (MITM-vulnerable)
- **AUD-012**: `customCommand` field flows to shell exec with zero validation

## Block 1 — AUD-001: CORS Origin Allowlist

### Current State
`packages/hub/src/server.ts` registers `@fastify/cors` with `origin: true`, reflecting any request origin. No config.toml support for CORS.

### Design
- Add `corsOrigins?: string[]` to `ServerConfig` in shared config types
- Parse `[server] cors_origins` from config.toml (string array)
- Default: `["http://localhost:*", "https://localhost:*", "http://127.0.0.1:*", "https://127.0.0.1:*", "tauri://localhost", "http://tauri.localhost"]` (from /llm: browsers treat localhost and 127.0.0.1 as distinct origins)
- Replace `origin: true` with a validation function that checks request origin against allowlist
- Wildcard `*` in port position matches any port (e.g., `http://localhost:*` → `/^http:\/\/localhost(:\d+)?$/`)
- **Regex anchoring: patterns MUST use `^...$` to prevent `localhost.evil.com` bypass** (from /adversarial)
- Empty array `[]` = reject all cross-origin (strict mode)
- Missing or `null` Origin header → no CORS headers in response (from /adversarial)

### Files
| File | Change |
|------|--------|
| `packages/shared/src/config.ts` | Add `corsOrigins` to `ServerConfig` interface |
| `packages/hub/src/config.ts` | Parse + default `cors_origins`, add `matchCorsOrigin()` |
| `packages/hub/src/server.ts` | Replace `origin: true` with origin validation function |
| `packages/hub/src/server.spec.ts` | Test CORS with allowed/disallowed origins |

### BDD Scenarios
```gherkin
Scenario: Allowed origin gets CORS headers
  Given hub config has cors_origins = ["http://localhost:*"]
  When request arrives from origin "http://localhost:5173"
  Then response has Access-Control-Allow-Origin: http://localhost:5173

Scenario: Disallowed origin gets no CORS headers
  Given hub config has cors_origins = ["http://localhost:*"]
  When request arrives from origin "http://evil.com"
  Then response has no Access-Control-Allow-Origin header

Scenario: Hostname boundary is enforced (no subdomain bypass)
  Given hub config has cors_origins = ["http://localhost:*"]
  When request arrives from origin "http://localhost.evil.com:5173"
  Then response has no Access-Control-Allow-Origin header

Scenario: Default config allows localhost + Tauri
  Given hub config has no cors_origins setting
  When request arrives from origin "tauri://localhost"
  Then response has Access-Control-Allow-Origin: tauri://localhost

Scenario: Empty allowlist rejects all origins
  Given hub config has cors_origins = []
  When request arrives from origin "http://localhost:5173"
  Then response has no Access-Control-Allow-Origin header

Scenario: Missing origin header gets no CORS headers
  Given hub config has cors_origins = ["http://localhost:*"]
  When request arrives with no Origin header
  Then response has no Access-Control-Allow-Origin header
```

### Exit Criteria
- [ ] CORS origin checked against configurable allowlist
- [ ] Default allowlist covers localhost + Tauri
- [ ] Disallowed origins get no CORS headers
- [ ] Hostname boundary enforced (no subdomain bypass)
- [ ] Missing/null origin handled correctly
- [ ] All tests pass

---

## Block 2 — AUD-012: custom_command Validation

### Current State
`customCommand` flows from DB → `resolveCustomCommand()` → `AgentSpawnMessage` → agent `wrapWithElevation()` → used as shell executable. Zero validation anywhere.

### Design
- Add `validateCustomCommand(cmd: string): void` in shared validation module
- Validation rules:
  - **Character allowlist** (not blocklist — safer, from /adversarial): `[a-zA-Z0-9/\\._ :-]` only
  - **ASCII-only** — reject bytes > 127 to prevent homoglyph attacks (from /adversarial)
  - Length: 1–4096 chars (empty string explicitly rejected, from /adversarial)
  - Must be absolute path: starts with `/` (Unix) or drive letter `X:\` (Windows)
  - No `..` path traversal segments (segment-aware: `/../`, `\..\`)
- **Note:** `customCommand` is a binary path only — no arguments. Agent uses `spawn(customCommand, ['--', shell, ...args])` with `shell: false`. Arguments in the path (e.g., `/usr/bin/sudo -n`) will fail with ENOENT — this is correct behavior. (from /llm consensus)
- Apply at:
  - **REST API boundary**: host create/update when `customCommand` is set
  - **Config parse**: when loading `elevation.custom_command` from config.toml
  - **Spawn time**: defensive check in `resolveCustomCommand()` (belt + suspenders)

### Files
| File | Change |
|------|--------|
| `packages/shared/src/validation.ts` | Add `validateCustomCommand()` |
| `packages/shared/src/validation.spec.ts` | Unit tests for validation |
| `packages/hub/src/routes/host-routes.ts` | Validate on host create/update |
| `packages/hub/src/config.ts` | Validate on config load |
| `packages/hub/src/session/session-manager.ts` | Defensive check at spawn |

### BDD Scenarios
```gherkin
Scenario: Valid absolute Unix path accepted
  Given customCommand is "/usr/bin/sudo"
  When validateCustomCommand is called
  Then no error is thrown

Scenario: Valid absolute Windows path accepted
  Given customCommand is "C:\Windows\System32\gsudo.exe"
  When validateCustomCommand is called
  Then no error is thrown

Scenario: Windows path with spaces accepted
  Given customCommand is "C:\Program Files\gsudo\gsudo.exe"
  When validateCustomCommand is called
  Then no error is thrown

Scenario: Shell metacharacters rejected (via allowlist)
  Given customCommand is "/usr/bin/sudo; rm -rf /"
  When validateCustomCommand is called
  Then error "custom_command contains invalid characters" is thrown

Scenario: Non-ASCII characters rejected
  Given customCommand contains Unicode characters
  When validateCustomCommand is called
  Then error "custom_command must contain only ASCII characters" is thrown

Scenario: Relative path rejected
  Given customCommand is "sudo"
  When validateCustomCommand is called
  Then error "custom_command must be an absolute path" is thrown

Scenario: Path traversal rejected
  Given customCommand is "/usr/bin/../../../etc/shadow"
  When validateCustomCommand is called
  Then error "custom_command must not contain path traversal" is thrown

Scenario: Empty string rejected
  Given customCommand is ""
  When validateCustomCommand is called
  Then error "custom_command must not be empty" is thrown

Scenario: Null bytes rejected
  Given customCommand is "/usr/bin/sudo\0evil"
  When validateCustomCommand is called
  Then error "custom_command contains invalid characters" is thrown

Scenario: REST API rejects invalid customCommand
  Given a PUT /api/hosts/:id request with customCommand "sudo; whoami"
  When the request is processed
  Then response is 400 with error code "INVALID_CUSTOM_COMMAND"
```

### Exit Criteria
- [ ] Validation uses character allowlist (not blocklist)
- [ ] Non-ASCII and null bytes rejected
- [ ] Empty string explicitly rejected
- [ ] REST API rejects invalid customCommand with 400
- [ ] Config loader rejects invalid elevation.custom_command
- [ ] Defensive check at spawn time
- [ ] All tests pass

---

## Block 3 — AUD-002: SSH Host Key TOFU

### Current State
`buildSshConnectConfig()` in `ssh-agent.ts` builds ssh2 `ConnectConfig` WITHOUT `hostVerifier` callback. Connection accepts any host key. SECURITY.md § 3.3 specifies TOFU with persistence.

### Design

**Strategy: Trust-On-First-Use (TOFU) with auto-accept on first connect**
- Matches `StrictHostKeyChecking=accept-new` behavior in OpenSSH
- First connect → auto-accept, store fingerprint in DB
- Subsequent connects → verify against stored fingerprint
- Mismatch → reject connection, notify client via WS, user can override

**DB Migration:**
- Add `ssh_fingerprint TEXT` column to `hosts` table (nullable)
- **Storage format: `SHA256:<base64>`** — matches OpenSSH `ssh-keygen -lf` output for easy user verification (from /llm: Copilot)
- **Hash raw key with crypto.createHash('sha256')** then base64-encode — don't rely on ssh2's internal hashing (from /adversarial)

**ssh2 Integration:**
- Add `hostVerifier` to `ConnectConfig` in `buildSshConnectConfig()`
- ssh2 `hostVerifier` callback receives host key (Buffer or string depending on version)
- Compute SHA-256 of raw key, base64-encode, format as `SHA256:<base64>`
- On first connect (no stored fingerprint): return `true`, capture hash for post-connect storage
- On match: return `true`
- On mismatch: return `false`, set `verificationState = { mismatch: true, newFingerprint }` (from /llm: Codex — explicit state, not brittle error text matching)

**Mismatch Flow:**
1. `hostVerifier` returns `false` → ssh2 emits error
2. Error handler checks `verificationState.mismatch` flag (not error message text)
3. Hub sends WS `HOST_KEY_MISMATCH` to connected clients
4. UI shows warning dialog with old/new fingerprints
5. User accepts → hub updates fingerprint in DB → retry connect
6. User rejects → connection stays failed

**Protocol Messages:**
- Hub → Client: `HOST_KEY_MISMATCH { hostId, hostname, oldFingerprint, newFingerprint, promptId }` — `promptId` is ULID (from /llm: Codex — prevents replay/unauthorized acceptance)
- Client → Hub: `HOST_KEY_RESPONSE { hostId, promptId, accepted: boolean }` — must match `promptId`
- **Timeout:** 30s for HOST_KEY_RESPONSE. No response → connection fails (from /llm: Codex — prevents deadlock when no client connected)

**UI:**
- Warning dialog (red/danger styling) showing:
  - Host name and hostname
  - Full fingerprints (copyable), with compact display (from /llm: Codex)
  - Warning text about MITM risk
  - Accept / Reject buttons

### Files
| File | Change |
|------|--------|
| `packages/hub/src/dal/meta-dal.ts` | Migration: add `ssh_fingerprint` column |
| `packages/hub/src/session/ssh-agent.ts` | Add `hostVerifier` to connect config |
| `packages/hub/src/session/session-manager.ts` | Handle mismatch error, WS prompt, retry |
| `packages/shared/src/protocol.ts` | `HOST_KEY_MISMATCH` + `HOST_KEY_RESPONSE` messages |
| `packages/shared/src/entities.ts` | Add `sshFingerprint` to `Host` interface |
| `packages/clients/web/src/components/HostKeyWarning.vue` | Warning dialog |
| `packages/clients/web/src/stores/session.ts` | Handle HOST_KEY_MISMATCH message |
| `packages/hub/src/session/ssh-agent.spec.ts` | TOFU + mismatch tests |

### BDD Scenarios
```gherkin
Scenario: First connect auto-accepts and stores fingerprint
  Given host "server1" has no stored ssh_fingerprint
  When SSH connection is established
  Then hostVerifier accepts the key
  And host.ssh_fingerprint is updated in DB as "SHA256:<base64>"

Scenario: Known host with matching fingerprint connects
  Given host "server1" has ssh_fingerprint "SHA256:abc123..."
  When SSH connection is established with matching host key
  Then hostVerifier accepts the key
  And connection succeeds

Scenario: Known host with changed fingerprint is rejected
  Given host "server1" has ssh_fingerprint "SHA256:abc123..."
  When SSH connection encounters different host key
  Then hostVerifier rejects the key
  And HOST_KEY_MISMATCH is sent to client with both fingerprints

Scenario: User accepts changed host key
  Given HOST_KEY_MISMATCH was sent for host "server1"
  When client sends HOST_KEY_RESPONSE with accepted=true
  Then host.ssh_fingerprint is updated to new fingerprint
  And SSH connection is retried

Scenario: User rejects changed host key
  Given HOST_KEY_MISMATCH was sent for host "server1"
  When client sends HOST_KEY_RESPONSE with accepted=false
  Then connection remains failed
  And session status is set to CLOSED
```

### Exit Criteria
- [ ] Migration adds ssh_fingerprint column
- [ ] Fingerprint stored as `SHA256:<base64>` (OpenSSH-compatible format)
- [ ] HOST_KEY_MISMATCH includes promptId (ULID) to prevent replay
- [ ] HOST_KEY_RESPONSE timeout: 30s (prevents deadlock with no client)
- [ ] First connect stores fingerprint (TOFU)
- [ ] Matching fingerprint: silent accept
- [ ] Mismatching fingerprint: connection rejected + WS notification
- [ ] User can accept/reject changed fingerprint
- [ ] UI shows clear warning with fingerprint details
- [ ] All tests pass

---

## Implementation Order

1. **Block 1** (AUD-001 CORS) — smallest, no migration, self-contained
2. **Block 2** (AUD-012 validation) — small, shared utility + API validation
3. **Block 3** (AUD-002 SSH TOFU) — largest, migration + WS flow + UI

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| ssh2 hostVerifier is sync — can't do async prompts | TOFU auto-accepts first connect; only mismatch needs prompt (separate retry flow) |
| ssh2 hostVerifier callback signature varies by version | Hash raw key ourselves with SHA-256, don't rely on ssh2 hashing |
| CORS break Tauri desktop | Default allowlist includes `tauri://localhost` + `http://tauri.localhost` |
| CORS regex bypass via subdomain | Strict anchoring with `^...$` (from /adversarial) |
| custom_command validation too strict | Character allowlist includes space, dash, underscore, dot for real paths |
| custom_command blocklist bypass | Using allowlist instead of blocklist (from /adversarial) |
| Migration on existing DB | ALTER TABLE ADD COLUMN is safe in SQLite |
