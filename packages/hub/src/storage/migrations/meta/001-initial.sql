CREATE TABLE hosts (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('local', 'ssh')),
  label       TEXT NOT NULL UNIQUE,
  ssh_host    TEXT,
  ssh_port    INTEGER DEFAULT 22,
  ssh_auth    TEXT CHECK(ssh_auth IN ('agent', 'key', 'password')),
  ssh_key_path TEXT,
  icon_type   TEXT NOT NULL DEFAULT 'auto'
              CHECK(icon_type IN ('auto', 'emoji', 'image')),
  icon_value  TEXT,
  color       TEXT,
  profile_json TEXT,
  trust_remote_hints TEXT NOT NULL DEFAULT 'apply'
              CHECK(trust_remote_hints IN ('apply', 'ask', 'ignore')),
  default_shell TEXT,
  default_cwd   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE channel_groups (
  id         TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_groups_host ON channel_groups(host_id, sort_order);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  host_id    TEXT NOT NULL REFERENCES hosts(id),
  status     TEXT NOT NULL DEFAULT 'starting'
             CHECK(status IN ('starting', 'active', 'detached',
                              'disconnected', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_host   ON sessions(host_id);
CREATE INDEX idx_sessions_status ON sessions(status);

CREATE TABLE channels (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  group_id    TEXT REFERENCES channel_groups(id) ON DELETE SET NULL,
  title       TEXT,
  shell       TEXT NOT NULL,
  cwd         TEXT,
  env_json    TEXT,
  cols        INTEGER NOT NULL DEFAULT 80,
  rows        INTEGER NOT NULL DEFAULT 24,
  status      TEXT NOT NULL DEFAULT 'born'
              CHECK(status IN ('born', 'live', 'orphan', 'dead')),
  exit_code   INTEGER,
  profile_json TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_channels_session ON channels(session_id);
CREATE INDEX idx_channels_status  ON channels(status);
CREATE INDEX idx_channels_group   ON channels(group_id);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  layout_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cache_index (
  channel_id             TEXT PRIMARY KEY REFERENCES channels(id),
  last_snapshot_chunk_id TEXT,
  last_seq               INTEGER NOT NULL DEFAULT 0,
  last_seen_at           TEXT NOT NULL
);

CREATE TABLE pairing_codes (
  code       TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

INSERT INTO schema_version VALUES (1, datetime('now'));
