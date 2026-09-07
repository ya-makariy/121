import { describe, expect, test } from "bun:test";
import { classifyCadence } from "../src/domain/cadence.ts";
import { addDays, daysBetween, todayInTz } from "../src/lib/dates.ts";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId,
} from "./helpers.ts";
import { cadenceOverview } from "../src/db/queries/cadence.ts";
import { getMeeting, updateMeetingFields } from "../src/db/queries/meetings.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";
import { getMetricByKey, personTimeline } from "../src/db/queries/metrics.ts";
import { saveAnswer } from "../src/domain/answers.ts";

describe("cadence", () => {
  test("an evening in Moscow does not shift the date to the next day", () => {
    // 21:30 Moscow is 18:30 UTC and both agree on the 7th. But at 00:30 Moscow on the
    // 8th (21:30 UTC on the 7th) UTC still says the 7th while Moscow is already on the
    // 8th — which is exactly how a cadence dashboard ends up a day off.
    expect(todayInTz("Europe/Moscow", new Date("2026-09-07T18:30:00Z"))).toBe("2026-09-07");
    expect(todayInTz("Europe/Moscow", new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-08");
    expect(todayInTz("UTC", new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-07");
  });

  test("overdue is measured from the last completed meeting", () => {
    const s = classifyCadence(
      { cadenceDays: 14, lastHeldOn: "2026-08-20", anchorOn: null }, "2026-09-07",
    );
    expect(s.status).toBe("overdue");
    expect(s.dueOn).toBe("2026-09-03");
    expect(s.daysUntilDue).toBe(-4);
    expect(s.daysSinceLast).toBe(18);
  });

  test("before the first meeting the cadence counts from the anchor", () => {
    const s = classifyCadence(
      { cadenceDays: 14, lastHeldOn: null, anchorOn: "2026-09-01" }, "2026-09-07",
    );
    expect(s.status).toBe("ok");
    expect(s.dueOn).toBe("2026-09-15");
    expect(s.daysSinceLast).toBeNull();
  });

  test("with no cadence the status is no_cadence, not overdue", () => {
    const s = classifyCadence(
      { cadenceDays: null, lastHeldOn: "2026-01-01", anchorOn: null }, "2026-09-07",
    );
    expect(s.status).toBe("no_cadence");
    expect(s.dueOn).toBeNull();
  });

  test("the due_soon boundary follows the threshold", () => {
    const input = { cadenceDays: 14, lastHeldOn: "2026-08-27", anchorOn: null };
    expect(classifyCadence(input, "2026-09-07", 3).status).toBe("due_soon"); // due 09-10
    expect(classifyCadence(input, "2026-09-07", 1).status).toBe("ok");
    expect(classifyCadence(input, "2026-09-10", 3).status).toBe("due_soon");
    expect(classifyCadence(input, "2026-09-11", 3).status).toBe("overdue");
  });

  /**
   * counts_for_cadence narrows cadence arithmetic and nothing else. Without it a
   * five-minute corridor check-in, once recorded, delays the real 1:1 by a full cadence
   * and the only discipline metric in the tool stops meaning anything.
   */
  test("a check-in that does not count for cadence still reaches the chart", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const fieldId = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(versionId)!.id;
    const field = getFieldWithOptions(db, fieldId)!;

    // The real 1:1, eighteen days back. A 14-day cadence was due on the 3rd.
    const proper = makeMeeting(db, personId, versionId, "2026-08-20");
    saveAnswer(db, proper, field, { value: "4" });
    completeMeeting(db, proper);

    // A corridor check-in two days ago, written down because it was worth writing down.
    const checkIn = makeMeeting(db, personId, versionId, "2026-09-05");
    saveAnswer(db, checkIn, field, { value: "5" });
    completeMeeting(db, checkIn);
    // The default is 1: a meeting counts unless the manager says otherwise.
    expect(getMeeting(db, checkIn)!.counts_for_cadence).toBe(1);
    updateMeetingFields(db, checkIn, { counts_for_cadence: 0 });

    const row = cadenceOverview(db, "2026-09-07")[0]!;
    expect(row.last_on).toBe("2026-08-20");
    expect(row.dueOn).toBe("2026-09-03");
    expect(row.status).toBe("overdue");

    // Excluded from cadence only: both answers are still on the person's timeline.
    expect(personTimeline(db, personId, metric.id).map((p) => p.on_date))
      .toEqual(["2026-08-20", "2026-09-05"]);
  });

  test("date arithmetic survives a daylight-saving change", () => {
    // European zones shift clocks in late October; counting at UTC noon ignores that.
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-24", "2026-11-01")).toBe(8);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
