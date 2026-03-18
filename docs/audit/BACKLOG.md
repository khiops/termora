# Audit Backlog

**Generated:** 2026-03-18
**Source:** /audit full

---

## Scoring: Priority = (Impact x Risk) / Complexity

---

## Backlog Items

| ID | Issue | Location | C | I | R | Effort | Score | Priority |
|----|-------|----------|---|---|---|--------|-------|----------|
| AUD-001 | CORS `origin: true` + `credentials: true` — any website can make auth requests | `hub/src/server.ts:45` | C1 | I4 | R3 | S | 12.0 | P0 |
| AUD-002 | SSH hostVerifier always returns true — MITM possible | `hub/src/session/ssh-agent.ts:174` | C2 | I4 | R3 | M | 6.0 | P0 |
| AUD-003 | README.md does not exist | root | C1 | I3 | R2 | S | 6.0 | P0 |
| AUD-004 | Pairing rate-limit in-memory, resets on restart | `hub/src/api/pair.ts:19` | C2 | I3 | R2 | M | 3.0 | P1 |
| AUD-005 | Auth token has no expiry or revocation mechanism | `hub/src/auth.ts` | C3 | I3 | R2 | L | 2.0 | P1 |
| AUD-006 | PROTOCOL.md missing ~70% of REST routes, ~40% of WS messages | `docs/PROTOCOL.md` | C3 | I3 | R2 | L | 2.0 | P1 |
| AUD-007 | SPEC.md entity model frozen at MVP (~30 fields behind) | `docs/SPEC.md` | C3 | I3 | R2 | L | 2.0 | P1 |
| AUD-008 | sea-addon-loader.ts duplicated verbatim between agent and hub | `agent/src/`, `hub/src/` | C2 | I2 | R2 | M | 2.0 | P1 |
| AUD-009 | Error format inconsistency in pair.ts and wallpapers.ts | `hub/src/api/pair.ts`, `wallpapers.ts` | C1 | I2 | R1 | S | 2.0 | P1 |
| AUD-010 | Elevated-spawn flow duplicated in handleSpawn/restartChannel | `hub/src/session/session-manager.ts:513,1028` | C2 | I2 | R2 | M | 2.0 | P1 |
| AUD-011 | Profile patch logic duplicated (host + channel) | `hub/src/api/config.ts:208,329` | C2 | I2 | R2 | S | 2.0 | P1 |
| AUD-012 | custom_command field unvalidated — arbitrary binary path | `hub/src/api/hosts.ts:237` | C1 | I3 | R2 | S | 6.0 | P0 |
| AUD-013 | WS upgrade unauthenticated at HTTP level | `hub/src/server.ts:74` | C2 | I2 | R2 | M | 2.0 | P1 |
| AUD-014 | SessionManager god class (2344 lines, 50+ methods) | `hub/src/session/session-manager.ts` | C4 | I3 | R2 | XL | 1.5 | P2 |
| AUD-015 | MetaDAL god class (1116 lines, 57 methods, 7 domains) | `hub/src/storage/meta.ts:346` | C4 | I3 | R2 | XL | 1.5 | P2 |
| AUD-016 | useLayout composable (793 lines, complexity 177) | `web/src/composables/useLayout.ts` | C3 | I2 | R2 | L | 1.3 | P2 |
| AUD-017 | registerHostRoutes (501 lines, complexity 198) | `hub/src/api/hosts.ts` | C3 | I2 | R2 | L | 1.3 | P2 |
| AUD-018 | registerWsRoutes (348 lines, 13 message types inline) | `hub/src/ws/ws-handler.ts` | C3 | I2 | R2 | L | 1.3 | P2 |
| AUD-019 | _doConnect wires 9 WS message routes inline | `web/src/stores/session.ts:52` | C2 | I2 | R1 | M | 1.0 | P2 |
| AUD-020 | Circular store dependency (session→channels→hosts→notifications→session) | `web/src/stores/` | C3 | I2 | R1 | L | 0.7 | P3 |
| AUD-021 | Circular import shared/config.ts ↔ shared/entities.ts | `shared/src/` | C2 | I2 | R1 | M | 1.0 | P2 |
| AUD-022 | FontFile interface duplicated in web config.ts and hub fonts.ts | `web/src/stores/config.ts`, `hub/src/api/fonts.ts` | C1 | I2 | R1 | S | 2.0 | P1 |
| AUD-023 | No pagination on list API endpoints | `hub/src/api/*.ts` | C2 | I2 | R1 | M | 1.0 | P2 |
| AUD-024 | Verb-in-URL for reorder/purge/import endpoints | `hub/src/api/*.ts` | C2 | I1 | R1 | M | 0.5 | P3 |
| AUD-025 | Health endpoint exposes version + uptime unauthenticated | `hub/src/server.ts:107` | C1 | I1 | R1 | S | 1.0 | P2 |

---

## Improvement Axes

### Axis 1: Security Hardening

**Goal:** Close critical security gaps before public release
**Total effort:** ~1d | **Avg complexity:** C1-C2 | **Max risk if ignored:** R3

