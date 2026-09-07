import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Автоматическая проверка правила CLAUDE.md §3.
 *
 * date('now') в SQLite — UTC. В Москве после 21:00 это уже завтра, поэтому дашборд
 * каденса начинает врать на день, а «просрочено» появляется раньше срока. Сегодняшнюю
 * дату считает todayInTz() и передаёт запросу параметром.
 *
 * Раньше это правило проверялось руками через grep. Проверка руками — это правило,
 * которое однажды забудут, поэтому она здесь.
 */
const QUERIES_DIR = join(import.meta.dir, "..", "src", "db", "queries");

function codeLines(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlockComment = false;

  source.split("\n").forEach((raw, i) => {
    let text = raw;
    if (inBlockComment) {
      const end = text.indexOf("*/");
      if (end === -1) return;
      text = text.slice(end + 2);
      inBlockComment = false;
    }
    // Убрать блочные комментарии в одной строке и открытый блок.
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = text.indexOf("/*");
    if (open !== -1) {
      inBlockComment = true;
      text = text.slice(0, open);
    }
    // Строчные комментарии: и JS (//), и SQL (--).
    text = text.replace(/\/\/.*$/, "").replace(/--.*$/, "");
    if (text.trim() !== "") out.push({ line: i + 1, text });
  });

  return out;
}

describe("даты в запросах", () => {
  test("ни один запрос не берёт дату из SQLite: date('now') запрещён", () => {
    const offenders: string[] = [];

    for (const file of readdirSync(QUERIES_DIR).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(QUERIES_DIR, file), "utf8");
      for (const { line, text } of codeLines(source)) {
        if (/\bdate\s*\(\s*'now'/i.test(text) || /'now'/.test(text)) {
          offenders.push(`${file}:${line}: ${text.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("сама проверка ловит нарушение, а не проходит впустую", () => {
    const bad = "const q = db.query(\"SELECT date('now')\");";
    const lines = codeLines(bad);
    expect(lines.some((l) => /'now'/.test(l.text))).toBe(true);

    // А комментарий, объясняющий правило, нарушением не считается.
    const comment = "// date('now') в SQLite это UTC\n/* тоже date('now') */\n-- и date('now')";
    expect(codeLines(comment).some((l) => /'now'/.test(l.text))).toBe(false);
  });
});
