import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";

/**
 * Backups go through VACUUM INTO only. See CLAUDE.md rule 7.
 *
 * With WAL enabled, copying the .sqlite file silently loses whatever is still in the -wal:
 * you get a "backup" without the latest meeting in it. VACUUM INTO produces a consistent,
 * compacted copy without stopping the server.
 */
export function backupTo(db: Database, dir: string = config.backupDir): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `121-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return path;
}
