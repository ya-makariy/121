import { describe, expect, test } from "bun:test";
import { testDb } from "./helpers.ts";
import {
  BIRTHDAY_INPUT_PATTERN, birthdayInYear, formatBirthdayInput, parseBirthdayInput,
} from "../src/lib/dates.ts";
import { classifyBirthday, isUpcoming } from "../src/domain/birthdays.ts";
import {
  archivePerson, birthdayOf, createPerson, getPerson, updatePerson, upcomingBirthdays,
} from "../src/db/queries/people.ts";
import { dashboardPage } from "../src/views/pages/dashboard.ts";
import { personFormPage, peopleListPage } from "../src/views/pages/people.ts";
import { formatDayMonth } from "../src/i18n/dates.ts";
import { dict, plural } from "../src/i18n/index.ts";
import { buildSharedSnapshot } from "../src/domain/snapshot.ts";
import { makeMeeting, defaultVersionId } from "./helpers.ts";

const WINDOW = 7;

function person(db: ReturnType<typeof testDb>, name: string, birthday: string | null) {
  return createPerson(db, {
    full_name: name, email: null, role_title: null, cadence_days: null,
    cadence_anchor_on: null, default_template_id: null, meeting_url: null,
    birthday: birthday === null ? null : parseBirthdayInput(birthday),
    notes: null,
  });
}

/**
 * The year is optional. A birthday is a day that recurs; the year is a separate fact the
 * person may keep to themselves, so the parser must not demand it and must not invent it.
 */
describe("reading a typed birthday", () => {
  test("day and month, with or without a year", () => {
    expect(parseBirthdayInput("12.11")).toEqual({ month: 11, day: 12, year: null });
    expect(parseBirthdayInput("12.11.1990")).toEqual({ month: 11, day: 12, year: 1990 });
    expect(parseBirthdayInput("1.2")).toEqual({ month: 2, day: 1, year: null });
    expect(parseBirthdayInput("01/02/1999")).toEqual({ month: 2, day: 1, year: 1999 });
    expect(parseBirthdayInput(" 1-2-1999 ")).toEqual({ month: 2, day: 1, year: 1999 });
  });

  test("the ISO forms parse too, year-less included", () => {
    expect(parseBirthdayInput("1990-11-12")).toEqual({ month: 11, day: 12, year: 1990 });
    expect(parseBirthdayInput("--11-12")).toEqual({ month: 11, day: 12, year: null });
  });

  test("a day that does not exist is refused, not rolled over", () => {
    expect(parseBirthdayInput("31.02")).toBeNull();
    expect(parseBirthdayInput("31.04.1990")).toBeNull();
    expect(parseBirthdayInput("29.02.1991")).toBeNull();
    expect(parseBirthdayInput("00.05")).toBeNull();
    expect(parseBirthdayInput("12.13")).toBeNull();
  });

  test("the 29th of February is a birthday one can have, even without a year", () => {
    expect(parseBirthdayInput("29.02")).toEqual({ month: 2, day: 29, year: null });
    expect(parseBirthdayInput("29.02.1992")).toEqual({ month: 2, day: 29, year: 1992 });
  });

  test("nothing, or not a birthday, is null", () => {
    expect(parseBirthdayInput("")).toBeNull();
    expect(parseBirthdayInput("   ")).toBeNull();
    expect(parseBirthdayInput("November 12")).toBeNull();
    expect(parseBirthdayInput("12.11.90")).toBeNull();
    // Outside the CHECK constraint in migration 0006.
    expect(parseBirthdayInput("12.11.1850")).toBeNull();
  });

  test("formatting is the inverse of parsing", () => {
    for (const typed of ["12.11", "12.11.1990", "01.02", "29.02.1992"]) {
      expect(formatBirthdayInput(parseBirthdayInput(typed))).toBe(typed);
    }
    expect(formatBirthdayInput(null)).toBe("");
  });

  test("the HTML pattern accepts exactly what the parser does", () => {
    const re = new RegExp(`^(?:${BIRTHDAY_INPUT_PATTERN})$`, "v");
    for (const ok of ["12.11", "12.11.1990", "1/2", "1-2-1999", "1990-11-12", "--11-12", " 12.11 "]) {
      expect(re.test(ok)).toBe(true);
    }
    for (const bad of ["12.11.90", "November", "12", ""]) {
      expect(re.test(bad)).toBe(false);
    }
  });
});

