import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.ts";

/**
 * Pragmas are applied on every connection. foreign_keys is per-connection: it cannot be
 * set once in the database file, which is why it lives here rather than in a migration.
 */
export function applyPragmas(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA temp_store = MEMORY");
}

export function openDb(path: string = config.dbPath): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: false });
  applyPragmas(db);
  return db;
}

let singleton: Database | undefined;

export function db(): Database {
  if (!singleton) singleton = openDb();
  return singleton;
}

export function closeDb(): void {
  singleton?.close();
  singleton = undefined;
}
