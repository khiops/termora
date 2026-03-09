CREATE TABLE host_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_host_groups_sort ON host_groups(sort_order);

ALTER TABLE hosts ADD COLUMN host_group_id TEXT REFERENCES host_groups(id) ON DELETE SET NULL;

INSERT INTO schema_version (version, applied_at) VALUES (7, datetime('now'));
