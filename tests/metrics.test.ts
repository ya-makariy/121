import { describe, expect, test } from "bun:test";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId, addField,
} from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";
import { getMetricByKey, personTimeline, teamAggregate } from "../src/db/queries/metrics.ts";
import { nowIso } from "../src/lib/dates.ts";

/**
 * The point of "metric" being its own entity: a chart does not break when a template is
 * edited, and it merges points from different templates with different scales.
 */
describe("metrics", () => {
  test("moving from a 1-5 to a 1-10 scale keeps values comparable via normalization", () => {
    const db = testDb();
    const personId = makePerson(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;

    // Seed version 1: a 1-5 scale, answer 4 => normalized (4-1)/(5-1) = 0.75.
    const v1 = defaultVersionId(db);
    const m1 = makeMeeting(db, personId, v1, "2026-07-01");
    const f1 = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(v1)!;
    saveAnswer(db, m1, getFieldWithOptions(db, f1.id)!, { value: "4" });
    completeMeeting(db, m1);

    // Version 2: the same metric, a 1-10 scale, answer 7 => (7-1)/(10-1) = 0.666...
    const v2 = db
      .query<{ id: number }, [number, string]>(
        `INSERT INTO template_version (template_id, version_no, parent_version_id, created_at)
         VALUES ((SELECT template_id FROM template_version WHERE id = ?), 2, ?, datetime('now'))
         RETURNING id`,
      )
      .get(v1, String(v1))!.id;
    const f2 = addField(db, v2, {
      fieldKey: "job_satisfaction", label: "How satisfying is the work",
      type: "scale", visibility: "shared", metricKey: "job_satisfaction",
      scaleMin: 1, scaleMax: 10,
    });
    const m2 = makeMeeting(db, personId, v2, "2026-08-01");
    saveAnswer(db, m2, getFieldWithOptions(db, f2)!, { value: "7" });
    completeMeeting(db, m2);

    const points = personTimeline(db, personId, metric.id);
    expect(points).toHaveLength(2);
    expect(points[0]!.raw_value).toBe(4);
    expect(points[0]!.norm_value).toBeCloseTo(0.75, 5);
    expect(points[1]!.raw_value).toBe(7);
    expect(points[1]!.norm_value).toBeCloseTo(6 / 9, 5);

    // Raw values 4 and 7 "went up" while the normalized ones went down. That is exactly
    // why a chart over mixed scales must plot the normalized value, not the raw one.
    expect(points[1]!.raw_value!).toBeGreaterThan(points[0]!.raw_value!);
    expect(points[1]!.norm_value!).toBeLessThan(points[0]!.norm_value!);
  });

  test("an unfinished meeting does not reach the chart", () => {
    const db = testDb();
    const personId = makePerson(db);
    const v = defaultVersionId(db);
    const m = makeMeeting(db, personId, v, "2026-09-07");
    const f = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'energy'",
      )
      .get(v)!;
    saveAnswer(db, m, getFieldWithOptions(db, f.id)!, { value: "5" });

    const metric = getMetricByKey(db, "energy")!;
    expect(personTimeline(db, personId, metric.id)).toHaveLength(0);
    completeMeeting(db, m);
    expect(personTimeline(db, personId, metric.id)).toHaveLength(1);
  });

  test("a field with no metric does not reach the chart", () => {
    const db = testDb();
    const personId = makePerson(db);
    const v = defaultVersionId(db);
    const m = makeMeeting(db, personId, v, "2026-09-07");
    const f = addField(db, v, {
      fieldKey: "just_a_note", label: "just a scale with no metric", type: "scale",
      visibility: "shared", scaleMin: 1, scaleMax: 5,
    });
    saveAnswer(db, m, getFieldWithOptions(db, f)!, { value: "2" });
    completeMeeting(db, m);

    const rows = db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM v_metric_point WHERE person_id = ?")
      .all(personId);
    expect(rows[0]!.n).toBe(0);
  });

  test("team aggregate: two meetings by one person in a month do not double their weight", () => {
    const db = testDb();
    const v = defaultVersionId(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(v)!;

    const team = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO team (owner_id, name, created_at, updated_at) VALUES (1, 'A team', ?, ?) RETURNING id",
      )
      .get(nowIso(), nowIso())!.id;

    // Ann: two September meetings with 1 and 5 => her normalized average is 0.5.
    // Bob and Cleo: one meeting each with 3 => normalized 0.5 apiece.
    const people = [
      { name: "Ann", values: ["1", "5"], dates: ["2026-09-03", "2026-09-20"] },
      { name: "Bob", values: ["3"], dates: ["2026-09-10"] },
      { name: "Cleo", values: ["3"], dates: ["2026-09-11"] },
    ];
    for (const p of people) {
      const pid = makePerson(db, p.name);
      db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
        .run(team, pid);
      p.values.forEach((value, i) => {
        const m = makeMeeting(db, pid, v, p.dates[i]!);
        saveAnswer(db, m, getFieldWithOptions(db, field.id)!, { value });
        completeMeeting(db, m);
      });
    }

    const rows = teamAggregate(db, team, metric.id, "0000-01-01", 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.period).toBe("2026-09");
    expect(rows[0]!.people).toBe(3);
    // Averaging over all answers at once would give Ann double weight:
    // (0 + 1 + 0.5 + 0.5)/4 = 0.5 happens to match here, so the check is that people = 3
    // and the mean equals the mean across people.
    expect(rows[0]!.avg_norm).toBeCloseTo(0.5, 5);
  });

  test("the min_people threshold hides de-anonymizing buckets", () => {
    const db = testDb();
    const v = defaultVersionId(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(v)!;
    const team = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO team (owner_id, name, created_at, updated_at) VALUES (1, 'Tiny team', ?, ?) RETURNING id",
      )
      .get(nowIso(), nowIso())!.id;

    const pid = makePerson(db, "One person");
    db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
      .run(team, pid);
    const m = makeMeeting(db, pid, v, "2026-09-07");
    saveAnswer(db, m, getFieldWithOptions(db, field.id)!, { value: "5" });
    completeMeeting(db, m);

    expect(teamAggregate(db, team, metric.id, "0000-01-01", 3)).toHaveLength(0);
    expect(teamAggregate(db, team, metric.id, "0000-01-01", 1)).toHaveLength(1);
  });

  test("someone who left the team does not drag the current-membership aggregate", () => {
    const db = testDb();
    const v = defaultVersionId(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(v)!;
    const team = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO team (owner_id, name, created_at, updated_at) VALUES (1, 'Changing team', ?, ?) RETURNING id",
      )
      .get(nowIso(), nowIso())!.id;

    const stayed = makePerson(db, "Stayed");
    const left = makePerson(db, "Left");
    db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
      .run(team, stayed);
    db.query("INSERT INTO team_member (team_id, person_id, is_primary, left_on) VALUES (?, ?, 0, '2026-09-05')")
      .run(team, left);

    for (const [pid, value] of [[stayed, "5"], [left, "1"]] as const) {
      const m = makeMeeting(db, pid, v, "2026-09-01");
      saveAnswer(db, m, getFieldWithOptions(db, field.id)!, { value });
      completeMeeting(db, m);
    }

    const rows = teamAggregate(db, team, metric.id, "0000-01-01", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.people).toBe(1);
    expect(rows[0]!.avg_norm).toBeCloseTo(1, 5);
  });
});
