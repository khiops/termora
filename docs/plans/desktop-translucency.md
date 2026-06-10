---
doc-meta:
  status: draft
  scope: desktop
  type: specification
  created: 2026-06-10
  updated: 2026-06-10
  adversarial_applied: true
  production_audit_applied: true
---

# Desktop Window Translucency & Background Modes (#58)

**Brief:** `docs/briefs/desktop-translucency.md` (ideation 2026-06-10, decisions validated).
**Issue:** khiops/termora#58. **Prior-art:** `~/.claude/prior-art/tauri.md`.

## §1 Scope

Three explicit background modes per scope — `image` / `solid` / `transparent` — replacing the implicit "wallpaper set or not" model, plus native window effects (vibrancy/mica/blur) on desktop. The Tauri window is created `transparent: true` permanently on all OS; CSS paints opacity in non-transparent modes.

**In scope:** shared profile fields, hub cascade + TOML parsing, web rendering + Wallpaper settings UI, tauri.conf + Cargo feature, runtime `setEffects`, per-OS effect filtering, web-build fallback.
**Out of scope:** macOS opt-out toggle (designed, deferred — see §2), click-through regions, Wayland `ext-background-effect`, per-effect tuning (radius/color).

## §2 Reality constraints & scope pivots

1. **macOS GPU cost accepted (operator decision 2026-06-10).** `transparent: true` costs ~8× GPU power on macOS even for CSS-opaque static content (tauri-apps/tauri#15471, open, no fix). Options "restart-gated opt-in" and "carve-out macOS" were explicitly proposed and REJECTED by the operator: macOS is an untested distribution target today (dmg built in CI, never run on real hardware). Single code path wins. **Reviewers: do not re-litigate** — the mitigation path (macOS-only restart-gated opt-out) is designed in the brief and tracked in TODO.local.md, to be built only if real macOS users report battery issues or the upstream issue is fixed.
2. **No real macOS/Windows-11-Mica test hardware in CI.** Effects ship best-effort on macOS (untested), manually verified on Windows 10/11 and Linux (WSL2 host + native). Release notes must flag macOS effects as untested.
3. **`transparent` is creation-time-only** (Tauri WindowConfig) — that is WHY the window is always transparent and modes are CSS-side. No restart flow exists in this design.
4. **App Store excluded** by `macos-private-api` — irrelevant (GitHub Releases distribution only).

## §3 Data model

### §3.1 New `TerminalProfile` fields (packages/shared/src/entities.ts)

| Field | Type | Default (`DEFAULT_PROFILE`) | TOML key (`[terminal]`) |
|-------|------|------------------------------|--------------------------|
| `backgroundMode` | `"image" \| "solid" \| "transparent"` | `"image"` | `background_mode` |
| `windowEffect` | `"none" \| "auto" \| "mica" \| "blur" \| "acrylic" \| "vibrancy-under-window" \| "vibrancy-sidebar" \| "vibrancy-hud"` | `"none"` | `window_effect` |

- **Default `"image"` preserves existing behavior with zero migration**: `image` + `wallpaper` set → current wallpaper rendering; `image` + `wallpaper: ""` → solid (`--nt-bg`) — exactly today's two states. Existing `profileJson` rows need no rewrite.
- Both fields cascade like `wallpaper*` (defaults → config.toml → host `profileJson` → channel `profileJson`).
- **Casing contract (C-1): REST bodies are camelCase ONLY** — `PATCH .../profile { profile: { backgroundMode } }` and `PUT /api/config/global { terminal: { backgroundMode } }` (the allowlist `TERMINAL_PROFILE_KEYS` holds camelCase keys, so a snake_case body key is rejected 400). snake_case exists in exactly one place: the `config.toml` file on disk (`background_mode`), converted at the file boundary by `snakeToCamel`/`camelToSnake`. **The conversion is ALGORITHMIC, not a lookup table** (audit: `_tomlSectionToProfile`, hub/src/config.ts:399, iterates all keys through `snakeToCamel`; the TOML loader does not reject unknown `[terminal]` keys) — **no hub code change is needed for the TOML direction**; the only allowlist to edit is `TERMINAL_PROFILE_KEYS` in `packages/shared/src/config.ts:298`.
- `windowEffect` is meaningful only when the resolved mode is `transparent` AND runtime is Tauri; otherwise ignored at render.

> **BLOCKING (AF-1) — `TERMINAL_PROFILE_KEYS` allowlist must include both new fields.** `packages/shared/src/config.ts` exports `TERMINAL_PROFILE_KEYS` (line ~298), a hard allowlist enforced at FOUR write-back points in the hub: `PUT /api/config/global` (config.ts:99), host PATCH (config.ts:242), channel PATCH (config.ts:380) — each **rejects the entire request with HTTP 400 `Unknown profile key: <key>`** if any body key is absent — and `ConfigResolver.saveGlobalTerminal` (hub/src/config.ts:934) which **throws** for unknown keys. Until `"backgroundMode"` and `"windowEffect"` are added to this array, S10's PATCH returns 400 and global TOML write-back throws — the feature is inert end-to-end. This array is the single source the implementer MUST edit in B1; the cascade/`snakeToCamel` plumbing is insufficient on its own.

### §3.2 Effect resolution matrix (`"auto"` and per-OS validity)

| Resolved effect | Linux | Windows 10 (<22000) | Windows 11 (≥22000) | macOS |
|-----------------|-------|---------------------|----------------------|-------|
| `auto` | none | `blur` | `mica` | `vibrancy-under-window` |
| `mica` | — | ✗→none | ✓ | — |
| `acrylic` | — | ✓ (UI warns: laggy) | ✓ | — |
| `blur` | — | ✓ | ✓ (UI warns: perf on 22621+) | — |
| `vibrancy-*` | — | — | — | ✓ |
| invalid-for-OS | none | none | none | none |

Invalid combinations degrade to `none` silently at apply time (never crash); the settings UI only OFFERS valid options for the detected OS.

> **AF-2 — no value validation exists anywhere on the resolve path; render/apply MUST be the validation boundary.** Verified: `_tomlSectionToProfile` (hub/config.ts) only maps snake→camel and casts — it does **no value checking**; `ConfigResolver.resolve()` deep-merges raw `JSON.parse` of host/channel `profileJson` with a silent `catch` on malformed JSON, but performs **no enum validation** on well-formed-but-invalid values. `TerminalProfile` carries an index signature `[key: string]: unknown`, so neither TypeScript nor the runtime rejects `backgroundMode: "garbage"`. The `TERMINAL_PROFILE_KEYS` allowlist gates KEY names only, never VALUES. Consequences the implementer MUST handle:
> - **Unknown `backgroundMode`** (typo, hand-edited TOML, a *newer* client's enum value reaching an *older* hub via a synced config, or a *newer* config read by an *older* build) → the rendering switch (B2) MUST treat any value not in `{image, solid, transparent}` as `"image"` (the safe default that preserves current behavior), never leave the screen unstyled.
> - **Unknown `windowEffect`** → `useWindowEffects` (B4) MUST map any value outside the §3.2 matrix to `none` (the existing "invalid-for-OS → none" path covers this if the lookup is allowlist-based, not denylist-based).
> - These are pure-function fallbacks (no I/O), so they are unit-testable — see S13/S14.

## §4 Architecture & data flow

```
ConfigResolver.resolve() (hub)  ──cascade──▶  GET /api/config/cascade
        │                                          │
   config.toml [terminal]                useResolvedProfile / useActiveWallpaper (web)
   background_mode/window_effect                   │
                                    ┌──────────────┴────────────────┐
                              backgroundMode                  windowEffect (Tauri only)
                                    │                               │
                        App.vue rendering switch          applyWindowEffects(effect)
                  image → wallpaper layer (existing)      getCurrentWindow().setEffects /
                  solid → opaque var(--nt-bg)             clearEffects when mode≠transparent
                  transparent → .app-root
                               background: transparent
```

- **Rendering switch** lives where `windowWallpaperStyle` is computed today (`useActiveWallpaper` → App.vue): the active pane's resolved profile drives the whole window, reusing the PR #57 cross-fade/cache mechanism.
- **`applyWindowEffects`**: new web-side module, called when the active-pane resolved profile changes. Tauri import follows the existing `TitleBar.vue` mechanism: a **dynamic `await import("@tauri-apps/api/window")` inside a `try/catch`** (TitleBar.vue `initTauri`, lines 13-25), which is the runtime guard — in a non-Tauri build the import rejects and the catch no-ops. **AF-3 (open-item resolved):** the spec's flagged premise ("web package.json declares no `@tauri-apps/api`") is FALSE — `packages/clients/web/package.json` declares `"@tauri-apps/api": "^2.10.1"` as a direct dependency, so the module resolves at build time on both web and desktop builds; the try/catch (not a missing dep) is what makes it browser-safe at runtime. `useWindowEffects` reuses this exact dynamic-import-in-try/catch pattern; do NOT add a static top-level import (it would still bundle fine, but the dynamic form is the established convention and keeps Tauri out of the eager web bundle).
- **AF-4 — `useWindowEffects` CANNOT piggyback on the existing wallpaper watcher's projected value.** `useActiveWallpaper` reduces the resolved profile to a 3-field `WallpaperProfile` (`wallpaperFields()` keeps only `wallpaper`/`wallpaperBlur`/`wallpaperDim`); `displayedWallpaper`, the cache, and the cross-fade all operate on that projection, which **strips `backgroundMode`/`windowEffect`**. The effect/mode logic must read the **full** `resolvedProfile` + `resolvedForActivePane` from `useResolvedProfile` directly (the same inputs `useActiveWallpaper` consumes), not the wallpaper projection. Either extend the composable to also expose `backgroundMode`/`windowEffect`, or have `useWindowEffects` take `(resolvedProfile, resolvedForActivePane, platformInfo)` as inputs. "Same trigger as the wallpaper" is correct in spirit (the `[resolvedFor, resolvedProfile, activeScopeKey]` watcher) but NOT via the `WallpaperProfile` object.
- **AF-5 — pane-switch / resolution race on the async `setEffects` IPC.** `useActiveWallpaper`'s watchers are `flush: "sync"` (fire synchronously on scope-key/profile change), but `Window.setEffects()` / `clearEffects()` are **async Tauri IPC** calls. Under rapid pane switching (A→B→A) or the unresolved-then-resolved transition (`startUnresolvedFallbackTimer` shows a cached/default scope before the real cascade lands), IPC responses can resolve out of order, leaving the window in the wrong effect state (e.g. a stale `setEffects(mica)` landing after a `clearEffects()`). `useWindowEffects` MUST be latest-wins: capture a monotonically-increasing generation token (or the active scope-key) before each async apply and no-op the result if the active scope changed while the IPC was in flight. **Reconciliation on stale completion (C-2):** ignoring a stale promise result is NOT enough — the stale IPC has already mutated native window state by the time it resolves (e.g. a stale `clearEffects()` landing after a newer `setEffects(mica)`). After EVERY IPC completion, if the generation advanced while it was in flight, RE-APPLY the current desired state (idempotent re-apply; the token makes it converge). **Clear-only-if-applied (C-5):** track whether an effect was actually applied in this window; `clearEffects()` is called only when leaving an applied-effect state — on Linux / browser / platformInfo-null paths where nothing was ever applied, leaving transparent mode is a no-op (no gratuitous IPC). Also avoid applying effects for an UNRESOLVED scope — gate on `resolvedForActivePane.value` exactly like the wallpaper write-path does (line 127 of useActiveWallpaper), so a transient default/cached scope does not trigger a flicker apply→clear→re-apply.
- **OS detection (audit-revised — canonical plugin instead of custom command)**: use **`tauri-plugin-os`** (official, same family as the `shell`/`updater` plugins already registered in lib.rs) rather than a hand-rolled `get_platform_info` command: Cargo dep `tauri-plugin-os = "2"` + `.plugin(tauri_plugin_os::init())` + npm `@tauri-apps/plugin-os` in the web package. Web-side `platformInfo` is derived once at startup via dynamic import in try/catch (TitleBar pattern): `os = platform()` (`"windows" | "macos" | "linux"`), `windowsBuild = parseInt(version().split(".")[2])` on Windows (Tauri reports e.g. `10.0.22631`), `null` elsewhere or on any failure. Audit confirmed no OS-detection crate exists in Cargo.toml today; the plugin is the upstream-recommended surface (prior-art discipline) and avoids picking a registry-reading crate ourselves. **Failure semantics (C-3):** the command can fail, be unavailable (older desktop build), or race startup → `platformInfo = null`. `platformInfo === null` disables EFFECTS only (no `setEffects` ever called; clear is a no-op per C-5). CSS transparency does NOT depend on platformInfo: in a Tauri runtime (`isTauriRuntime()`), `backgroundMode: "transparent"` still renders transparent (the window IS transparent by construction); only in a non-Tauri runtime does transparent render as solid (S4).
- **Tauri config**: `app.windows[0].transparent: true`; `macOSPrivateApi: true` goes at the **`app` object level** (sibling of `windows`/`security` — audit MISMATCH-5: the current `app` object is `{ windows, security }` only), NOT inside `windows[0]`; Cargo `tauri` features += `macos-private-api`. `decorations: false` already set, no `shadow` key exists anywhere (OS-default shadow behavior — the C-7 smoke checklist tests that default, not a configured value); TitleBar drag + window shadow are regression-checked.

## §5 BDD scenarios

```gherkin
Scenario: S1 — backward compat, wallpaper set (existing users)
  Given a host profile with wallpaper "w.jpg" and no backgroundMode key
  When the cascade resolves
  Then backgroundMode is "image" and the wallpaper layer renders as before #58

Scenario: S2 — backward compat, no wallpaper
  Given no wallpaper at any scope and no backgroundMode key
  Then the app paints opaque var(--nt-bg) (identical to pre-#58)

Scenario: S3 — transparent mode on desktop
  Given backgroundMode "transparent" resolved for the active pane AND Tauri runtime
  Then .app-root has background transparent (audit: html/body/#app carry NO background today — App.vue:1384 — only .app-root:1395 paints var(--nt-bg); applyTheme writes only :root CSS vars, never a background)
  And the wallpaper layer is not rendered
  And region opacity sliders act as glass over the OS desktop

Scenario: S4 — transparent mode in browser
  Given backgroundMode "transparent" AND non-Tauri runtime
  Then rendering is identical to "solid" (opaque --nt-bg)

Scenario: S5 — image mode without wallpaper
  Given backgroundMode "image" and wallpaper ""
  Then rendering is identical to "solid"

Scenario: S6 — per-scope switch follows active pane
  Given host A resolves "transparent" and host B resolves image "w.jpg"
  When the active pane switches from A to B
  Then the window background transitions transparent → wallpaper (existing cross-fade)
  And setEffects is cleared on A→B if B is not transparent

Scenario: S7 — effect auto resolution
  Given backgroundMode "transparent", windowEffect "auto", Tauri on Windows build 26100
  Then setEffects is called with mica
  Given the same on Windows build 19045 → blur
  Given the same on Linux → no setEffects call

Scenario: S8 — invalid effect degrades silently
  Given windowEffect "mica" resolved on Windows 10
  Then no effect is applied (none) and no error surfaces

Scenario: S9 — TOML layer
  Given config.toml [terminal] background_mode = "transparent"
  When the cascade resolves with no host/channel override
  Then resolved.backgroundMode === "transparent"

Scenario: S10 — settings UI scope override
  Given the Wallpaper settings on scope "host"
  When the user selects mode "Transparent"
  Then PATCH /api/hosts/:id/profile { profile: { backgroundMode: "transparent" } }
  And the override banner reflects the host-level override

Scenario: S11 — new keys accepted by the profile write-back allowlist (AF-1)
  Given backgroundMode and windowEffect are added to TERMINAL_PROFILE_KEYS
  When PATCH /api/hosts/:id/profile { profile: { backgroundMode: "transparent", windowEffect: "auto" } }
  Then the hub responds 200 and persists both keys to host profileJson
  And the same body BEFORE the allowlist change would have responded 400 "Unknown profile key: backgroundMode"
  And PUT /api/config/global { terminal: { backgroundMode: "solid" } } persists without throwing (camelCase body — C-1)

Scenario: S12 — unknown profile key still rejected (allowlist not weakened)
  Given the allowlist now contains backgroundMode and windowEffect
  When PATCH /api/channels/:id/profile { profile: { bogusKey: 1 } }
  Then the hub still responds 400 "Unknown profile key: bogusKey"

Scenario: S13 — unknown backgroundMode value degrades to image (AF-2)
  Given a host profileJson with backgroundMode "garbage" (hand-edited TOML or newer-client enum on an older build)
  When the cascade resolves and the rendering switch evaluates
  Then rendering is identical to "image" (the safe default), the screen is never left unstyled, and no error surfaces

Scenario: S14 — unknown windowEffect value degrades to none (AF-2)
  Given backgroundMode "transparent" AND Tauri AND windowEffect "shimmer" (not in the matrix)
  Then no effect is applied (none) and no error surfaces

Scenario: S15 — out-of-order setEffects under rapid pane switch is latest-wins (AF-5)
  Given active pane switches A(transparent/mica) → B(image) → A(transparent/mica) faster than setEffects IPC resolves
  When the stale clearEffects (from the A→B step) resolves after the final setEffects(mica)
  Then the final window state is mica (the latest scope wins; the stale IPC result is discarded via the generation token)

Scenario: S16 — no effect apply for an unresolved active scope (AF-5)
  Given the active pane's cascade has NOT yet resolved (resolvedForActivePane is false, fallback timer pending)
  Then useWindowEffects does NOT call setEffects/clearEffects
  And it applies effects only once resolvedForActivePane becomes true (no apply→clear→re-apply flicker)
```

## §6 Implementation blocks (vertical slices)

| Block | Scope / files | Observable success | Deps |
|-------|---------------|--------------------|------|
| **B1 — Model + cascade** | `shared/src/entities.ts` (2 optional fields, `?:` like all existing ones), `shared/src/config.ts` (DEFAULT_PROFILE **+ append `"backgroundMode"`, `"windowEffect"` to `TERMINAL_PROFILE_KEYS` (line 298) — AF-1, blocking**; CascadeResponse untouched — resolved profile carries new fields automatically). **NO hub/src/config.ts change** (audit MISMATCH-2: snake↔camel conversion is algorithmic, `_tomlSectionToProfile` hub/src/config.ts:399 — TOML `background_mode` auto-becomes `backgroundMode`) | Hub tests: **S11 (200 + persist via PATCH and PUT global), S12 (unknown key still 400)**, S9 + cascade merge of both fields at all 4 layers; `pnpm -F @termora/shared build` then hub suite green. Note: there is no value-validation layer to add (AF-2) — value defaulting lives in B2/B4 render, not the hub | none |
| **B2 — Rendering** | `web/src/composables/useActiveWallpaper.ts` (expose `backgroundMode` from the full `resolvedProfile`, NOT via the 3-field `WallpaperProfile` projection — AF-4), `web/src/App.vue` (mode switch + html/body/.app-root transparent CSS; **unknown backgroundMode → treat as "image"** — AF-2) | Web tests: S1-S6 + S13 rendering decisions (computed-level); visual check in browser = no regression | B1 |
| **B3 — Settings UI** | `web/src/components/settings/categories/WallpaperCategory.vue` (+ 3-mode selector, effect picker), `web/src/stores/settings.ts` (no change expected — generic key/value). **Runtime visibility rule (C-4):** the MODE selector (Image/Solid/Transparent) is shown in ALL runtimes — it is a per-scope server-side setting that desktop clients of the same hub honor; in a non-Tauri runtime the Transparent option carries a hint "(desktop only — renders as solid in this browser)". The EFFECT picker is shown ONLY in Tauri runtime (it requires local `platformInfo` for OS filtering; hidden when `platformInfo === null`). **Override plumbing (audit MISMATCH-4, latent bug):** extend BOTH `hasWallpaperOverride` (WallpaperCategory.vue:166-173) AND `resetWallpaperOverride` (lines 249-253) to include `backgroundMode` AND `windowEffect` — otherwise a host-scope mode override silently survives "Reset Override" while the banner disappears. **"None" button semantics:** "None" keeps its current behavior (clears `wallpaper` to `""` only); it never touches `backgroundMode` — the mode is controlled solely by the selector (consistent: image + empty wallpaper renders solid per S5). | Web tests: S10 payloads per scope; override detection + reset cover both new keys; mode selector visible + hinted in browser, effect picker hidden in browser/null-platform | B1 |
| **B4 — Desktop shell + effects** | `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` (+`tauri-plugin-os`, +`macos-private-api` feature), `desktop/src-tauri/src/lib.rs` (`.plugin(tauri_plugin_os::init())`), `web/package.json` (+`@tauri-apps/plugin-os`), new `web/src/composables/useWindowEffects.ts` (dynamic `import("@tauri-apps/api/window")` in try/catch per TitleBar.vue — AF-3; inputs = full `resolvedProfile` + `resolvedForActivePane` + cached platformInfo — AF-4; **latest-wins generation token around the async setEffects/clearEffects IPC + gate on resolvedForActivePane** — AF-5; **unknown windowEffect → none, allowlist lookup not denylist** — AF-2; apply/clear S7/S8 matrix) | Web tests: S7/S8 matrix + S14 (unknown effect→none) as pure function, **S15 (out-of-order IPC latest-wins), S16 (no apply for unresolved scope)**; manual: Windows 10+11 + Linux (KDE/Mutter) checklist — desktop visible through, titlebar drag OK, shadow OK, effects applied | B2 |
| **B5 — Docs + release notes** | `docs/SPEC.md` §config cascade table, README config sample, release-notes draft (macOS untested flag, Linux compositor requirement) | Docs mention all 3 modes + per-OS matrix; `pnpm lint` green | B1-B4 |

**Gates per block (stack-gates):** `pnpm -F <pkg> test > <TEMP_DIR>/out.log 2>&1` capture-once; `pnpm lint`; B4 Rust: `cargo clippy --all-targets -- -D warnings` (no cfg(windows) code expected in lib.rs change — `get_platform_info` is cross-platform).

## §7 Test requirements

- **Unit/integration (vitest):** cascade merge (hub), TOML snake_case mapping (hub), **`TERMINAL_PROFILE_KEYS` allowlist accepts the 2 new keys + still rejects unknown keys — S11/S12 (hub)**, rendering mode switch incl. **unknown-value → "image" fallback — S13 (web)**, effect matrix pure function incl. **unknown-effect → none — S14 (web)**, **`useWindowEffects` latest-wins + unresolved-scope gating — S15/S16 (web, with a deferred/out-of-order fake `setEffects`)**, settings payloads (web). No mocks of hub APIs in web tests beyond the existing HTTP-intercept conventions; for S15/S16 use a fake Tauri `Window` whose `setEffects`/`clearEffects` resolve on a controllable deferred (not a mock of the IPC transport).
- **Cascade robustness (C-6):** one hub test asserting that a MALFORMED host/channel `profileJson` (the resolver's silent-catch path) does not block `backgroundMode` resolution from lower layers (defaults/TOML) — malformed JSON + new keys must coexist.
- **Manual matrix (pre-merge, real builds):** Linux native (compositor) + Windows 10 + Windows 11 via the SEA/NSIS local build flow (`docs/` Windows build memory). macOS: explicitly untested (release-note flag).
- **Regression:** titlebar drag (`decorations: false`), window shadow, wallpaper cross-fade (PR #57), region alpha sliders. **Desktop smoke checklist (C-7), explicitly AFTER `transparent: true` lands:** (1) window shadow present/absent per OS expectation, (2) titlebar drag + double-click maximize, (3) resize from all edges — this is exactly where Tauri/window-manager regressions appear with transparent+undecorated windows.

## §8 Adversarial findings ledger (§12.5)

Severity: **S** (blocks correct delivery — must fix in MVP), **M** (real risk, fix in MVP), **L** (minor / defer). Verified against real code via astix on `khiops/termora`.

| ID | Severity | Finding | Resolution (amended §X / rejected: reason) |
|----|----------|---------|---------------------------------------------|
| AF-1 | **S** | New fields are silently un-persistable: `TERMINAL_PROFILE_KEYS` (shared/config.ts:298) is an allowlist enforced at 4 hub write-back points — host/channel PATCH + `PUT /api/config/global` reject the WHOLE request with 400 `Unknown profile key`, and `saveGlobalTerminal` (hub/src/config.ts:934) throws. Spec only mentioned the snakeToCamel map. Without adding both keys the feature is inert end-to-end. | Amended §3.1 (BLOCKING note), §6 B1 (explicit allowlist edit + S11/S12 tests), §5 (S11/S12), §7. |
| AF-2 | **M** | No value validation exists on the resolve path: `_tomlSectionToProfile` only maps keys, `resolve()` deep-merges raw JSON (silent catch on malformed JSON only), `TerminalProfile` has `[key: string]: unknown`. Unknown enum values (typo / hand-edit / newer-client config on older build / vice-versa) flow through unchecked. Render must be the validation boundary. | Amended §3.2 (AF-2 note: render defaults unknown mode→image, unknown effect→none), §5 (S13/S14), §6 B2/B4, §7. |
| AF-3 | **S→resolved** | Spec's flagged open item is factually FALSE: `web/package.json` DOES declare `@tauri-apps/api ^2.10.1`. The browser-safety comes from TitleBar.vue's dynamic `await import("@tauri-apps/api/window")` in try/catch, not from a missing dep. Leaving the false premise would send the implementer chasing a non-problem. | Amended §4 (corrected text + the real mechanism `useWindowEffects` must reuse). |
| AF-4 | **M** | "setEffects fires from the same watcher as the wallpaper" is unworkable as literally written: `useActiveWallpaper` projects the resolved profile to a 3-field `WallpaperProfile` (`wallpaperFields()`), stripping `backgroundMode`/`windowEffect`. Effects must read the full `resolvedProfile`/`resolvedForActivePane`, not the projection. | Amended §4 (AF-4 note), §6 B2/B4 (input contract). |
| AF-5 | **M** | Concurrency: wallpaper watchers are `flush:"sync"` but `setEffects`/`clearEffects` are async Tauri IPC. Rapid pane switch (A→B→A) or unresolved→resolved transition (`startUnresolvedFallbackTimer`) can land IPC out of order → wrong effect state / flicker. | Amended §4 (AF-5 note: latest-wins generation token + gate on `resolvedForActivePane`), §5 (S15/S16), §6 B4, §7. |
| AF-6 | **L** | Pre-existing dead-code quirk in the allowlist loops (`key !== null` over `Object.keys`, which never yields null — config.ts:242/380). Touched by B1 area but not introduced by this feature. | Rejected (out of scope): pre-existing; do not expand the diff. Noted for a future cleanup pass, not this story. |
| AF-7 | **L** | Skeptic: is "transparent in browser == solid" (S4) a silent surprise? A web user selecting Transparent sees no change. | Superseded by C-4 (§9): the mode selector IS offered in browser (per-scope setting consumed by desktop clients) with an explicit "(desktop only)" hint — no silent surprise; only the effect picker is Tauri-only. |
| AF-8 | **L** | Brief §Decision-2 / MVP-Feature-2 state default `backgroundMode: "solid"`, but spec §3.1 sets default `"image"` (the zero-migration choice). | Not a finding against the spec: spec overrides brief and `"image"` is internally consistent (preserves today's behavior with no profileJson rewrite). Brief text is stale but out of adversarial scope (do-not-re-litigate validated decisions); flagged here only so the implementer trusts §3.1. |
| AF-9 | **L** | macOS GPU 8× cost, restart-gating, macOS carve-out. | Rejected per §2 operator constraint (out of adversarial scope — explicitly validated). |

## §9 /llm --spec consensus (§12.6)

Run 2026-06-10 via `llm-delegate.sh --mode consensus --llm all`. **codex: success** (7 findings below). **gemini: failed** (internal CLI crash after 107s), **copilot: failed** (rate-limited, 5s) — both are tool-side outages unrelated to the spec content; consensus proceeds on codex alone (documented degraded run; the binding pre-push gate at review stage will re-attempt copilot).

| ID | Severity | Finding (spec §) | Resolution |
|----|----------|------------------|------------|
| C-1 | M | API casing inconsistent: S11 used a snake_case REST body while §3.1 says camelCase — tests would encode the wrong contract | Amended §3.1 (explicit casing contract: REST camelCase only, snake_case only in config.toml) + S11 fixed |
| C-2 | M | Generation token alone can't undo a stale `clearEffects` that already mutated native state before resolving | Amended §4 AF-5 note: mandatory reconciliation — on stale completion, re-apply current desired state |
| C-3 | M | `get_platform_info` failure/unavailability/startup-race unspecified | Amended §4: `platformInfo=null` disables effects only; CSS transparency independent of platformInfo in Tauri runtime |
| C-4 | M | B3 "picker hidden in browser" vs AF-7 "option not offered" contradiction | Amended §6 B3 (runtime visibility rule: mode selector always shown + hinted; effect picker Tauri-only) + AF-7 resolution updated |
| C-5 | L | "Linux auto→none = no setEffects call" vs S6 "clear on leave" — gratuitous clearEffects on never-applied paths | Amended §4: clear-only-if-applied tracking |
| C-6 | L | No test for malformed persisted profileJson coexisting with the new keys | Amended §7 (cascade robustness test) |
| C-7 | L | `decorations:false` + transparent regressions only loosely covered | Amended §7 (explicit 3-point desktop smoke checklist) |

## §10 Production reality audit

Run 2026-06-10 (audit-spec-reality, astix on `khiops/termora`). 9 topics: 0 ALREADY-IMPLEMENTED, 7 GAP (expected work, confirmed), 5 MISMATCH (all corrected in place — §3.1 conversion-is-algorithmic + B1 file list, §4/S3 `.app-root`-only, §6 B3 override/reset extension + "None" semantics, §4 `macOSPrivateApi` placement, AF-1 line refs), 1 UNCLEAR resolved (Windows build detection → `tauri-plugin-os`, §4). Confirmed nil-change claims: cascade endpoint + `useResolvedProfile` carry new fields with zero filtering; settings store `updateSetting` generic; PR #57 cross-fade key is mode-independent and behaves correctly for all mode transitions (solid↔transparent share key `'none'` → no spurious fade). Latent bug pre-empted: `resetWallpaperOverride` missing the new keys would have silently preserved a mode override after "Reset Override".
