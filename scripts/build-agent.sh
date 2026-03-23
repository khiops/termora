#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-detect target triple
ARCH=$(uname -m)
case "$(uname -s)" in
  Linux)  DETECTED_TRIPLE="${ARCH}-unknown-linux-gnu" ;;
  Darwin) DETECTED_TRIPLE="${ARCH}-apple-darwin" ;;
  *)      echo "❌ Unsupported OS. Use .ps1 on Windows." >&2; exit 1 ;;
esac

NEXTERM_TARGET_TRIPLE="${NEXTERM_TARGET_TRIPLE:-$DETECTED_TRIPLE}"
NEXTERM_DIST_DIR="${NEXTERM_DIST_DIR:-$ROOT/dist/sea}"
NEXTERM_CARGO_TARGET_DIR="${NEXTERM_CARGO_TARGET_DIR:-$ROOT/target}"

echo "🔨 Building Rust agent (triple: $NEXTERM_TARGET_TRIPLE)..."

mkdir -p "$NEXTERM_DIST_DIR"
cd "$ROOT"
# Note: native build only (no --target). Cross-compilation would need --target $NEXTERM_TARGET_TRIPLE.
# NEXTERM_TARGET_TRIPLE is used for artifact naming and CI metadata.
cargo build -p nexterm-agent --release --target-dir "$NEXTERM_CARGO_TARGET_DIR"

# Copy binary to dist
BINARY="$NEXTERM_CARGO_TARGET_DIR/release/nexterm-agent"
if [ ! -f "$BINARY" ]; then
  echo "❌ Binary not found at $BINARY" >&2
  exit 1
fi
cp "$BINARY" "$NEXTERM_DIST_DIR/nexterm-agent"
chmod +x "$NEXTERM_DIST_DIR/nexterm-agent"

SIZE=$(du -h "$NEXTERM_DIST_DIR/nexterm-agent" | cut -f1)
echo "✅ Rust agent built → $NEXTERM_DIST_DIR/nexterm-agent ($SIZE)"