| ID | Issue | C | I | R | Effort | Score |
|----|-------|---|---|---|--------|-------|
| AUD-001 | CORS origin allowlist | C1 | I4 | R3 | S | 12.0 |
| AUD-002 | SSH host key verification | C2 | I4 | R3 | M | 6.0 |
| AUD-012 | custom_command validation | C1 | I3 | R2 | S | 6.0 |
| AUD-004 | Persistent pairing rate-limit | C2 | I3 | R2 | M | 3.0 |
| AUD-013 | WS upgrade auth | C2 | I2 | R2 | M | 2.0 |

**Recommended approach:** AUD-001 and AUD-012 first (quick wins). AUD-002 is the most impactful but requires design decision (TOFU vs known_hosts).

### Axis 2: Documentation Catch-up

**Goal:** Bring docs in sync with code before going public
**Total effort:** ~2-3d | **Avg complexity:** C2-C3 | **Max risk if ignored:** R2

| ID | Issue | C | I | R | Effort | Score |
|----|-------|---|---|---|--------|-------|
| AUD-003 | Create README.md | C1 | I3 | R2 | S | 6.0 |
| AUD-006 | Update PROTOCOL.md | C3 | I3 | R2 | L | 2.0 |
| AUD-007 | Update SPEC.md entity model | C3 | I3 | R2 | L | 2.0 |

**Recommended approach:** README.md first (quick win). PROTOCOL.md and SPEC.md in parallel.

### Axis 3: DRY Consolidation

**Goal:** Eliminate duplicated code patterns
**Total effort:** ~1d | **Avg complexity:** C2 | **Max risk if ignored:** R2

| ID | Issue | C | I | R | Effort | Score |
|----|-------|---|---|---|--------|-------|
| AUD-008 | sea-addon-loader to shared | C2 | I2 | R2 | M | 2.0 |
| AUD-010 | Elevated-spawn flow extraction | C2 | I2 | R2 | M | 2.0 |
| AUD-011 | Profile patch logic extraction | C2 | I2 | R2 | S | 2.0 |
| AUD-022 | FontFile interface to shared | C1 | I2 | R1 | S | 2.0 |

**Recommended approach:** All items are independent, can be done in parallel.

### Axis 4: SRP Decomposition

**Goal:** Break down god classes for maintainability
**Total effort:** ~5d+ | **Avg complexity:** C3-C4 | **Max risk if ignored:** R2

| ID | Issue | C | I | R | Effort | Score |
|----|-------|---|---|---|--------|-------|
| AUD-014 | SessionManager decomposition | C4 | I3 | R2 | XL | 1.5 |
| AUD-015 | MetaDAL split | C4 | I3 | R2 | XL | 1.5 |
| AUD-016 | useLayout split | C3 | I2 | R2 | L | 1.3 |
| AUD-017 | registerHostRoutes split | C3 | I2 | R2 | L | 1.3 |
| AUD-018 | registerWsRoutes split | C3 | I2 | R2 | L | 1.3 |

**Recommended approach:** Start with route handlers (lower risk). SessionManager and MetaDAL are architectural — plan carefully.

---

## Quick Wins (C1-C2, I2+)

| ID | Issue | Effort | Impact | Why Quick |
|----|-------|--------|--------|-----------|
| AUD-001 | CORS origin allowlist | S | I4 | 1 line change in server.ts |
| AUD-012 | custom_command validation | S | I3 | Add length + path validation |
| AUD-003 | Create README.md | S | I3 | New file, standard template |
| AUD-009 | Error format consistency | S | I2 | 2 files, change { error, message } to { error: { code, message } } |
| AUD-011 | Profile patch extraction | S | I2 | Extract 1 shared function |
| AUD-022 | FontFile to shared | S | I2 | Move 1 interface |

---

## Summary

| Priority | Count | Total Effort | Avg Score |
|----------|-------|--------------|-----------|
| P0 | 4 | ~6h | 7.5 |
| P1 | 8 | ~3d | 2.1 |
| P2 | 8 | ~5d | 1.2 |
| P3 | 2 | ~4h | 0.6 |
| **Total** | **25** | **~9d** | |

| Axis | Items | Effort | Top Priority |
|------|-------|--------|-------------|
| Security Hardening | 5 | ~1d | P0 |
| Documentation Catch-up | 3 | ~2-3d | P0 |
| DRY Consolidation | 4 | ~1d | P1 |
| SRP Decomposition | 5 | ~5d+ | P2 |

---

## Positive Patterns

- All SQL is parameterized (zero injection risk)
- Auth token uses crypto.randomBytes(32) + timingSafeEqual
- Clean dependency direction across all packages
- Consistent error format (except pair.ts/wallpapers.ts)
- Strong test coverage (2031 tests, 92 files)
- AgentConnection interface is textbook DIP
- pnpm catalog enforces consistent versioning
- WriteLockManager properly separated from WS routing

---

## Tracking

- [ ] P0 items addressed
- [ ] P1 items in sprint planning
- [ ] Quick wins executed
- [ ] Next audit scheduled
