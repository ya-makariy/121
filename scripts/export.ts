/**
 * A full dump to a file: bun run export [json|md]
 *
 * INCLUDES PRIVATE CONTENT. This is a backup, not a summary for the mentee — for that
 * there is the Share button on the meeting page.
 */
import { openDb } from "../src/db/index.ts";
import { exportFullJson, exportFullMarkdown } from "../src/domain/export.ts";
import { config } from "../src/config.ts";
import { dict } from "../src/i18n/index.ts";

const format = (process.argv[2] ?? "json").toLowerCase();
if (format !== "json" && format !== "md") {
  console.error("Format: json or md");
  process.exit(1);
}

const db = openDb();
const stamp = new Date().toISOString().slice(0, 10);
const path = `data/121-export-${stamp}.${format}`;
await Bun.write(
  path,
  format === "json" ? exportFullJson(db) : exportFullMarkdown(db, config.defaultLocale),
);
console.log(`${path} — ${dict(config.defaultLocale).exportDoc.includesPrivate}`);
db.close();
