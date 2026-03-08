CREATE TABLE chunks (
  id                TEXT PRIMARY KEY,
  channel_id        TEXT NOT NULL,
  seq               INTEGER NOT NULL,
  ts                TEXT NOT NULL,
  kind              TEXT NOT NULL
                    CHECK(kind IN ('output', 'snapshot', 'resize')),
  codec             TEXT NOT NULL DEFAULT 'raw'
                    CHECK(codec IN ('raw', 'zstd')),
  data_blob         BLOB NOT NULL,
  uncompressed_len  INTEGER NOT NULL,

  UNIQUE(channel_id, seq)
);

CREATE INDEX idx_chunks_channel_seq  ON chunks(channel_id, seq);
CREATE INDEX idx_chunks_channel_kind ON chunks(channel_id, kind);
CREATE INDEX idx_chunks_ts           ON chunks(ts);

CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

INSERT INTO schema_version VALUES (1, datetime('now'));
