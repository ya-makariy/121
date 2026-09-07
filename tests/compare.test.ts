import { describe, expect, test } from "bun:test";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId,
} from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";
import {
  compareByPeriod, getMetricByKey, metricsWithAnyData, sortByAttention, standings,
} from "../src/db/queries/metrics.ts";
import { nowIso } from "../src/lib/dates.ts";
import { dict, plural } from "../src/i18n/index.ts";

function seedPerson(
  db: ReturnType<typeof testDb>, name: string, fieldKey: string, series: [string, string][],
): number {
  const v = defaultVersionId(db);
  const personId = makePerson(db, name);
  const field = db
    .query<{ id: number }, [number, string]>(
      "SELECT id FROM template_field WHERE version_id = ? AND field_key = ?",
    )
    .get(v, fieldKey)!;
  for (const [heldOn, value] of series) {
    const m = makeMeeting(db, personId, v, heldOn);
    saveAnswer(db, m, getFieldWithOptions(db, field.id)!, { value });
    completeMeeting(db, m);
  }
  return personId;
}

describe("comparing people", () => {
  test("the attention ordering follows the metric direction", () => {
    const db = testDb();
    seedPerson(db, "Content", "job_satisfaction", [["2026-08-01", "5"], ["2026-09-01", "5"]]);
    seedPerson(db, "Unhappy", "job_satisfaction", [["2026-08-01", "3"], ["2026-09-01", "2"]]);
    seedPerson(db, "Middling", "job_satisfaction", [["2026-09-01", "4"]]);

    const metric = getMetricByKey(db, "job_satisfaction")!;
    const rows = standings(db, metric.id, null);

    // direction = 1: lower is worse, so the worst come first.
    const up = sortByAttention(rows, 1).map((r) => r.full_name);
    expect(up[0]).toBe("Unhappy");
    expect(up.at(-1)).toBe("Content");

    // direction = -1 (workload, attrition risk): higher is worse, so the order flips.
    const down = sortByAttention(rows, -1).map((r) => r.full_name);
    expect(down[0]).toBe("Content");
    expect(down.at(-1)).toBe("Unhappy");
  });

  test("the previous value is pulled in alongside the latest one", () => {
    const db = testDb();
    const personId = seedPerson(db, "Someone", "job_satisfaction", [
      ["2026-07-01", "2"], ["2026-08-01", "3"], ["2026-09-01", "5"],
    ]);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const row = standings(db, metric.id, null).find((r) => r.person_id === personId)!;

    expect(row.on_date).toBe("2026-09-01");
    expect(row.raw_value).toBe(5);
    expect(row.norm_value).toBeCloseTo(1, 5);
    expect(row.prev_date).toBe("2026-08-01");
    expect(row.prev_norm).toBeCloseTo(0.5, 5);
    expect(row.n).toBe(3);
  });

  test("a person with one point produces no phantom change", () => {
    const db = testDb();
    seedPerson(db, "Newcomer", "job_satisfaction", [["2026-09-01", "3"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const row = standings(db, metric.id, null)[0]!;
    expect(row.n).toBe(1);
    expect(row.prev_norm).toBeNull();
  });

  test("two meetings by one person in a month carry no double weight", () => {
    const db = testDb();
    seedPerson(db, "Twice", "job_satisfaction", [["2026-09-03", "1"], ["2026-09-20", "5"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;

    const rows = compareByPeriod(db, metric.id, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.period).toBe("2026-09");
    expect(rows[0]!.n).toBe(2);
    expect(rows[0]!.avg_raw).toBe(3); // one point per person per month, not two
  });

  test("the team filter excludes anyone outside it", () => {
    const db = testDb();
    const inTeam = seedPerson(db, "In the team", "job_satisfaction", [["2026-09-01", "5"]]);
    seedPerson(db, "Outside it", "job_satisfaction", [["2026-09-01", "1"]]);

    const team = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO team (owner_id, name, created_at, updated_at) VALUES (1, 'T', ?, ?) RETURNING id",
      )
      .get(nowIso(), nowIso())!.id;
    db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
      .run(team, inTeam);

    const metric = getMetricByKey(db, "job_satisfaction")!;
    expect(standings(db, metric.id, null)).toHaveLength(2);
    const scoped = standings(db, metric.id, team);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.full_name).toBe("In the team");
  });

  test("an archived person disappears from the comparison", () => {
    const db = testDb();
    const personId = seedPerson(db, "Departed", "job_satisfaction", [["2026-09-01", "3"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    expect(standings(db, metric.id, null)).toHaveLength(1);

    db.query("UPDATE person SET archived_at = ? WHERE id = ?").run(nowIso(), personId);
    expect(standings(db, metric.id, null)).toHaveLength(0);
    expect(compareByPeriod(db, metric.id, null)).toHaveLength(0);
  });

  test("a private metric is not what the comparison screen opens on", () => {
    // The first thing the manager sees must not be an attrition-risk assessment.
    const db = testDb();
    const v = defaultVersionId(db);
    const personId = makePerson(db);
    const m = makeMeeting(db, personId, v, "2026-09-01");

    for (const key of ["attrition_risk", "job_satisfaction"]) {
      const f = db
        .query<{ id: number }, [number, string]>(
          "SELECT id FROM template_field WHERE version_id = ? AND field_key = ?",
        )
        .get(v, key)!;
      const field = getFieldWithOptions(db, f.id)!;
      saveAnswer(db, m, field, key === "attrition_risk" ? { optionKeys: ["high"] } : { value: "4" });
    }
    completeMeeting(db, m);

    const metrics = metricsWithAnyData(db);
    expect(metrics.length).toBeGreaterThanOrEqual(2);
    expect(metrics[0]!.key).toBe("job_satisfaction");
    expect(metrics.at(-1)!.key).toBe("attrition_risk");
  });
});

describe("pluralization", () => {
  // The forms themselves live in the dictionaries; what is tested here is which form the
  // algorithm picks, so the test needs no words from any particular language.
  const RU_FORMS = ["one", "few", "many"] as const;
  const EN_FORMS = ["one", "many"] as const;

  test("Russian picks the right one of three forms", () => {
    expect(plural("ru", 1, RU_FORMS)).toBe("1 one");
    expect(plural("ru", 2, RU_FORMS)).toBe("2 few");
    expect(plural("ru", 5, RU_FORMS)).toBe("5 many");
    expect(plural("ru", 11, RU_FORMS)).toBe("11 many");
    expect(plural("ru", 21, RU_FORMS)).toBe("21 one");
    expect(plural("ru", 22, RU_FORMS)).toBe("22 few");
    expect(plural("ru", 105, RU_FORMS)).toBe("105 many");
    expect(plural("ru", 111, RU_FORMS)).toBe("111 many");
  });

  test("English picks the right one of two", () => {
    expect(plural("en", 1, EN_FORMS)).toBe("1 one");
    expect(plural("en", 2, EN_FORMS)).toBe("2 many");
    expect(plural("en", 21, EN_FORMS)).toBe("21 many");
  });

  test("the dictionaries supply as many forms as their language needs", () => {
    // A Russian entry with two forms would silently print "1 \u0442\u043e\u0447\u0435\u043a".
    expect(dict("ru").compare.pointForms).toHaveLength(3);
    expect(dict("ru").editor.answerForms).toHaveLength(3);
    expect(dict("en").compare.pointForms).toHaveLength(2);
    expect(dict("en").editor.answerForms).toHaveLength(2);
  });
});