describe("where a birthday stands", () => {
  test("today, inside the window, on its edge, and just past it", () => {
    const today = "2026-11-09";
    const on = (d: string) => classifyBirthday(parseBirthdayInput(d)!, today);
    expect(on("09.11").daysUntil).toBe(0);
    expect(on("16.11").daysUntil).toBe(WINDOW);
    expect(on("17.11").daysUntil).toBe(WINDOW + 1);
    expect(isUpcoming(on("09.11"), WINDOW)).toBe(true);
    expect(isUpcoming(on("16.11"), WINDOW)).toBe(true);
    expect(isUpcoming(on("17.11"), WINDOW)).toBe(false);
  });

  test("yesterday's birthday is next year's, not an overdue one", () => {
    const state = classifyBirthday(parseBirthdayInput("08.11")!, "2026-11-09");
    expect(state.on).toBe("2027-11-08");
    expect(state.daysUntil).toBe(364);
    expect(isUpcoming(state, WINDOW)).toBe(false);
  });

  test("the window crosses the new year", () => {
    const state = classifyBirthday(parseBirthdayInput("03.01.1990")!, "2026-12-28");
    expect(state.on).toBe("2027-01-03");
    expect(state.daysUntil).toBe(6);
    expect(state.turning).toBe(37);
    expect(isUpcoming(state, WINDOW)).toBe(true);
  });

  test("the age is the one they turn, and null without a year", () => {
    expect(classifyBirthday(parseBirthdayInput("12.11.1990")!, "2026-11-09").turning).toBe(36);
    // Already had this year's birthday: the next one is a year later.
    expect(classifyBirthday(parseBirthdayInput("01.11.1990")!, "2026-11-09").turning).toBe(37);
    expect(classifyBirthday(parseBirthdayInput("12.11")!, "2026-11-09").turning).toBeNull();
  });

  test("the 29th of February falls on the 28th in a year without one", () => {
    expect(birthdayInYear({ month: 2, day: 29, year: null }, 2028)).toBe("2028-02-29");
    expect(birthdayInYear({ month: 2, day: 29, year: null }, 2027)).toBe("2027-02-28");
    const state = classifyBirthday(parseBirthdayInput("29.02.1992")!, "2027-02-25");
    expect(state.on).toBe("2027-02-28");
    expect(state.daysUntil).toBe(3);
    expect(state.turning).toBe(35);
  });
});

describe("storing a birthday", () => {
  test("round-trips through the person row, with and without a year", () => {
    const db = testDb();
    const withYear = person(db, "Someone Dated", "12.11.1990");
    const without = person(db, "Someone Undated", "12.11");
    const none = person(db, "Someone Quiet", null);

    expect(birthdayOf(getPerson(db, withYear.id)!)).toEqual({ month: 11, day: 12, year: 1990 });
    expect(birthdayOf(getPerson(db, without.id)!)).toEqual({ month: 11, day: 12, year: null });
    expect(birthdayOf(getPerson(db, none.id)!)).toBeNull();

    // Clearing it clears all three columns, so month and day never outlive each other.
    updatePerson(db, withYear.id, {
      full_name: "Someone Dated", email: null, role_title: null, cadence_days: null,
      cadence_anchor_on: null, default_template_id: null, meeting_url: null,
      birthday: null, notes: null,
    });
    const cleared = getPerson(db, withYear.id)!;
    expect([cleared.birth_month, cleared.birth_day, cleared.birth_year]).toEqual([null, null, null]);
  });

  test("the database refuses a month or day the parser would also refuse", () => {
    const db = testDb();
    expect(() =>
      db.query("INSERT INTO person (owner_id, full_name, birth_month, birth_day, created_at, updated_at) VALUES (1, 'x', 13, 1, 'now', 'now')").run(),
    ).toThrow();
    expect(() =>
      db.query("INSERT INTO person (owner_id, full_name, birth_month, birth_day, created_at, updated_at) VALUES (1, 'x', 1, 32, 'now', 'now')").run(),
    ).toThrow();
  });
});

