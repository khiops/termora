#!/usr/bin/env bash
# Start nexterm dev servers (hub + web) in background with log capture.
# Usage: ./scripts/dev-start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/nexterm-dev"
PID_FILE="$LOG_DIR/dev.pid"

mkdir -p "$LOG_DIR"

# ── Stop any existing instance ───────────────────────────────────────────────
"$ROOT/scripts/dev-stop.sh"
echo ""

# ── Build shared + agent (hub imports shared, spawns agent as child) ─────────
echo "Building shared…"
(cd "$ROOT" && pnpm -F @nexterm/shared build) > "$LOG_DIR/shared-build.log" 2>&1

echo "Building agent…"
(cd "$ROOT" && pnpm -F @nexterm/agent build) > "$LOG_DIR/agent-build.log" 2>&1

# ── Start dev servers ────────────────────────────────────────────────────────
echo "Starting hub + web…"
cd "$ROOT"
setsid pnpm dev > "$LOG_DIR/dev.log" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"

# ── Wait for hub to be ready (port 4100) ─────────────────────────────────────
echo -n "Waiting for hub on :4100"
HUB_OK=0
for i in $(seq 1 30); do
	if curl -sf http://127.0.0.1:4100/api/health > /dev/null 2>&1; then
		echo " ✓"
		HUB_OK=1
		break
	fi
	echo -n "."
	sleep 1
done

if [ "$HUB_OK" -eq 0 ]; then
	echo ""
	echo "✗ Hub did not respond after 30s. Check $LOG_DIR/dev.log"
	tail -20 "$LOG_DIR/dev.log"
	exit 1
fi

# ── Wait for Vite dev server (port 5173) ─────────────────────────────────────
echo -n "Waiting for Vite on :5173"
VITE_OK=0
for i in $(seq 1 15); do
	if ss -tlnp 2>/dev/null | grep -q ':5173 '; then
		echo " ✓"
		VITE_OK=1
		break
	fi
	echo -n "."
	sleep 1
done

if [ "$VITE_OK" -eq 0 ]; then
	echo ""
	echo "⚠  Vite not detected on :5173 (may still be starting)"
fi

# ── Check for warnings in log ────────────────────────────────────────────────
if grep -q "MaxListenersExceeded" "$LOG_DIR/dev.log" 2>/dev/null; then
	echo "⚠  MaxListenersExceededWarning detected in logs"
fi

echo ""
echo "Dev servers running (PID $DEV_PID)"
echo "  Hub:  http://127.0.0.1:4100"
echo "  Web:  http://localhost:5173"
echo "  Logs: $LOG_DIR/dev.log"
echo ""
echo "Stop with: ./scripts/dev-stop.sh"
echo "Tail logs: tail -f $LOG_DIR/dev.log"
