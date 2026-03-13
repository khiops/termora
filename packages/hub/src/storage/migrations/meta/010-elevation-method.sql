ALTER TABLE hosts ADD COLUMN elevation_method TEXT
  CHECK(elevation_method IS NULL OR elevation_method IN ('sudo','doas','pkexec','gsudo','custom'));
ALTER TABLE hosts ADD COLUMN custom_command TEXT;
