# termora

A local-first session terminal platform. Hub daemon + remote agents + SSH transport + PWA UI.
Sessions survive client disconnects, SSH drops, and device switches.

![Status](https://img.shields.io/badge/status-under%20active%20development-yellow)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

> **Not yet published to npm.** Under active development.

---

## Features

- **Session persistence** — terminal sessions outlive UI disconnects and SSH drops; reconnect and resume exactly where you left off
- **SSH stdio transport** — agents run over SSH stdio; no extra ports opened on remote machines
- **Local-first** — the hub daemon owns all state; the UI is a thin client that can come and go
- **Multi-device** — attach to the same session from any browser or device; write-lock prevents conflicting input
- **Remote agents** — same agent binary runs locally (child process) or remotely (SSH); hub handles both identically
- **Custom themes** — per-host and per-channel visual identity with Discord-style host rail
- **Launch profiles** — named shell configurations with environment, working directory, and elevation settings
- **Elevation support** — configurable elevation methods per host (sudo, doas, pkexec, gsudo, custom)
- **Config cascade** — 4-layer deep merge: built-in defaults → `config.toml` → host profile → channel profile

---

## Quick Start

Once published to npm:

```sh
npx termora
```

Open `http://localhost:4100` in your browser.

---

## Architecture

```
UI (Vue 3 + xterm.js) ──── WS + REST ──── Hub (Fastify, 127.0.0.1:4100)
                                            ├── Local Agent (child_process, stdio)
                                            ├── Remote Agent (ssh2, stdio)
                                            ├── meta.db  (hosts, sessions, workspaces)
                                            └── spool.db (output chunks, snapshots)

Agent (local or remote, same binary):
	stdin  → MessagePack frames → PTY manager (node-pty) → N channels
	stdout ← MessagePack frames ← OUTPUT / SNAPSHOT

Hub never touches PTY directly — the agent is the universal PTY manager.
```

The hub daemon binds to `127.0.0.1:4100` and serves both the REST API (`/api/*`) and the WebSocket endpoint (`/ws`). All PTY management is delegated to the agent process, whether local or remote.

---

## Packages

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/shared` | `@termora/shared` | Protocol types, MessagePack codec, entity types, config types |
| `packages/agent` | `@termora/agent` | PTY manager — node-pty + xterm.js headless + MessagePack protocol handler |
| `packages/hub` | `@termora/hub` | Fastify daemon — session manager, client manager, storage, SSH transport |
| `packages/clients/web` | `@termora/web` | Vue 3 PWA — embedded in hub at build time, not published separately |
| `packages/clients/desktop` | `@termora/desktop` | Tauri desktop app wrapping the hub as a sidecar (P1) |
| root | `termora` | CLI entrypoint — thin wrapper around `@termora/hub` (`npx termora`) |

---

## Development

### Prerequisites

- Node.js >= 20 LTS
- pnpm >= 9

### Setup

```sh
# Install all dependencies
pnpm install

# Start hub + UI dev servers concurrently
pnpm dev
```

The hub starts on `http://localhost:4100` and the Vite dev server on `http://localhost:5173`.

### Commands

```sh
pnpm build            # Build all packages
pnpm test             # Run all tests (vitest)
pnpm lint             # Lint + format check (biome)
pnpm lint:fix         # Auto-fix lint issues

# Single-package operations
pnpm -F @termora/hub test
pnpm -F @termora/web dev
```

---

## Configuration

termora reads configuration from a TOML file:

- **Linux / macOS:** `~/.config/termora/config.toml`
- **Windows:** `%APPDATA%\termora\config.toml`

State (databases, runtime socket) is stored in:

- **Linux / macOS:** `~/.local/state/termora/`
- **Windows:** `%LOCALAPPDATA%\termora\`

The port defaults to `4100` and can be overridden via:

1. CLI flag `--port`
2. Environment variable `TERMORA_PORT`
3. `port` key in `config.toml`

In `zero_conf` mode the hub auto-increments from 4100 to 4199 if the default port is taken, and writes the actual port to `runtime.json` in the state directory.

---

## License

GPL-3.0 — see [LICENSE](./LICENSE).
