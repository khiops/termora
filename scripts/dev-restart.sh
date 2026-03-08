#!/usr/bin/env bash
# Restart nexterm dev servers (stop + start).
# Usage: ./scripts/dev-restart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/dev-start.sh"
