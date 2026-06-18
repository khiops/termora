import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "migrations");

export interface DatabaseManager {
	meta: Database.Database;
	spool: Database.Database;
	close(): void;
}

function checkpointAndClose(db: Database.Database): void {
	if (!db.open) return;
	try {
		db.pragma("wal_checkpoint(TRUNCATE)");
	} finally {
		if (db.open) db.close();
	}
}

function applyCommonPragmas(db: Database.Database): void {
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	db.pragma("cache_size = -8000");
}

function applySpoolPragmas(db: Database.Database): void {
	const currentAutoVacuum = db.pragma("auto_vacuum", { simple: true }) as number;
	if (currentAutoVacuum !== 2) {
		db.pragma("auto_vacuum = INCREMENTAL");
	}
}

function runMigrations(db: Database.Database, migrationsDir: string): void {
	const hasSchemaVersion =
		db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
			.get() !== undefined;

	let currentVersion = 0;
	if (hasSchemaVersion) {
		const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as {
			v: number | null;
		};
		currentVersion = row.v ?? 0;
	}

	let files: string[];
	try {
		files = readdirSync(migrationsDir)
			.filter((f) => /^\d{3}-.*\.sql$/.test(f))
			.sort();
	} catch {
		// No migrations directory — nothing to apply
		return;
	}

	const parseNum = (filename: string): number => Number.parseInt(filename.slice(0, 3), 10);

	const lastFile = files[files.length - 1];
	const latestMigration = files.length > 0 && lastFile !== undefined ? parseNum(lastFile) : 0;

	if (currentVersion > latestMigration && latestMigration > 0) {
		process.stderr.write("[storage] DB schema version ahead of latest migration - skipping\n");
		return;
	}

	for (const file of files) {
		const num = parseNum(file);
		if (num <= currentVersion) continue;

		const sql = readFileSync(join(migrationsDir, file), "utf-8");

		const applyMigration = db.transaction(() => {
			db.exec(sql);
			const versionAfter = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as {
				v: number | null;
			};
			if ((versionAfter.v ?? 0) < num) {
				db.prepare(
					"INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))",
				).run(num);
			}
		});

		applyMigration();
	}
}

export function openDatabases(dataDir: string): DatabaseManager {
	const metaDb = new Database(join(dataDir, "meta.db"));
	applyCommonPragmas(metaDb);
	metaDb.pragma("wal_autocheckpoint = 1000");

	const spoolDb = new Database(join(dataDir, "spool.db"));
	applySpoolPragmas(spoolDb);
	applyCommonPragmas(spoolDb);
	spoolDb.pragma("wal_autocheckpoint = 2000");

	runMigrations(metaDb, join(MIGRATIONS_DIR, "meta"));
	runMigrations(spoolDb, join(MIGRATIONS_DIR, "spool"));

	return {
		meta: metaDb,
		spool: spoolDb,
		close() {
			checkpointAndClose(metaDb);
			checkpointAndClose(spoolDb);
		},
	};
}

export function openTestDatabases(): DatabaseManager {
	const metaDb = new Database(":memory:");
	applyCommonPragmas(metaDb);
	metaDb.pragma("wal_autocheckpoint = 1000");

	const spoolDb = new Database(":memory:");
	applySpoolPragmas(spoolDb);
	applyCommonPragmas(spoolDb);
	spoolDb.pragma("wal_autocheckpoint = 2000");

	runMigrations(metaDb, join(MIGRATIONS_DIR, "meta"));
	runMigrations(spoolDb, join(MIGRATIONS_DIR, "spool"));

	return {
		meta: metaDb,
		spool: spoolDb,
		close() {
			checkpointAndClose(metaDb);
			checkpointAndClose(spoolDb);
		},
	};
}
