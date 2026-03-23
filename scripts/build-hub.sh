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

NEXTERM_TARGET_TRIPLE="${NEXTERM_TARGET_TRIPLE:-$DETECTED_TRIPLE}"
NEXTERM_DIST_DIR="${NEXTERM_DIST_DIR:-$ROOT/dist/sea}"
NEXTERM_BUILD_HASH="${NEXTERM_BUILD_HASH:-$(git -C "$ROOT" rev-parse --short=8 HEAD)}"
NEXTERM_SKIP_WEB="${NEXTERM_SKIP_WEB:-false}"

echo "🔨 Building hub SEA (triple: $NEXTERM_TARGET_TRIPLE)..."

cd "$ROOT"
pnpm -F @nexterm/shared build

if [ "$NEXTERM_SKIP_WEB" != "true" ]; then
  echo "  → Building web UI first..."
  "$SCRIPT_DIR/build-web.sh"
fi

export NEXTERM_TARGET_TRIPLE NEXTERM_DIST_DIR NEXTERM_BUILD_HASH
# Also export NEXTERM_NODE_VERSION if set (for cross-build Node version override)
[ -n "${NEXTERM_NODE_VERSION:-}" ] && export NEXTERM_NODE_VERSION
pnpm run package:sea-hub

SIZE=$(du -h "$NEXTERM_DIST_DIR/nexterm-hub" 2>/dev/null | cut -f1 || echo "?")
echo "✅ Hub SEA built → $NEXTERM_DIST_DIR/nexterm-hub ($SIZE)"
