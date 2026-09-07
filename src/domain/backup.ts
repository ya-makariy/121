import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Бэкап — ТОЛЬКО через VACUUM INTO. См. CLAUDE.md §6.
 *
 * При включённом WAL копирование файла .sqlite молча теряет всё, что осталось в -wal:
 * получается «бэкап», в котором нет последней встречи. VACUUM INTO делает целостную
 * сжатую копию, не останавливая сервер.
 */
export function backupTo(db: Database, dir: string = config.backupDir): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `121-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return path;
}
