import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Automated check for CLAUDE.md rule 4.
 *
 * date('now') in SQLite is UTC. In Moscow after 21:00 that is already tomorrow, so the
 * cadence dashboard starts being a day off and "overdue" appears before it is due.
 * Today's date is computed by todayInTz() and passed to the query as a parameter.
 *
 * This rule used to be checked by hand with grep. A rule checked by hand is a rule someone
 * will forget, so it lives here instead.
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
    // Strip single-line block comments and an opening block.
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = text.indexOf("/*");
    if (open !== -1) {
      inBlockComment = true;
      text = text.slice(0, open);
    }
    // Line comments: both JS (//) and SQL (--).
    text = text.replace(/\/\/.*$/, "").replace(/--.*$/, "");
    if (text.trim() !== "") out.push({ line: i + 1, text });
  });

  return out;
}

describe("dates in queries", () => {
  test("no query takes the date from SQLite: date('now') is banned", () => {
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

  test("the guard itself catches a violation rather than passing vacuously", () => {
    const bad = "const q = db.query(\"SELECT date('now')\");";
    const lines = codeLines(bad);
    expect(lines.some((l) => /'now'/.test(l.text))).toBe(true);

    // A comment explaining the rule does not count as a violation.
    const comment = "// date('now') is UTC\n/* also date('now') */\n-- and date('now')";
    expect(codeLines(comment).some((l) => /'now'/.test(l.text))).toBe(false);
  });
});
