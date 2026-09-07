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
      `Миграции с недопустимыми именами: ${bad.join(", ")}. ` +
        `Ожидается NNNN_snake_case.sql`,
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

  // Дыры и дубли номеров — падаем громко на старте, а не разбираемся потом.
  migrations.forEach((m, i) => {
    const expected = i + 1;
    if (m.version !== expected) {
      const prev = migrations[i - 1];
      throw new Error(
        prev && prev.version === m.version
          ? `Дубль номера миграции ${m.version}: ${prev.filename} и ${m.filename}`
          : `Пропущен номер миграции ${expected} (следующая — ${m.filename})`,
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
 * Сверяет контрольные суммы уже применённых миграций. Ловит самый частый прострел
 * self-hosted инструмента: правку миграции, которая уже выполнилась на живой базе.
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
        `Миграция ${row.version} (${row.filename}) применена к базе, но файла больше нет. ` +
          `Удалять применённые миграции нельзя.`,
      );
    }
    if (m.sha256 !== row.sha256) {
      throw new Error(
        `Миграция ${m.filename} изменена после применения к базе.\n` +
          `  в базе:  ${row.sha256}\n  на диске: ${m.sha256}\n` +
          `Правьте историю новой миграцией, а не старым файлом.`,
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

  // Бесплатная страховка перед правкой незаменимого локального файла.
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
    // foreign_keys нельзя переключать внутри транзакции — отсюда такой порядок.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(m.sql);
      // Прагмы не параметризуются; значение пришло из валидированного regex-ом имени файла.
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.query(
        "INSERT INTO _migration_log (version, filename, sha256, applied_at) VALUES (?, ?, ?, ?)",
      ).run(m.version, m.filename, m.sha256, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      db.exec("PRAGMA foreign_keys = ON");
      throw new Error(`Миграция ${m.filename} не применилась: ${(err as Error).message}`);
    }

    const violations = db.query("PRAGMA foreign_key_check").all();
    db.exec("PRAGMA foreign_keys = ON");
    if (violations.length > 0) {
      throw new Error(
        `Миграция ${m.filename} оставила битые внешние ключи: ${JSON.stringify(violations)}`,
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
    console.log(`База уже на версии ${result.to}, применять нечего.`);
  } else {
    if (result.backup) console.log(`Бэкап перед миграцией: ${result.backup}`);
    console.log(`Применено ${result.from} -> ${result.to}: ${result.applied.join(", ")}`);
  }
  database.close();
}
