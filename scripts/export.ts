/**
 * Полная выгрузка в файл: bun run export [json|md]
 *
 * ВКЛЮЧАЕТ ПРИВАТНОЕ. Это бэкап, а не саммари для подопечного — для саммари есть
 * кнопка «Поделиться» на странице встречи.
 */
import { openDb } from "../src/db/index.ts";
import { exportFullJson, exportFullMarkdown } from "../src/domain/export.ts";

const format = (process.argv[2] ?? "json").toLowerCase();
if (format !== "json" && format !== "md") {
  console.error("Формат: json или md");
  process.exit(1);
}

const db = openDb();
const stamp = new Date().toISOString().slice(0, 10);
const path = `data/121-export-${stamp}.${format}`;
await Bun.write(path, format === "json" ? exportFullJson(db) : exportFullMarkdown(db));
console.log(`${path} — включает приватные заметки, это бэкап.`);
db.close();
