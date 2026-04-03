#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-detect
ARCH=$(uname -m)
case "$(uname -s)" in
  Linux)  DETECTED_TRIPLE="${ARCH}-unknown-linux-gnu" ;;
  Darwin) DETECTED_TRIPLE="${ARCH}-apple-darwin" ;;
  *)      echo "❌ Unsupported OS. Use .ps1 on Windows." >&2; exit 1 ;;
esac

TERMORA_TARGET_TRIPLE="${TERMORA_TARGET_TRIPLE:-$DETECTED_TRIPLE}"
TERMORA_DIST_DIR="${TERMORA_DIST_DIR:-$ROOT/dist/sea}"
TERMORA_BUILD_HASH="${TERMORA_BUILD_HASH:-$(git -C "$ROOT" rev-parse --short=8 HEAD)}"
TERMORA_SKIP_WEB="${TERMORA_SKIP_WEB:-false}"

echo "🔨 Building hub SEA (triple: $TERMORA_TARGET_TRIPLE)..."

cd "$ROOT"
pnpm -F @termora/shared build

if [ "$TERMORA_SKIP_WEB" != "true" ]; then
  echo "  → Building web UI first..."
  "$SCRIPT_DIR/build-web.sh"
fi

export TERMORA_TARGET_TRIPLE TERMORA_DIST_DIR TERMORA_BUILD_HASH
# Also export TERMORA_NODE_VERSION if set (for cross-build Node version override)
[ -n "${TERMORA_NODE_VERSION:-}" ] && export TERMORA_NODE_VERSION
pnpm run package:sea-hub

SIZE=$(du -h "$TERMORA_DIST_DIR/termora-hub" 2>/dev/null | cut -f1 || echo "?")
echo "✅ Hub SEA built → $TERMORA_DIST_DIR/termora-hub ($SIZE)"
