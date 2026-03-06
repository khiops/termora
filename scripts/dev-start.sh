#!/usr/bin/env bash
# Start nexterm dev servers (hub + web) in background with log capture.
# Usage: ./scripts/dev-start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/nexterm-dev"
PID_FILE="$LOG_DIR/dev.pid"

mkdir -p "$LOG_DIR"

# ── Stop any existing instance ───────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
	OLD_PID=$(cat "$PID_FILE")
	if kill -0 "$OLD_PID" 2>/dev/null; then
		echo "Stopping previous dev servers (PID $OLD_PID)…"
		kill -- -"$OLD_PID" 2>/dev/null || kill "$OLD_PID" 2>/dev/null || true
		sleep 1
	fi
	rm -f "$PID_FILE"
fi

# ── Free port 4100 if still held by an orphan ───────────────────────────────
ORPHAN=$(lsof -ti:4100 2>/dev/null || true)
if [ -n "$ORPHAN" ]; then
	echo "Killing orphan process on port 4100 (PID $ORPHAN)…"
	kill -9 $ORPHAN 2>/dev/null || true
	sleep 1
fi

# ── Build agent (hub spawns it as child process) ─────────────────────────────
echo "Building agent…"
(cd "$ROOT" && pnpm -F @nexterm/agent build) > "$LOG_DIR/agent-build.log" 2>&1

# ── Start dev servers ────────────────────────────────────────────────────────
echo "Starting hub + web…"
cd "$ROOT"
setsid pnpm dev > "$LOG_DIR/dev.log" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"

# ── Wait for hub to be ready ────────────────────────────────────────────────
echo -n "Waiting for hub on :4100"
for i in $(seq 1 30); do
	if curl -sf http://127.0.0.1:4100/api/health > /dev/null 2>&1; then
		echo " ✓"
		break
	fi
	echo -n "."
	sleep 1
done

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
