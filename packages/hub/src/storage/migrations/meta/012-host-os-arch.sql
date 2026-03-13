ALTER TABLE hosts ADD COLUMN os TEXT CHECK(os IS NULL OR os IN ('linux', 'darwin', 'windows'));
ALTER TABLE hosts ADD COLUMN arch TEXT CHECK(arch IS NULL OR arch IN ('x64', 'arm64'));
