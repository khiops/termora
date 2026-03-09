---
doc-meta:
  status: draft
  created: 2026-03-09
---

# Packaging & Distribution Strategy

> **Project:** /mnt/wsl/shared/dev/nexterm

## Problem

nexterm has two runtime components:
- **Hub+Agent** — Node.js daemon (node-pty, better-sqlite3, ssh2 — native addons)
- **Web UI** — Vue 3 SPA (embedded by hub as static files, or served by Vite in dev)

Users need a zero-friction install. Node.js as a prerequisite is acceptable for developers but not for general users.

## Architecture: Binary vs Installer

```
┌───────────────────────────────────────────────────────┐
│  BINARY = the application that runs                   │
│                                                       │
│  Hub+Agent binary (Node SEA or native)                │
│  + Tauri shell (optional, for native window/tray)     │
└──────────────────────┬────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────┐
│  INSTALLER = how it reaches users                     │
│                                                       │
│  npm pack / npx (devs) — winget / scoop (Windows)     │
│  brew (macOS) — AppImage / flatpak (Linux)            │
│  GitHub Releases (universal)                          │
└───────────────────────────────────────────────────────┘
```

## Phase 1: npm pack (now)

**Goal:** Test on Windows immediately, no publishing required.

```bash
# On dev machine (WSL/Linux)
cd /mnt/wsl/shared/dev/nexterm
pnpm build
npm pack                            # → nexterm-0.1.0.tgz

# On Windows
npm i -g ./nexterm-0.1.0.tgz       # installs globally
nexterm                             # starts hub on localhost:4100
```

**Pros:** Zero setup, works today.
**Cons:** Requires Node.js installed. Native addons need build tools (node-gyp).

### Native addon issue on Windows

`node-pty` and `better-sqlite3` need compilation. Windows requires:
- Visual Studio Build Tools (or `windows-build-tools` npm package)
- Python 3.x

**Mitigation:** Ship prebuilt binaries via `prebuild-install` (both packages support it).

## Phase 2: Node SEA (MVP)

**Goal:** Single binary, no Node.js prerequisite.

### What is Node SEA?

Node.js Single Executable Applications (stable since Node 22). Embeds the app into the Node binary itself.

```bash
# 1. Bundle all JS into one file (esbuild)
esbuild packages/hub/src/server.ts --bundle --platform=node --outfile=dist/nexterm.cjs

# 2. Create SEA config
echo '{ "main": "dist/nexterm.cjs", "output": "dist/sea-prep.blob" }' > sea-config.json

# 3. Generate blob
node --experimental-sea-config sea-config.json

# 4. Copy node binary and inject
cp $(which node) dist/nexterm       # or nexterm.exe on Windows
npx postject dist/nexterm NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 5. Sign (Windows/macOS)
# signtool sign /fd SHA256 dist/nexterm.exe    # Windows
# codesign --sign "..." dist/nexterm           # macOS
```

### Native addons with SEA

**Challenge:** `node-pty` and `better-sqlite3` are native `.node` files — they can't be embedded in the SEA blob.

**Solution:** Ship them alongside the binary:
```
nexterm/
├── nexterm.exe          # SEA binary (~50MB)
├── node_pty.node        # native addon
├── better_sqlite3.node  # native addon
└── (runtime.json, etc.)
```

Or use `@aspect/node-addon-loader` to bundle `.node` files as assets extracted at runtime.

### Build matrix

| Platform | Node binary | Native addons |
|----------|-------------|---------------|
| Windows x64 | node-v22-win-x64 | prebuild-install |
| macOS x64 | node-v22-darwin-x64 | prebuild-install |
| macOS arm64 | node-v22-darwin-arm64 | prebuild-install |
| Linux x64 | node-v22-linux-x64 | prebuild-install |
| Linux arm64 | node-v22-linux-arm64 | prebuild-install |

CI: GitHub Actions matrix build, artifacts uploaded to Releases.

### Result

- `nexterm` / `nexterm.exe` — ~50MB standalone binary
- User opens browser to `http://localhost:4100`
- No Node.js prerequisite
- No build tools prerequisite

## Phase 3: Tauri v2 (v1 release)

**Goal:** Native window with system tray, auto-update, proper desktop app experience.

### Architecture

