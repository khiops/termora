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

TERMORA_TARGET_TRIPLE="${TERMORA_TARGET_TRIPLE:-$DETECTED_TRIPLE}"
TERMORA_DIST_DIR="${TERMORA_DIST_DIR:-$ROOT/dist/sea}"
TERMORA_CARGO_TARGET_DIR="${TERMORA_CARGO_TARGET_DIR:-$ROOT/target}"

echo "🔨 Building Rust agent (triple: $TERMORA_TARGET_TRIPLE)..."

mkdir -p "$TERMORA_DIST_DIR"
cd "$ROOT"
# Note: native build only (no --target). Cross-compilation would need --target $TERMORA_TARGET_TRIPLE.
# TERMORA_TARGET_TRIPLE is used for artifact naming and CI metadata.
cargo build -p termora-agent --release --target-dir "$TERMORA_CARGO_TARGET_DIR"

# Copy binary to dist
BINARY="$TERMORA_CARGO_TARGET_DIR/release/termora-agent"
if [ ! -f "$BINARY" ]; then
  echo "❌ Binary not found at $BINARY" >&2
  exit 1
fi
cp "$BINARY" "$TERMORA_DIST_DIR/termora-agent"
chmod +x "$TERMORA_DIST_DIR/termora-agent"

SIZE=$(du -h "$TERMORA_DIST_DIR/termora-agent" | cut -f1)
echo "✅ Rust agent built → $TERMORA_DIST_DIR/termora-agent ($SIZE)"
