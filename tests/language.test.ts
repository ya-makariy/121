import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Enforces CLAUDE.md rule 1: code and comments are English, Cyrillic lives only in the
 * localization layer.
 *
 * Checked by a test rather than by discipline, because a rule that is only written down is
 * a rule someone will forget. User-facing text belongs in the dictionaries, so a Cyrillic
 * literal appearing in a route, view or domain module is a design mistake, not a typo.
 */
const ROOT = join(import.meta.dir, "..");
// Written as escapes so this guard is itself pure ASCII.
const CYRILLIC = /[\u0400-\u04FF]/;

/**
 * The localization layer and the seeded starter-template content. See CLAUDE.md rule 1.
 *
 * Everything under src/i18n/ is allowed to hold non-Latin text: dictionaries, the
 * transliteration table, and month names in cases Intl does not provide.
 */
const ALLOWED_DIRS = ["src/i18n/"];
const ALLOWED_FILES = new Set([
  "src/db/migrations/0002_seed.sql",
  "src/db/migrations/0003_rename_summary_section.sql",
]);

function isAllowed(rel: string): boolean {
  return ALLOWED_DIRS.some((d) => rel.startsWith(d)) || ALLOWED_FILES.has(rel);
}

const SCAN_DIRS = ["src", "scripts", "tests"];
const SCAN_EXTENSIONS = [".ts", ".sql", ".js", ".css"];
const EXTRA_FILES = ["public/app.css", "public/reorder.js", "public/field-form.js",
                     "public/metric-chart.js", "public/compare-chart.js"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "vendor" || entry === "node_modules") continue;
      walk(full, out);
    } else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  return [...files, ...EXTRA_FILES.map((f) => join(ROOT, f))];
}

describe("language discipline", () => {
  test("no Cyrillic outside the localization layer", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file);
      if (isAllowed(rel)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (CYRILLIC.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  test("even in seeded content, comments are English", () => {
    // The seed carries Russian user content on purpose; its reasoning must still be
    // readable by everyone working on the code.
    const offenders: string[] = [];

    for (const rel of ALLOWED_FILES) {
      if (!rel.endsWith(".sql")) continue;
      readFileSync(join(ROOT, rel), "utf8").split("\n").forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("--") && CYRILLIC.test(trimmed)) {
          offenders.push(`${rel}:${i + 1}: ${trimmed.slice(0, 90)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("the guard actually sees Cyrillic", () => {
    expect(CYRILLIC.test("plain ascii")).toBe(false);
    expect(CYRILLIC.test("has \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430")).toBe(true);
  });
});
