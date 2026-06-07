# SSH session-acquisition lifecycle — state-machine redesign (#43)

## Problem

Concurrent SPAWNs to the same SSH host coalesce one connect + one session shared by a
"leader" and N "followers". The lifecycle has many actors — leader, followers,
client-disconnect, explicit `closeSession`, `shutdown`, connect success/failure,
agent-drop/reconnect, in-flight auth/host-key prompts. Ad-hoc guards scattered across
`handleSpawn`/`closeSession`/`shutdown` cannot cover the actor×state combinations: six
gate rounds each surfaced a *new* race. Root cause: no single owner of the shared
acquisition with an explicit state, reference count, and one serialized policy.

## Core principles (from adversarial design review — both engines)

- **P1 — Serialized transitions.** All acquisition mutations (`create/join/release/reap/
  close/connect-commit`) are performed in a SYNCHRONOUS critical section — no `await`
  between reading `state` and mutating it. JS is single-threaded, so a synchronous
  check-and-mutate is atomic; interleaving happens ONLY at explicit `await` boundaries
  (`await acq.connectPromise`, `await sshAgent.start`). Every transition re-validates
  identity + state after each await.
- **P2 — Single authority per host.** At any instant a host has EXACTLY ONE authority:
  either an **acquisition** (only while CONNECTING/RECONNECTING) OR an **active session**
  (no acq). The acquisition is deleted the moment the session goes active; from then on
  the active session + its channel set is the authority. There is no long-lived "READY"
  acq and no READY-reap — this removes the fast-path-vs-acq split.
- **P3 — Leases.** Each spawn-intent holds a `lease`; `release(lease)` is idempotent
  (per-lease `released` flag). `closeSession`/`shutdown` mark the acq terminal and abort,
  but DO NOT consume leases — waiters' `finally` still call `release(lease)` harmlessly.

## State & ownership

```
SessionAcquisition {
  id: string                         // generation id (reconnect = new generation)
  hostId: string
  state: "CONNECTING" | "RECONNECTING" | "CLOSING" | "FAILED"   // NO "READY"
  controller: AbortController        // threaded through connect AND reconnect attempts
  connectPromise: Promise<SessionState>
  leases: Set<Lease>                 // live spawn-intents; refCount = leases.size
}
ctx.acquisitions: Map<hostId, SessionAcquisition>   // identity = object reference
// prompts: every entry (host-key AND passphrase) is promptId-keyed and carries ownerAcqId
ctx.pendingPrompts: Map<promptId, { ownerAcqId, hostId, timer, resolve }>
```

Identity rule (kills the clobber class): every removal/abort is guarded
`if (ctx.acquisitions.get(hostId) === acq) …`. Prompts cleared by `ownerAcqId` match.
Agent-event handlers (drop/close/exit) carry an agent-identity guard so a stale event
cannot delete the current agent/session.

## Transition table (each row is one synchronous critical section, except the awaits noted)

