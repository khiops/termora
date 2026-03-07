CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);

ALTER TABLE hosts ADD COLUMN host_group TEXT DEFAULT NULL;
ALTER TABLE hosts ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN ssh_config_host TEXT DEFAULT NULL;
ALTER TABLE hosts ADD COLUMN ssh_user TEXT DEFAULT NULL;
ALTER TABLE hosts ADD COLUMN keep_alive_seconds INTEGER DEFAULT 60;
ALTER TABLE hosts ADD COLUMN history_retention_days INTEGER DEFAULT 30;

-- Backfill sort_order: dense sequence per host_group using rowid order
-- NULL group hosts get 0, 1, 2... and each named group gets 0, 1, 2...
UPDATE hosts SET sort_order = (
  SELECT COUNT(*) FROM hosts h2
  WHERE COALESCE(h2.host_group, '') = COALESCE(hosts.host_group, '')
    AND h2.rowid < hosts.rowid
);

INSERT INTO schema_version (version, applied_at) VALUES (6, datetime('now'));
