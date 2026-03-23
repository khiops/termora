#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NEXTERM_BUILD_HASH="${NEXTERM_BUILD_HASH:-$(git -C "$ROOT" rev-parse --short=8 HEAD)}"

echo "🔨 Building web UI (hash: $NEXTERM_BUILD_HASH)..."

cd "$ROOT"
pnpm -F @nexterm/shared build
NEXTERM_BUILD_HASH="$NEXTERM_BUILD_HASH" pnpm -F @nexterm/web build
node scripts/embed-web.js

echo "✅ Web built → packages/hub/static/"
