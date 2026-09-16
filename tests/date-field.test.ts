import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATE_INPUT_PATTERN, formatDateInput, parseDateInput } from "../src/lib/dates.ts";
import { monthNames, weekdayNames } from "../src/i18n/dates.ts";
import { dateField } from "../src/views/components/date-field.ts";

/**
 * The app's own date field.
 *
 * `<input type="date">` renders in the browser's locale, not the page's, so the same
 * Russian page showed a different order on a machine configured in English and nothing in
 * the markup could say otherwise. The field is now a text input in day-month-year order
 * and the parsing happens on the server, which is what these tests pin: one order in, the
 * canonical YYYY-MM-DD out (rule 4).
 */

describe("reading a typed date", () => {
  test("day first, always", () => {
    expect(parseDateInput("08.09.2026")).toBe("2026-09-08");
    expect(parseDateInput("8.9.2026")).toBe("2026-09-08");
    expect(parseDateInput("08/09/2026")).toBe("2026-09-08");
    expect(parseDateInput("08-09-2026")).toBe("2026-09-08");
    // 03.04 is the third of April on every machine, which is the entire point.
    expect(parseDateInput("03.04.2026")).toBe("2026-04-03");
  });

  test("the canonical form still parses, so nothing that worked stopped working", () => {
    expect(parseDateInput("2026-09-08")).toBe("2026-09-08");
    expect(parseDateInput("  2026-09-08 ")).toBe("2026-09-08");
  });

  test("a date that is not a day is refused rather than rolled over", () => {
    expect(parseDateInput("31.02.2026")).toBeNull();
    expect(parseDateInput("2026-02-31")).toBeNull();
    expect(parseDateInput("00.09.2026")).toBeNull();
    expect(parseDateInput("08.13.2026")).toBeNull();
  });

  test("nothing is not a date", () => {
    for (const junk of ["", "   ", "tomorrow", "8.9.26", "2026", "8.9.2026.1"]) {
      expect(parseDateInput(junk)).toBeNull();
    }
  });

  test("formatting is the exact inverse", () => {
    expect(formatDateInput("2026-09-08")).toBe("08.09.2026");
    expect(parseDateInput(formatDateInput("2026-01-31"))).toBe("2026-01-31");
    expect(formatDateInput(null)).toBe("");
    expect(formatDateInput("not a date")).toBe("");
  });
});

describe("the calendar's vocabulary", () => {
  test("twelve months and seven weekdays in each locale", () => {
    for (const locale of ["ru", "en"] as const) {
      expect(monthNames(locale)).toHaveLength(12);
      expect(weekdayNames(locale)).toHaveLength(7);
      // A pipe would break the data- attribute the picker splits on.
      for (const word of [...monthNames(locale), ...weekdayNames(locale)]) {
        expect(word).not.toContain("|");
        expect(word.length).toBeGreaterThan(0);
      }
    }
  });

  test("the week starts on Monday, in both locales", () => {
    // Asserted through the English list, which is derived from a date that was a Monday.
    // The Russian list is checked for alignment rather than by spelling it out here: the
    // words themselves belong to src/i18n/ and nowhere else (rule 1).
    expect(weekdayNames("en")[0]).toBe("Mon");
    expect(weekdayNames("ru")).toHaveLength(weekdayNames("en").length);
    expect(weekdayNames("ru")).not.toEqual(weekdayNames("en"));
  });
});

describe("the rendered field", () => {
  test("a text input carrying the real name, filled day-first", () => {
    const out = dateField({
      locale: "en", id: "due_on", name: "due_on", value: "2026-09-08", today: "2026-09-08",
    }).value;
    expect(out).toContain('name="due_on"');
    expect(out).toContain('id="due_on"');
    expect(out).toContain('value="08.09.2026"');
    expect(out).not.toContain('type="date"');
  });

  test("a value that is not a date is echoed back, not blanked", () => {
    // The person form redisplays after a validation error; losing what was typed there
    // would punish the wrong mistake.
    const out = dateField({
      locale: "ru", id: "a", name: "a", value: "31.02.2026", today: "2026-09-08",
    }).value;
    expect(out).toContain('value="31.02.2026"');
  });

  test("the field refuses, in the browser, what the server would not read as a date", () => {
    const out = dateField({
      locale: "en", id: "a", name: "a", value: null, today: "2026-09-08",
    }).value;
    expect(out).toContain(`pattern="${DATE_INPUT_PATTERN}"`);
    // The browser compiles `pattern` with the `v` flag and anchors it to the whole value.
    const re = new RegExp(`^(?:${DATE_INPUT_PATTERN})$`, "v");
    for (const ok of ["08.09.2026", "8.9.2026", "8/9/2026", "08-09-2026", "2026-09-08", " 08.09.2026 "]) {
      expect(re.test(ok)).toBe(true);
      expect(parseDateInput(ok)).not.toBeNull();
    }
    for (const bad of ["", "text", "8.9.26", "2026/09/08", "08.09", "\u044b\u0444\u0432"]) {
      expect(re.test(bad)).toBe(false);
      expect(parseDateInput(bad)).toBeNull();
    }
  });

  test("every word the picker says is rendered by the server", () => {
    const out = dateField({
      locale: "ru", id: "a", name: "a", value: null, today: "2026-09-08",
    }).value;
    for (const attr of ["data-months", "data-weekdays", "data-today", "data-clear",
                        "data-prev", "data-next", "data-close", "data-dialog"]) {
      expect(out).toContain(`${attr}="`);
    }
    expect(out).toContain('data-today-on="2026-09-08"');
  });
});

/**
 * The invariant, enforced the way rule 4 enforces `date('now')`: once the app has its own
 * date field, a stray native one would quietly reintroduce the browser's format on exactly
 * one screen, and nothing would say which.
 */
describe("no view renders a native date control", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  }

  test("type=\"date\" appears nowhere under src/views", () => {
    const offenders = walk(join(import.meta.dir, "..", "src", "views"))
      .filter((file) => readFileSync(file, "utf8").includes('type="date"'));
    expect(offenders).toEqual([]);
  });

  test("the picker script hardcodes no user-facing text", () => {
    // Rule 6: client scripts take their strings from data- attributes. The only quoted
    // words allowed here are class names, attribute names and the two chevrons.
    const script = readFileSync(
      join(import.meta.dir, "..", "public", "date-picker.js"), "utf8",
    );
    expect(script).not.toMatch(/[\u0400-\u04ff]/);
    expect(script).toContain("dataset.months");
    expect(script).toContain("dataset.today");
  });
});