describe("the dashboard reminder", () => {
  test("lists the window, soonest first, and leaves out the archived and the distant", () => {
    const db = testDb();
    const today = "2026-11-09";
    person(db, "Someone Today", "09.11.1990");
    person(db, "Someone Edge", "16.11");
    person(db, "Someone Outside", "17.11");
    person(db, "Someone Yesterday", "08.11");
    person(db, "Someone Quiet", null);
    const gone = person(db, "Someone Archived", "10.11");
    archivePerson(db, gone.id);

    const list = upcomingBirthdays(db, today, WINDOW);
    expect(list.map((b) => b.full_name)).toEqual(["Someone Today", "Someone Edge"]);
    expect(list[0]).toMatchObject({ daysUntil: 0, on: today, turning: 36 });
    expect(list[1]).toMatchObject({ daysUntil: WINDOW, on: "2026-11-16", turning: null });
  });

  test("two birthdays on one day are ordered by name", () => {
    const db = testDb();
    person(db, "Zed", "11.11");
    person(db, "Abe", "11.11");
    expect(upcomingBirthdays(db, "2026-11-09", WINDOW).map((b) => b.full_name)).toEqual(["Abe", "Zed"]);
  });

  test("renders a block only when there is someone to mention", () => {
    const base = {
      locale: "en" as const, theme: "auto" as const, today: "2026-11-09",
      cadence: { groups: [], total: 0, waiting: 0 }, actions: [],
    };
    const quiet = dashboardPage({ ...base, birthdays: [] });
    expect(quiet).not.toContain("Birthdays");

    const loud = dashboardPage({
      ...base,
      birthdays: [
        { id: 1, full_name: "Someone Today", on: "2026-11-09", daysUntil: 0, turning: 36 },
        { id: 2, full_name: "Someone Soon", on: "2026-11-14", daysUntil: 5, turning: null },
      ],
    });
    expect(loud).toContain("Birthdays");
    expect(loud).toContain("today!");
    expect(loud).toContain("turns 36");
    expect(loud).toContain("in 5 days · 14 November");
    expect(loud).toContain('href="/people/2"');
  });

  test("the Russian wording agrees in number with the days", () => {
    const base = {
      locale: "ru" as const, theme: "auto" as const, today: "2026-11-09",
      cadence: { groups: [], total: 0, waiting: 0 }, actions: [],
    };
    const page = dashboardPage({
      ...base,
      birthdays: [
        { id: 1, full_name: "A", on: "2026-11-10", daysUntil: 1, turning: null },
        { id: 2, full_name: "B", on: "2026-11-11", daysUntil: 2, turning: null },
        { id: 3, full_name: "C", on: "2026-11-14", daysUntil: 5, turning: 30 },
      ],
    });
    expect(page).toContain(formatDayMonth(11, 11, "ru"));
    // Both forms come from the dictionary, so this stays pure ASCII (rule 1) and still
    // fails if the plural rule is bypassed.
    const forms = dict("ru").dashboard.dayForms;
    expect(plural("ru", 2, forms)).not.toBe(plural("ru", 5, forms));
    expect(page).toContain(plural("ru", 2, forms));
    expect(page).toContain(plural("ru", 5, forms));
  });
});

describe("the form", () => {
  test("shows the stored birthday as typed, and a refused draft as typed too", () => {
    const db = testDb();
    const p = person(db, "Someone Dated", "12.11.1990");
    const stored = personFormPage({
      locale: "en", theme: "auto", person: getPerson(db, p.id)!, templates: [], teams: [],
      today: "2026-11-09",
    });
    expect(stored).toContain('name="birthday"');
    expect(stored).toContain('value="12.11.1990"');

    const refused = personFormPage({
      locale: "en", theme: "auto", person: getPerson(db, p.id)!, templates: [], teams: [],
      today: "2026-11-09", birthdayDraft: "November 12",
    });
    expect(refused).toContain('value="November 12"');
    // The list page is unaffected.
    expect(peopleListPage({ locale: "en", theme: "auto", people: [getPerson(db, p.id)!], archived: [] }))
      .toContain("Someone Dated");
  });
});

/** Rule 2: the birthday is the manager's reminder and never leaves the instance. */
describe("privacy", () => {
  test("a birthday never reaches the shared snapshot", () => {
    const db = testDb();
    const p = person(db, "Someone Dated", "12.11.1990");
    const meeting = makeMeeting(db, p.id, defaultVersionId(db), "2026-11-01");
    const snapshot = JSON.stringify(buildSharedSnapshot(db, meeting, "en"));
    expect(snapshot).not.toContain("1990");
    expect(snapshot).not.toContain("birth");
  });
});
