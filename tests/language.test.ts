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
 * The localization layer is the only exception. See CLAUDE.md rule 1.
 *
 * Everything under src/i18n/ is allowed to hold non-Latin text: dictionaries, the
 * transliteration table, and month names in cases Intl does not provide. There is no
 * per-file exception list: the starter template in the seed migrations is English too.
 */
const ALLOWED_DIRS = ["src/i18n/"];

function isAllowed(rel: string): boolean {
  return ALLOWED_DIRS.some((d) => rel.startsWith(d));
}

const SCAN_DIRS = ["src", "scripts", "tests"];
const SCAN_EXTENSIONS = [".ts", ".sql", ".js", ".css"];
const EXTRA_FILES = ["public/app.css", "public/reorder.js", "public/field-form.js",
                     "public/metric-chart.js", "public/compare-chart.js",
                     "public/meeting-rail.js"];

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

  test("the guard actually sees Cyrillic", () => {
    expect(CYRILLIC.test("plain ascii")).toBe(false);
    expect(CYRILLIC.test("has \u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430")).toBe(true);
  });
});
