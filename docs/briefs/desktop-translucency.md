---
doc-meta:
  status: draft
  scope: desktop
  type: design
  created: 2026-06-10
  updated: 2026-06-10
---

# Desktop Window Translucency & Background Modes — Ideation Brief (#58)

## Problem Statement

**Problem:** The 4 region opacity sliders (host rail / sidebar / tab bar / terminal, PR #57) have no visible effect without a wallpaper: in a browser there is nothing behind the app. Their real use case is desktop: a transparent native window lets the OS desktop show through, turning the sliders into "glass".

**Root cause:** The app conflates two background states — "no wallpaper" renders the opaque theme background (`.app-root { background: var(--nt-bg) }`). There is no transparent state. Three explicit modes are needed: **Image / Solid / Transparent**.

**Target users:** Desktop (Tauri) users. Web build users are unaffected (Transparent falls back to Solid).

**Current state:** `tauri.conf.json` window has `decorations: false` (custom TitleBar.vue) but NOT `transparent: true`. No `windowEffects` configured. Per-scope wallpaper resolution driven by the active pane is already in place (`useActiveWallpaper` / `useResolvedProfile`).

## Decisions (validated 2026-06-10)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where to configure | **Option A — Wallpaper section only.** Background mode (`image` \| `solid` \| `transparent`) is a per-scope profile field in the Wallpaper settings, honoring the global → host → channel cascade and following the active pane (same model as the window-wide wallpaper, PR #57). |
| 2 | Window transparency enablement | **Always transparent on desktop, all OS.** `transparent: true` is creation-time-only in Tauri, so the window is created transparent permanently; CSS paints an opaque background in Solid/Image modes. Instant mode switching, single code path, no restart. |
| 3 | MVP scope | **Native window effects included in MVP** (vibrancy on macOS, mica/acrylic/blur on Windows), with per-OS fallbacks. |

### Accepted risk — macOS GPU cost

tauri-apps/tauri#15471 (open, no fix/workaround): on macOS, `transparent: true` forces per-frame full-window recompositing by WebKit/WindowServer even for fully static content — ~620 mW GPU vs ~75 mW opaque (~8×) on M5 Pro, GPU process at 1380% CPU on Intel 2019. The cost is triggered by the *window* property, not the displayed content, so macOS users in Solid mode pay it too.

**Accepted because:** macOS is currently an untested distribution target (dmg built in CI, never validated on real hardware). **Mitigation path if real macOS users report battery/thermal issues:** add a macOS-only opt-out (restart-gated opaque window) — the CSS mode model is unaffected by that change.

Note: macOS transparency requires the `macos-private-api` feature flag → App Store distribution excluded (not a concern: GitHub Releases only).

## Key Technical Facts (verified upstream, 2026-06-10)

| Fact | Source | Design implication |
|------|--------|--------------------|
| `transparent` is creation-time only; `windowEffects` ARE runtime-settable via `Window.setEffects()` (requires transparent window) | docs.rs/tauri | Window always transparent; effects follow the active scope at runtime like the wallpaper does |
| Tauri v2 `windowEffects` wraps the `window-vibrancy` crate — no benefit to using the crate directly | docs.rs, tauri source | Use built-in API only |
| Windows: `Mica`/`Tabbed` = Win11 only; `Acrylic` = Win10 1809+ but documented lag on drag/resize since 1903; `Blur` = Win7+ but perf issues on Win11 22621+ | docs.rs/window-vibrancy | Effect picker must filter by OS build: Win11 → mica (default), Win10 → blur, never acrylic by default |
| Linux: plain alpha works **only with a compositor** (undefined otherwise); zero vibrancy effects | docs.rs/window-vibrancy | Linux = alpha only, no effect picker; document compositor requirement |
| macOS: vibrancy via NSVisualEffectView variants (Sidebar, HudWindow, UnderWindowBackground…); pre-10.14 variants deprecated | docs.rs/tauri Effect enum | Curate a short list of modern variants |
| `transparent: true` + `decorations: false` compatible; shadow may need attention on Windows; custom drag regions already handled by TitleBar.vue | tauri.app window customization | Regression-test titlebar drag + window shadow |

## MVP Features

1. **Tauri config** — `transparent: true` + `macosPrivateApi: true` in `tauri.conf.json`; verify window shadow and TitleBar drag regions still behave with `decorations: false`.
2. **Profile cascade** — new per-scope fields: `backgroundMode: "image" | "solid" | "transparent"` (default `image` — zero-migration: `image` + empty wallpaper renders solid, see spec §3.1) and `windowEffect` (per-OS enum, only meaningful when mode = transparent).
3. **Wallpaper settings UI** — 3-mode selector replacing the implicit wallpaper-presence logic; effect picker shown only on desktop, options filtered by detected OS (Win11/Win10/macOS; hidden on Linux).
4. **Rendering** — mode `transparent` → `.app-root`/`html`/`body` background transparent + wallpaper layer hidden; opacity sliders act as glass over the desktop. Web build or mode unavailable → fallback to Solid.
5. **Runtime effects** — `Window.setEffects()` called from the web client when the resolved active-scope background changes (same trigger as the window-wide wallpaper); effects cleared when mode ≠ transparent.
6. **Fallback matrix** — Win10: blur instead of acrylic; Linux: alpha only + compositor note in docs; web: solid.

## Later (out of MVP)

- macOS opt-out (restart-gated) if GPU cost becomes a real-user complaint (see Accepted risk).
- Click-through regions, per-effect radius/color tuning.
- Wayland `ext-background-effect` (not yet in window-vibrancy upstream).

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| macOS permanent GPU tax (~8×) | M (no tested macOS user base today) | Accepted; opt-out path designed (see above) |
| Linux without compositor → undefined rendering | M | Document requirement; Solid remains default mode |
| Acrylic lag on Win10 | L | Never default to acrylic; Win10 default = blur |
| Window shadow / drag regression with transparent+undecorated | M | Explicit regression test on Windows + Linux before merge |
| No real macOS test hardware | M | macOS effects ship best-effort, flagged untested in release notes |

## Next Steps

1. `/prior-art add tauri https://v2.tauri.app/` (+ window-vibrancy notes) — required before `/spec` (Gate 5 blocks on missing entry).
2. `/spec` from this brief → BDD scenarios + implementation plan (touches: tauri.conf.json, shared profile types, hub config cascade, web Wallpaper settings + App.vue rendering, desktop lib.rs none expected).
3. `/workflow` (COMPLEX — multi-package, platform-specific).