```
┌────────────────────────────────────────────┐
│  Tauri shell (Rust, ~5MB)                  │
│  ├── System webview (Edge/WebKit/WebKitGTK)│
│  │   └── Vue 3 UI (bundled)               │
│  ├── Sidecar: nexterm-hub (Node SEA, ~50MB)│
│  │   ├── Hub (Fastify, REST, WS)          │
│  │   └── Agent (node-pty, MessagePack)     │
│  └── Tauri features:                       │
│      ├── System tray icon + menu           │
│      ├── Auto-updater (GitHub Releases)    │
│      ├── Native notifications              │
│      ├── Deep links (nexterm://)           │
│      └── Global shortcuts                  │
└────────────────────────────────────────────┘
```

### Why Tauri over Electron?

| Aspect | Tauri v2 | Electron |
|--------|----------|----------|
| Binary size | ~5-10MB (+ sidecar) | ~150MB |
| Memory | System webview | Bundled Chromium |
| Security | Rust process isolation | Node in renderer (risky) |
| Auto-update | Built-in (GitHub) | electron-updater |
| Cross-platform | Windows/macOS/Linux/iOS/Android | Windows/macOS/Linux |

### Sidecar pattern

Tauri's sidecar feature manages the hub process lifecycle:

```rust
// src-tauri/src/main.rs
use tauri::api::process::Command;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Start hub sidecar
            let (mut rx, _child) = Command::new_sidecar("nexterm-hub")?
                .args(["--port", "4100"])
                .spawn()?;
            // Hub starts, Tauri webview loads http://localhost:4100
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri");
}
```

The sidecar binary = the Node SEA from Phase 2. Tauri manages its lifecycle (start/stop/restart).

### Build output

| Platform | Installer | Size |
|----------|-----------|------|
| Windows | `.exe` (NSIS) or `.msi` | ~60MB |
| macOS | `.dmg` | ~55MB |
| Linux | `.AppImage` + `.deb` | ~55MB |

## Distribution Channels

### Phase 2 (SEA binary)

| Channel | Format | Effort | Priority |
|---------|--------|--------|----------|
| GitHub Releases | .zip/.tar.gz per platform | CI only | P0 |
| npm (`npx nexterm`) | npm registry | ~1h | P0 |
| Scoop (Windows) | bucket manifest | ~1h | P1 |
| Homebrew (macOS/Linux) | tap formula | ~1h | P1 |

### Phase 3 (Tauri app)

| Channel | Format | Effort | Priority |
|---------|--------|--------|----------|
| GitHub Releases | platform installers | CI (Tauri action) | P0 |
| winget (Windows) | .exe + YAML manifest | ~2h | P1 |
| Homebrew Cask (macOS) | cask formula | ~1h | P1 |
| Flathub (Linux) | flatpak manifest | ~3h | P2 |
| Snap Store (Linux) | snapcraft.yaml | ~3h | P2 |

### winget specifics

winget accepts **both** `.exe` and `.msix`:
- `.exe` (NSIS/Inno): No Microsoft signing required. Submit YAML manifest to `microsoft/winget-pkgs` repo.
- `.msix`: Requires code signing certificate. Optionally published to Microsoft Store.

**Recommendation:** Start with `.exe` (loose manifest). Upgrade to `.msix` only if Microsoft Store distribution is desired.

## Decision Log

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Phase 1 binary | npm pack | - | Immediate, zero infra |
| Phase 2 binary | Node SEA | pkg (abandoned), nexe (fragile), Bun compile (no native addons) | Official Node.js feature, maintained |
| Phase 3 shell | Tauri v2 | Electron (150MB), Neutralino (no Node) | Lightweight, native, cross-platform |
| Phase 3 sidecar | Node SEA | Embedded Node | Clean separation, independent lifecycle |
| Windows installer | NSIS .exe | .msix | No signing cert needed for MVP |
| Auto-update | Tauri built-in (GitHub) | Squirrel, electron-updater | Zero config with Tauri |

## Timeline

| Phase | When | Deliverable |
|-------|------|-------------|
| 1 | Now | `npm pack` for manual Windows testing |
| 2 | Next milestone | SEA binary + GitHub Releases + npx |
| 3 | v1 release | Tauri desktop app + store distribution |
