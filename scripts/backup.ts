/** Копия базы одной командой: bun run backup */
import { openDb } from "../src/db/index.ts";
import { backupTo } from "../src/domain/backup.ts";

const db = openDb();
console.log(backupTo(db));
db.close();
