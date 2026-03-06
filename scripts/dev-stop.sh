#!/usr/bin/env bash
# Stop nexterm dev servers and clean up orphan processes.
# Usage: ./scripts/dev-stop.sh
set -euo pipefail

LOG_DIR="/tmp/nexterm-dev"
PID_FILE="$LOG_DIR/dev.pid"

# ── Helper: kill process(es) on a given port ─────────────────────────────────
kill_port() {
	local port=$1
	local pids
	pids=$(lsof -ti:"$port" 2>/dev/null || true)
	if [ -n "$pids" ]; then
		echo "  Killing orphan(s) on port $port (PIDs: $pids)…"
		echo "$pids" | xargs kill -9 2>/dev/null || true
	fi
}

# ── Stop via PID file ────────────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
	DEV_PID=$(cat "$PID_FILE")
	if kill -0 "$DEV_PID" 2>/dev/null; then
		echo "Stopping dev servers (PID $DEV_PID)…"
		# Kill the process group (setsid was used to start)
		kill -- -"$DEV_PID" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
		sleep 1
		# Ensure children are dead
		kill -9 -- -"$DEV_PID" 2>/dev/null || true
		echo "Stopped."
	else
		echo "Process $DEV_PID already dead."
	fi
	rm -f "$PID_FILE"
else
	echo "No PID file found — cleaning up by port."
fi

# ── Final cleanup: free both ports if still held ─────────────────────────────
kill_port 4100
kill_port 5173

# ── Verify ports are free ────────────────────────────────────────────────────
sleep 0.5
STILL_4100=$(ss -tlnp 2>/dev/null | grep ':4100 ' || true)
STILL_5173=$(ss -tlnp 2>/dev/null | grep ':5173 ' || true)

if [ -z "$STILL_4100" ] && [ -z "$STILL_5173" ]; then
	echo "✓ Ports 4100 and 5173 are free."
else
	[ -n "$STILL_4100" ] && echo "⚠  Port 4100 still in use: $STILL_4100"
	[ -n "$STILL_5173" ] && echo "⚠  Port 5173 still in use: $STILL_5173"
fi
