-- Migration 014: Auth tokens table (expiry + revocation)
-- Stores per-token metadata. The primary token (auth.json) is inserted on hub
-- startup as id='primary'. Additional tokens are created by the pairing flow.

CREATE TABLE IF NOT EXISTS auth_tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  expires_at   TEXT,          -- NULL = never expires (legacy primary token)
  revoked_at   TEXT,          -- NULL = active
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);

INSERT INTO schema_version VALUES (14, datetime('now'));