| Action | Precondition | Effect |
|---|---|---|
| **spawn (leader)** | no acq AND no live agent for host | create acq (CONNECTING, new lease); start connect with `controller.signal`; store keyed by host; then `await connectPromise` |
| **spawn (follower)** | acq exists AND state ∈ {CONNECTING, RECONNECTING} | add lease (sync); `await acq.connectPromise` |
| **spawn (join refused)** | acq exists AND state ∈ {CLOSING, FAILED} | do NOT join; behave as fresh leader (create a new acq after the terminal one is removed) |
| **spawn (fast path)** | live active session, no acq | use it directly; governed by channel set, not a lease |
| **connect-commit (success)** | **sync guard**: `acquisitions.get(host)===acq && state===CONNECTING && !signal.aborted` | wire agent (agent-identity recorded); mark session active; **delete acq** (P2); resolve `connectPromise`. If guard fails → tear down the just-built agent, reject. |
| **connect-fail** | state===CONNECTING | state=FAILED; reject waiters; identity-remove acq; remove a fresh `starting` session (+broadcast closed); preserve a pre-existing `disconnected` session |
| **release(lease)** | lease not already released | mark released (idempotent); if `leases.size===0` AND no channel references the session → **reap** (sync): set state=CLOSING, identity-remove acq, then `controller.abort()` + teardown. Joins are refused once CLOSING is set (ordering: set state BEFORE async teardown). |
| **closeSession (explicit)** | acq OR active session | if acq: set CLOSING (sync), identity-remove, `controller.abort()`; if active session: close agent+session. Either way clear this host's prompts by `ownerAcqId`/host. Does NOT consume leases. |
| **shutdown** | — | for each acq: set CLOSING, abort, reject waiters; close active sessions; clear `acquisitions` + all prompts |
| **agent-drop → reconnect** | active session, agent dropped, not closing | create acq generation (RECONNECTING) owned by host with its own `controller`; reconnect attempts run under `controller.signal`; on success commit like connect-commit (guarded, then delete acq); `closeSession` during RECONNECTING aborts it |
| **trust-persist (host-key)** | host-key prompt resolved | persist `updateHostFingerprint`/`trustedOnce` ONLY if `!signal.aborted` AND `acquisitions.get(host)===acq` AND session current; else abort |

## Invariants (each maps to a finding from the 6 patch rounds + the design review)

1. Shared connect/reconnect is aborted ONLY when `leases.size===0` → leader-disconnect with a waiting follower does not cancel it.
2. `release` happens when a waiter is fully done (after `sendSpawnAndWait` returns, or on early-return/throw) via one outer `finally` per `handleSpawn` — a follower between join and channel-spawn still holds its lease.
3. Disconnect-close uses lease count, not channel-presence alone.
4. All map removals/aborts are identity-checked (acquisitions + prompts + agent events).
5. ALL prompts (host-key AND passphrase) are promptId-keyed with `ownerAcqId`; cleared by owner identity — never bare hostId.
6. `release(lease)` is idempotent (per-lease flag) and runs on EVERY exit path → no underflow, no leak; `closeSession` does not consume leases.
7. connect/reconnect commit is a single sync guarded step (`map===acq && state===CONNECTING && !aborted && session current`) → cannot revive a closed session nor double-resolve.
8. **Single authority (P2)**: acq exists only while CONNECTING/RECONNECTING; deleted on commit; fast-path and acq never both govern a host.
9. **Serialized transitions (P1)**: no `await` inside a check-and-mutate; joins refused once CLOSING/FAILED is set (state flip precedes async teardown).
10. Reconnect is part of the state machine (a generation with its own AbortController), abortable by closeSession; agent-event handlers identity-guarded.

## Implementation plan

- `session-context.ts`: `SessionAcquisition`, `Lease`, `pendingPrompts` shape.
- New owner module `session-acquisition.ts` with the 6 synchronous primitives
  (`acquire`, `join`, `commit`, `fail`, `release`, `close`) + `shutdownAll`. `handleSpawn`
  calls `acquire`/`join`, then `release(lease)` in one outer finally — NO inline bookkeeping.
- Fold the existing branch's reconnect logic into the RECONNECTING generation; reuse its
  backoff but under the acq `controller`.
- Migrate host-key + passphrase prompts to the promptId+ownerAcqId map.
- Preserve already-merged behavior: SPAWN_OK ordering, multi-client CHANNEL_CREATED,
  passphrase cache (15min TTL), auth-prompt 120s timeout, host-key TOFU/mismatch/trust-once,
  SEC-003 clientId guard.
- Tests: one per invariant 1–10, deterministic (drive primitives directly with controllable
  connect + spies; no real timing). Plus the existing coalescing/abort/verify-prompt suites
  kept green.

## Scope note

Invariant 10 (reconnect folded into the state machine) is the heaviest piece — it touches
the existing reconnect/backoff path. If implemented incrementally: land the
acquire/join/commit/release/close core + prompt ownership first (invariants 1–9), then
reconnect integration (invariant 10) as a second commit, each gated.
