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
import { plural } from "../src/i18n/index.ts";

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

describe("сравнение людей", () => {
  test("порядок «кому уделить внимание» зависит от направления метрики", () => {
    const db = testDb();
    seedPerson(db, "Довольный", "job_satisfaction", [["2026-08-01", "5"], ["2026-09-01", "5"]]);
    seedPerson(db, "Недовольный", "job_satisfaction", [["2026-08-01", "3"], ["2026-09-01", "2"]]);
    seedPerson(db, "Средний", "job_satisfaction", [["2026-09-01", "4"]]);

    const metric = getMetricByKey(db, "job_satisfaction")!;
    const rows = standings(db, metric.id, null);

    // direction = 1: меньше — хуже, худшие сверху.
    const up = sortByAttention(rows, 1).map((r) => r.full_name);
    expect(up[0]).toBe("Недовольный");
    expect(up.at(-1)).toBe("Довольный");

    // direction = -1 (нагрузка, риск ухода): больше — хуже, порядок разворачивается.
    const down = sortByAttention(rows, -1).map((r) => r.full_name);
    expect(down[0]).toBe("Довольный");
    expect(down.at(-1)).toBe("Недовольный");
  });

  test("предыдущее значение подтягивается рядом с последним", () => {
    const db = testDb();
    const personId = seedPerson(db, "Кто-то", "job_satisfaction", [
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

  test("человек с одной точкой не даёт ложного изменения", () => {
    const db = testDb();
    seedPerson(db, "Новичок", "job_satisfaction", [["2026-09-01", "3"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const row = standings(db, metric.id, null)[0]!;
    expect(row.n).toBe(1);
    expect(row.prev_norm).toBeNull();
  });

  test("две встречи одного человека за месяц не дают двойной вес в сравнении", () => {
    const db = testDb();
    seedPerson(db, "Дважды", "job_satisfaction", [["2026-09-03", "1"], ["2026-09-20", "5"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;

    const rows = compareByPeriod(db, metric.id, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.period).toBe("2026-09");
    expect(rows[0]!.n).toBe(2);
    expect(rows[0]!.avg_raw).toBe(3); // одна точка на человека в месяце, а не две
  });

  test("фильтр по команде исключает тех, кто в неё не входит", () => {
    const db = testDb();
    const inTeam = seedPerson(db, "В команде", "job_satisfaction", [["2026-09-01", "5"]]);
    seedPerson(db, "Вне команды", "job_satisfaction", [["2026-09-01", "1"]]);

    const team = db
      .query<{ id: number }, [string, string]>(
        "INSERT INTO team (owner_id, name, created_at, updated_at) VALUES (1, 'Т', ?, ?) RETURNING id",
      )
      .get(nowIso(), nowIso())!.id;
    db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
      .run(team, inTeam);

    const metric = getMetricByKey(db, "job_satisfaction")!;
    expect(standings(db, metric.id, null)).toHaveLength(2);
    const scoped = standings(db, metric.id, team);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.full_name).toBe("В команде");
  });

  test("архивированный человек исчезает из сравнения", () => {
    const db = testDb();
    const personId = seedPerson(db, "Ушедший", "job_satisfaction", [["2026-09-01", "3"]]);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    expect(standings(db, metric.id, null)).toHaveLength(1);

    db.query("UPDATE person SET archived_at = ? WHERE id = ?").run(nowIso(), personId);
    expect(standings(db, metric.id, null)).toHaveLength(0);
    expect(compareByPeriod(db, metric.id, null)).toHaveLength(0);
  });

  test("приватная метрика не открывается первым экраном сравнения", () => {
    // Первое, что видит руководитель, не должно быть оценкой риска ухода.
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

describe("склонения", () => {
  test("русские формы для «точка»", () => {
    const forms = ["точка", "точки", "точек"] as const;
    expect(plural("ru", 1, forms)).toBe("1 точка");
    expect(plural("ru", 2, forms)).toBe("2 точки");
    expect(plural("ru", 5, forms)).toBe("5 точек");
    expect(plural("ru", 11, forms)).toBe("11 точек");
    expect(plural("ru", 21, forms)).toBe("21 точка");
    expect(plural("ru", 22, forms)).toBe("22 точки");
    expect(plural("ru", 105, forms)).toBe("105 точек");
  });

  test("английские формы", () => {
    const forms = ["point", "points"] as const;
    expect(plural("en", 1, forms)).toBe("1 point");
    expect(plural("en", 2, forms)).toBe("2 points");
    expect(plural("en", 21, forms)).toBe("21 points");
  });
});
