-- Migration 002: Replace stub pairing_codes table with full schema
-- The 001 migration created a minimal stub; this replaces it with the full spec schema.

DROP TABLE IF EXISTS pairing_codes;

CREATE TABLE pairing_codes (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  used_by_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_pairing_codes_code ON pairing_codes(code);

INSERT INTO schema_version VALUES (2, datetime('now'));
