#!/usr/bin/env bash
# Stop nexterm dev servers.
# Usage: ./scripts/dev-stop.sh
set -euo pipefail

LOG_DIR="/tmp/nexterm-dev"
PID_FILE="$LOG_DIR/dev.pid"

if [ ! -f "$PID_FILE" ]; then
	echo "No PID file found — dev servers not running (or started externally)."
	# Fallback: kill by port
	ORPHAN=$(lsof -ti:4100 2>/dev/null || true)
	if [ -n "$ORPHAN" ]; then
		echo "Killing orphan on port 4100 (PID $ORPHAN)…"
		kill -9 $ORPHAN 2>/dev/null || true
	fi
	exit 0
fi

DEV_PID=$(cat "$PID_FILE")
if kill -0 "$DEV_PID" 2>/dev/null; then
	echo "Stopping dev servers (PID $DEV_PID)…"
	kill -- -"$DEV_PID" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
	sleep 1
	# Ensure children are dead
	kill -9 -- -"$DEV_PID" 2>/dev/null || true
	echo "Stopped."
else
	echo "Process $DEV_PID already dead."
fi

rm -f "$PID_FILE"

# Final cleanup: free port if still held
ORPHAN=$(lsof -ti:4100 2>/dev/null || true)
if [ -n "$ORPHAN" ]; then
	echo "Cleaning up orphan on port 4100…"
	kill -9 $ORPHAN 2>/dev/null || true
fi
