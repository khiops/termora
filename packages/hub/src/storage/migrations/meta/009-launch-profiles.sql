CREATE TABLE launch_profiles (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE COLLATE NOCASE,
	shell TEXT NOT NULL,
	args_json TEXT,
	cwd TEXT,
	env_json TEXT,
	mode TEXT NOT NULL DEFAULT 'shell' CHECK(mode IN ('shell', 'process')),
	elevated INTEGER NOT NULL DEFAULT 0,
	supported_os TEXT NOT NULL DEFAULT 'any'
		CHECK(supported_os IN ('linux', 'darwin', 'windows', 'any')),
	icon_type TEXT NOT NULL DEFAULT 'auto'
		CHECK(icon_type IN ('auto', 'emoji', 'image')),
	icon_value TEXT,
	color TEXT,
	profile_overrides_json TEXT,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX idx_launch_profiles_sort ON launch_profiles(sort_order, name);

CREATE TABLE host_launch_profiles (
	host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
	profile_id TEXT NOT NULL REFERENCES launch_profiles(id) ON DELETE CASCADE,
	override_type TEXT NOT NULL CHECK(override_type IN ('pin', 'hide', 'default')),
	sort_order INTEGER,
	PRIMARY KEY (host_id, profile_id)
);

CREATE UNIQUE INDEX idx_hlp_one_default_per_host
	ON host_launch_profiles(host_id) WHERE override_type = 'default';

ALTER TABLE channels ADD COLUMN launch_profile_id TEXT
	REFERENCES launch_profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_channels_launch_profile_id ON channels(launch_profile_id);

ALTER TABLE hosts ADD COLUMN discovered_shells TEXT;
ALTER TABLE hosts ADD COLUMN discovered_shells_at TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (9, datetime('now'));
