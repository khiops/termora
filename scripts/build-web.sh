#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TERMORA_BUILD_HASH="${TERMORA_BUILD_HASH:-$(git -C "$ROOT" rev-parse --short=8 HEAD)}"

echo "🔨 Building web UI (hash: $TERMORA_BUILD_HASH)..."

cd "$ROOT"
pnpm -F @termora/shared build
TERMORA_BUILD_HASH="$TERMORA_BUILD_HASH" pnpm -F @termora/web build
node scripts/embed-web.js

echo "✅ Web built → packages/hub/static/"
