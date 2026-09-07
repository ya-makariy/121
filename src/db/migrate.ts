import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";
import { openDb } from "./index.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const FILENAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: number;
  filename: string;
  sql: string;
  sha256: string;
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  const bad = files.filter((f) => !FILENAME_RE.test(f));
  if (bad.length > 0) {
    throw new Error(
      `Migrations with invalid names: ${bad.join(", ")}. Expected NNNN_snake_case.sql`,
    );
  }

  const migrations = files
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), "utf8");
      return {
        version: Number.parseInt(FILENAME_RE.exec(filename)![1]!, 10),
        filename,
        sql,
        sha256: sha256(sql),
      };
    })
    .sort((a, b) => a.version - b.version);

  // Gaps and duplicate numbers fail loudly at boot rather than being puzzled over later.
  migrations.forEach((m, i) => {
    const expected = i + 1;
    if (m.version !== expected) {
      const prev = migrations[i - 1];
      throw new Error(
        prev && prev.version === m.version
          ? `Duplicate migration number ${m.version}: ${prev.filename} and ${m.filename}`
          : `Missing migration number ${expected} (next one is ${m.filename})`,
      );
    }
  });

  return migrations;
}

function currentVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

/**
 * Verifies the checksums of migrations already applied. This catches the most common
 * self-hosted footgun: editing a migration that has already run against a live database.
 */
function verifyApplied(db: Database, migrations: Migration[]): void {
  const hasLog = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migration_log'")
    .get();
  if (!hasLog) return;

  const applied = db
    .query<{ version: number; filename: string; sha256: string }, []>(
      "SELECT version, filename, sha256 FROM _migration_log",
    )
    .all();

  for (const row of applied) {
    const m = migrations.find((x) => x.version === row.version);
    if (!m) {
      throw new Error(
        `Migration ${row.version} (${row.filename}) was applied to this database but its ` +
          `file is gone. Applied migrations must not be deleted.`,
      );
    }
    if (m.sha256 !== row.sha256) {
      throw new Error(
        `Migration ${m.filename} was modified after being applied.\n` +
          `  in database: ${row.sha256}\n  on disk:     ${m.sha256}\n` +
          `Change history with a new migration, not by editing an old file.`,
      );
    }
  }
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
  backup?: string;
}

export function migrate(db: Database, migrations = loadMigrations()): MigrateResult {
  verifyApplied(db, migrations);

  const from = currentVersion(db);
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  // Free insurance before touching an irreplaceable local file.
  let backup: string | undefined;
  const dbFile = db.filename;
  if (from > 0 && dbFile && dbFile !== ":memory:") {
    mkdirSync(config.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = join(config.backupDir, `pre-migration-${from}-${stamp}.sqlite`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }

  const applied: string[] = [];
  for (const m of pending) {
    // foreign_keys cannot be toggled inside a transaction, hence this ordering.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(m.sql);
      // Pragmas take no parameters; the value came from a regex-validated filename.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.query(
        "INSERT INTO _migration_log (version, filename, sha256, applied_at) VALUES (?, ?, ?, ?)",
      ).run(m.version, m.filename, m.sha256, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      db.exec("PRAGMA foreign_keys = ON");
      throw new Error(`Migration ${m.filename} failed: ${(err as Error).message}`);
    }

    const violations = db.query("PRAGMA foreign_key_check").all();
    db.exec("PRAGMA foreign_keys = ON");
    if (violations.length > 0) {
      throw new Error(
        `Migration ${m.filename} left broken foreign keys: ${JSON.stringify(violations)}`,
      );
    }
    applied.push(m.filename);
  }

  return { from, to: currentVersion(db), applied, backup };
}

if (import.meta.main) {
  const database = openDb();
  const result = migrate(database);
  if (result.applied.length === 0) {
    console.log(`Database is already at version ${result.to}; nothing to apply.`);
  } else {
    if (result.backup) console.log(`Pre-migration backup: ${result.backup}`);
    console.log(`Applied ${result.from} -> ${result.to}: ${result.applied.join(", ")}`);
  }
  database.close();
}
