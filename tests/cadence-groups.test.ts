import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { testDb } from "./helpers.ts";
import { CADENCE_GROUP_ORDER, cadenceGroups } from "../src/db/queries/cadence.ts";
import { addDays, nowIso } from "../src/lib/dates.ts";
import { config } from "../src/config.ts";

const TODAY = "2026-09-07";
const CADENCE = 14;

/**
 * A person whose next 1:1 falls due exactly on `dueOn`. The anchor is used rather than a
 * meeting because the boundary being tested is arithmetic, not history: cadence counts
 * from the anchor until the first meeting exists.
 */
function personDue(db: Database, name: string, dueOn: string | null): number {
  const now = nowIso();
  return db
    .query<{ id: number }, [string, number | null, string | null, string, string]>(
      `INSERT INTO person
         (owner_id, full_name, cadence_days, cadence_anchor_on, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(name, dueOn === null ? null : CADENCE, dueOn === null ? null : addDays(dueOn, -CADENCE), now, now)!
    .id;
}

function keysOf(groups: { key: string }[]): string[] {
  return groups.map((g) => g.key);
}

/**
 * The dashboard's grouping. It is asserted against config.dueSoonDays rather than against
 * a literal 3, so the boundary stays pinned if DUE_SOON_DAYS is changed in the
 * environment: the point of the test is that the edge lands on the near side, not that the
 * window happens to be three days wide.
 */
describe("cadence grouping", () => {
  const soon = config.dueSoonDays;

  test("the DUE_SOON_DAYS boundary lands on the near side", () => {
    const db = testDb();
    // One day past due — overdue, not "due soon".
    personDue(db, "Late By One", addDays(TODAY, -1));
    // Due today: still inside the window, so it is not overdue yet.
    personDue(db, "Due Today", TODAY);
    // The last day of the window.
    personDue(db, "On The Edge", addDays(TODAY, soon));
    // One day beyond it.
    personDue(db, "Just Outside", addDays(TODAY, soon + 1));

    const byPerson = new Map<string, string>();
    for (const g of cadenceGroups(db, TODAY).groups) {
      for (const p of g.people) byPerson.set(p.full_name, g.key);
    }

    expect(byPerson.get("Late By One")).toBe("overdue");
    expect(byPerson.get("Due Today")).toBe("due_soon");
    expect(byPerson.get("On The Edge")).toBe("due_soon");
    expect(byPerson.get("Just Outside")).toBe("ok");
  });

  test("a person with no cadence is in none of the three urgency groups", () => {
    const db = testDb();
    personDue(db, "No Reminders", null);
    personDue(db, "Late By One", addDays(TODAY, -1));

    const overview = cadenceGroups(db, TODAY);

    // Listed separately, and never mistaken for someone who is on time or late.
    expect(keysOf(overview.groups)).toEqual(["overdue", "no_cadence"]);
    const withoutCadence = overview.groups.find((g) => g.key === "no_cadence")!;
    expect(withoutCadence.people.map((p) => p.full_name)).toEqual(["No Reminders"]);

    // And not counted among the people today is asking about.
    expect(overview.total).toBe(2);
    expect(overview.waiting).toBe(1);
  });

  test("an empty group is not returned at all", () => {
    const db = testDb();
    personDue(db, "Comfortably Ahead", addDays(TODAY, soon + 30));

    const overview = cadenceGroups(db, TODAY);
    expect(keysOf(overview.groups)).toEqual(["ok"]);
    expect(overview.waiting).toBe(0);

    expect(keysOf(cadenceGroups(testDb(), TODAY).groups)).toEqual([]);
  });

  test("the order is the fixed one, never the order people were added in", () => {
    const db = testDb();
    // Inserted deliberately back to front.
    personDue(db, "No Reminders", null);
    personDue(db, "Comfortably Ahead", addDays(TODAY, soon + 30));
    personDue(db, "On The Edge", addDays(TODAY, soon));
    personDue(db, "Late By One", addDays(TODAY, -1));

    const keys = keysOf(cadenceGroups(db, TODAY).groups);
    expect(keys).toEqual(["overdue", "due_soon", "ok", "no_cadence"]);
    expect(keys).toEqual([...CADENCE_GROUP_ORDER]);
  });

  test("waiting counts the overdue and the nearly due, and nobody else", () => {
    const db = testDb();
    personDue(db, "Late By One", addDays(TODAY, -1));
    personDue(db, "Late By Ten", addDays(TODAY, -10));
    personDue(db, "On The Edge", addDays(TODAY, soon));
    personDue(db, "Comfortably Ahead", addDays(TODAY, soon + 30));
    personDue(db, "No Reminders", null);

    const overview = cadenceGroups(db, TODAY);
    expect(overview.total).toBe(5);
    expect(overview.waiting).toBe(3);
  });

  test("within the overdue group the longest wait comes first", () => {
    const db = testDb();
    personDue(db, "Late By One", addDays(TODAY, -1));
    personDue(db, "Late By Ten", addDays(TODAY, -10));

    const overdue = cadenceGroups(db, TODAY).groups[0]!;
    expect(overdue.key).toBe("overdue");
    expect(overdue.people.map((p) => p.full_name)).toEqual(["Late By Ten", "Late By One"]);
  });
});
