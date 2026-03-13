#!/usr/bin/env bash
# prepare-desktop.sh — Build all binaries and prepare Tauri desktop build
#
# Usage:
#   ./scripts/prepare-desktop.sh          # Build for current platform
#   ./scripts/prepare-desktop.sh --dev    # Dev mode (skip SEA, use node instead)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Detect target triple
detect_target_triple() {
	local os arch
	os="$(uname -s)"
	arch="$(uname -m)"

	case "$os" in
		Linux)  os_part="unknown-linux-gnu" ;;
		Darwin) os_part="apple-darwin" ;;
		MINGW*|MSYS*|CYGWIN*) os_part="pc-windows-msvc" ;;
		*) echo "Unsupported OS: $os" >&2; exit 1 ;;
	esac

	case "$arch" in
		x86_64|amd64)  arch_part="x86_64" ;;
		aarch64|arm64) arch_part="aarch64" ;;
		*) echo "Unsupported arch: $arch" >&2; exit 1 ;;
	esac

	echo "${arch_part}-${os_part}"
}

TARGET_TRIPLE="$(detect_target_triple)"
BINARIES_DIR="$ROOT/packages/clients/desktop/src-tauri"
EXE_EXT=""
[[ "$TARGET_TRIPLE" == *windows* ]] && EXE_EXT=".exe"

echo "==> Target: $TARGET_TRIPLE"
echo ""

# Step 1: Build web UI
echo "==> Step 1/4: Building web UI..."
pnpm -F @nexterm/web build
echo ""

# Step 2: Build agent SEA binary
echo "==> Step 2/4: Building agent SEA binary..."
pnpm run package:sea-agent
echo ""

# Step 3: Build hub SEA binary
echo "==> Step 3/4: Building hub SEA binary..."
pnpm run package:sea-hub
echo ""

# Step 4: Copy binaries to Tauri sidecar directory
echo "==> Step 4/4: Placing sidecars..."
# Hub sidecar (required — Tauri manages this)
cp "$ROOT/dist/sea/nexterm-hub${EXE_EXT}" "$BINARIES_DIR/nexterm-hub-${TARGET_TRIPLE}${EXE_EXT}"
echo "  Hub: $BINARIES_DIR/nexterm-hub-${TARGET_TRIPLE}${EXE_EXT}"

# Agent binary (co-located with hub so hub can find it at runtime)
cp "$ROOT/dist/sea/nexterm-agent${EXE_EXT}" "$BINARIES_DIR/nexterm-agent-${TARGET_TRIPLE}${EXE_EXT}"
echo "  Agent: $BINARIES_DIR/nexterm-agent-${TARGET_TRIPLE}${EXE_EXT}"

echo ""
echo "==> Ready! Run: cd packages/clients/desktop && pnpm tauri build"
