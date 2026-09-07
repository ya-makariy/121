import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPragmas } from "../src/db/index.ts";
import { loadMigrations, migrate } from "../src/db/migrate.ts";

function freshDb(): Database {
  const db = new Database(":memory:", { create: true, strict: false });
  applyPragmas(db);
  return db;
}

function tempMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "121-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("миграции", () => {
  test("применяются на чистой базе и повторный запуск ничего не делает", () => {
    const db = freshDb();
    const first = migrate(db);
    expect(first.from).toBe(0);
    expect(first.to).toBeGreaterThan(0);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.to).toBe(first.to);
  });

  test("user_version совпадает с числом записей в журнале", () => {
    const db = freshDb();
    const result = migrate(db);
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    const logged = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM _migration_log").get()!.n;
    expect(version).toBe(result.to);
    expect(logged).toBe(result.to);
  });

  test("правка уже применённой миграции ловится по контрольной сумме", () => {
    // Самый частый прострел self-hosted инструмента: поправить старую миграцию
    // на живой базе. Должно падать громко, а не молча расходиться со схемой.
    const dir = tempMigrations({
      "0001_init.sql": "CREATE TABLE _migration_log (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL); CREATE TABLE t (id INTEGER PRIMARY KEY);",
    });
    try {
      const db = freshDb();
      migrate(db, loadMigrations(dir));

      writeFileSync(
        join(dir, "0001_init.sql"),
        "CREATE TABLE _migration_log (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL); CREATE TABLE t (id INTEGER PRIMARY KEY, extra TEXT);",
      );
      expect(() => migrate(db, loadMigrations(dir))).toThrow(/изменена после применения/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("удаление применённой миграции ловится", () => {
    const dir = tempMigrations({
      "0001_init.sql": "CREATE TABLE _migration_log (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL);",
      "0002_more.sql": "CREATE TABLE t (id INTEGER PRIMARY KEY);",
    });
    try {
      const db = freshDb();
      migrate(db, loadMigrations(dir));
      rmSync(join(dir, "0002_more.sql"));
      expect(() => migrate(db, loadMigrations(dir))).toThrow(/файла больше нет/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("дыра в нумерации не даёт стартовать", () => {
    const dir = tempMigrations({
      "0001_a.sql": "SELECT 1;",
      "0003_c.sql": "SELECT 1;",
    });
    try {
      expect(() => loadMigrations(dir)).toThrow(/Пропущен номер миграции 2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("недопустимое имя файла не даёт стартовать", () => {
    const dir = tempMigrations({ "init.sql": "SELECT 1;" });
    try {
      expect(() => loadMigrations(dir)).toThrow(/недопустимыми именами/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("внешние ключи включены и работают", () => {
    const db = freshDb();
    migrate(db);
    expect(() =>
      db.query("INSERT INTO meeting_answer (meeting_id, field_id, field_key, updated_at) VALUES (999, 999, 'x', 'now')").run(),
    ).toThrow();
  });

  test("поле с ответами нельзя удалить: история не уничтожается", () => {
    const db = freshDb();
    migrate(db);
    const v = db
      .query<{ current_version_id: number }, []>(
        "SELECT current_version_id FROM template WHERE is_default = 1",
      )
      .get()!.current_version_id;
    const person = db
      .query<{ id: number }, []>(
        "INSERT INTO person (owner_id, full_name, created_at, updated_at) VALUES (1, 'Кто-то', 'now', 'now') RETURNING id",
      )
      .get()!.id;
    const meeting = db
      .query<{ id: number }, [number, number]>(
        `INSERT INTO meeting (owner_id, person_id, template_version_id, held_on, created_at, updated_at)
         VALUES (1, ?, ?, '2026-09-07', 'now', 'now') RETURNING id`,
      )
      .get(person, v)!.id;
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? LIMIT 1",
      )
      .get(v)!.id;
    db.query(
      "INSERT INTO meeting_answer (meeting_id, field_id, field_key, text_value, updated_at) VALUES (?, ?, 'k', 'ответ', 'now')",
    ).run(meeting, field);

    // meeting_answer.field_id намеренно без ON DELETE CASCADE.
    expect(() => db.query("DELETE FROM template_field WHERE id = ?").run(field)).toThrow();
  });
});
