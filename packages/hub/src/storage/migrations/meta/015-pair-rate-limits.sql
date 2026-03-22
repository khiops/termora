-- Migration 015: Per-IP pairing verification rate limits
-- Stores attempt counters per IP to prevent brute-force attacks on pairing codes.
-- Survives hub restarts unlike the previous in-memory counter.

CREATE TABLE IF NOT EXISTS pair_rate_limits (
  ip           TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  PRIMARY KEY (ip)
);

INSERT INTO schema_version VALUES (15, datetime('now'));
