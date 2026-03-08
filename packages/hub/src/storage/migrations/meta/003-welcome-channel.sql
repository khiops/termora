ALTER TABLE channels ADD COLUMN is_welcome INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_channels_welcome ON channels(is_welcome) WHERE is_welcome = 1;

INSERT INTO schema_version VALUES (3, datetime('now'));
