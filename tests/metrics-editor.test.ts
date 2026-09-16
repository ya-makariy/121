import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId } from "./helpers.ts";
import {
  assertValidKey, createMetric, metricHasData, metricIsReferenced, metricsWithUsage,
  moveMetric, removeMetric, reorderMetrics, restoreMetric, suggestKey, updateMetric,
} from "../src/domain/metrics-editor.ts";
import { addField, validateTemplate } from "../src/domain/template-editor.ts";
import { currentVersion } from "../src/domain/template-version.ts";
import { loadVersionStructure, getFieldWithOptions } from "../src/db/queries/templates.ts";
import { getMetricByKey, metricsWithAnyData, personTimeline } from "../src/db/queries/metrics.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { MetricEditError } from "../src/lib/errors.ts";

const TEMPLATE_ID = 1;

/**
 * A metric key is the identity of a measurement. Everything here defends that: renaming a
 * key would silently merge or break history, so once anything references it, it is fixed.
 */
describe("metrics editor", () => {
  test("a key is suggested from the label and transliterated", () => {
    expect(suggestKey("Goal clarity")).toBe("goal_clarity");
    // The Cyrillic input is written as escapes so this file stays ASCII, the same way the
    // language guard does it. "Yasnost celey" is the label a Russian-speaking author types.
    expect(suggestKey("\u042f\u0441\u043d\u043e\u0441\u0442\u044c \u0446\u0435\u043b\u0435\u0439"))
      .toBe("yasnost_celey");
    expect(suggestKey("Mood 2.0")).toBe("mood_2_0");
    // A key must start with a letter, so a leading digit gets a prefix.
    expect(suggestKey("1st week")).toBe("m_1st_week");
    expect(suggestKey("!!!")).toBe("metric");
  });

  test("an invalid key is refused with a code", () => {
    expect(() => assertValidKey("Bad Key")).toThrow(MetricEditError);
    expect(() => assertValidKey("1leading")).toThrow(/METRIC_KEY_INVALID/);
    expect(() => assertValidKey("x")).toThrow(/METRIC_KEY_INVALID/);
    expect(() => assertValidKey("ok_key_2")).not.toThrow();
  });

  test("a metric is created, and a duplicate key is refused", () => {
    const db = testDb();
    const created = createMetric(db, {
      key: "", label: "Focus", description: "How focused the work feels",
      kind: "scalar", direction: 1, displayOrder: 8,
    });
    expect(created.key).toBe("focus");
    expect(created.direction).toBe(1);

    expect(() => createMetric(db, {
      key: "focus", label: "Focus again", description: null,
      kind: "scalar", direction: 1, displayOrder: 9,
    })).toThrow(/METRIC_KEY_TAKEN/);
  });

  test("an unreferenced key can be renamed; a referenced one cannot", () => {
    const db = testDb();
    const metric = createMetric(db, {
      key: "typo_kee", label: "Typo", description: null,
      kind: "scalar", direction: 1, displayOrder: 8,
    });

    // Nothing points at it yet, so fixing the key is fine.
    const fixed = updateMetric(db, metric.id, {
      key: "typo_key", label: "Typo", description: null, direction: 1, displayOrder: 8,
    });
    expect(fixed.key).toBe("typo_key");

    // Bind it to a template field, and the key freezes.
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    addField(db, TEMPLATE_ID, section.section_key, {
      label: "Typo scale", helpText: null, type: "scale", visibility: "shared",
      isRequired: false, metricId: metric.id,
      scaleMin: 1, scaleMax: 5, scaleMinLabel: null, scaleMaxLabel: null,
    });
    expect(metricIsReferenced(db, metric.id)).toBe(true);

    expect(() => updateMetric(db, metric.id, {
      key: "another_key", label: "Typo", description: null, direction: 1, displayOrder: 8,
    })).toThrow(/METRIC_KEY_LOCKED/);

    // The label is still free to change: that is what rewording is for.
    const relabelled = updateMetric(db, metric.id, {
      key: "typo_key", label: "Renamed freely", description: null, direction: 1, displayOrder: 8,
    });
    expect(relabelled.label).toBe("Renamed freely");
  });

  test("direction can be corrected, which flips what counts as worse", () => {
    // Setting up a metric the wrong way round has to be fixable: it is an interpretation,
    // not data.
    const db = testDb();
    const workload = getMetricByKey(db, "workload")!;
    expect(workload.direction).toBe(-1);

    const flipped = updateMetric(db, workload.id, {
      key: workload.key, label: workload.label, description: workload.description,
      direction: 1, displayOrder: workload.display_order,
    });
    expect(flipped.direction).toBe(1);
    expect(flipped.key).toBe("workload");
  });

  test("an unreferenced metric is deleted; a referenced one is archived", () => {
    const db = testDb();
    const spare = createMetric(db, {
      key: "spare_metric", label: "Spare", description: null,
      kind: "scalar", direction: 1, displayOrder: 9,
    });
    expect(removeMetric(db, spare.id)).toBe("deleted");
    expect(getMetricByKey(db, "spare_metric")).toBeNull();

    const used = getMetricByKey(db, "energy")!;
    expect(removeMetric(db, used.id)).toBe("archived");
    const archived = getMetricByKey(db, "energy")!;
    expect(archived.archived_at).not.toBeNull();

    restoreMetric(db, used.id);
    expect(getMetricByKey(db, "energy")!.archived_at).toBeNull();
  });

  test("archiving a metric keeps the points already collected", () => {
    const db = testDb();
    const v = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v, "2026-09-07");
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'energy'",
      )
      .get(v)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { value: "4" });
    completeMeeting(db, meetingId);

    const energy = getMetricByKey(db, "energy")!;
    expect(metricHasData(db, energy.id)).toBe(true);
    removeMetric(db, energy.id);

    // The history stays queryable; the metric merely stops being offered.
    expect(personTimeline(db, personId, energy.id)).toHaveLength(1);
    expect(metricsWithAnyData(db).some((m) => m.key === "energy")).toBe(false);
  });

  test("usage shows where a metric is bound and how much data it has", () => {
    const db = testDb();
    const v = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v, "2026-09-07");
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(v)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { value: "4" });
    completeMeeting(db, meetingId);

    const usage = metricsWithUsage(db).find((m) => m.key === "job_satisfaction")!;
    expect(usage.referenced).toBe(true);
    expect(usage.field_count).toBeGreaterThanOrEqual(1);
    expect(usage.template_count).toBe(1);
    expect(usage.point_count).toBe(1);

    const unused = metricsWithUsage(db).find((m) => m.key === "team_relationships")!;
    expect(unused.point_count).toBe(0);
  });

  test("a categorical metric bound to a select needs weights on every option", () => {
    const db = testDb();
    const metric = createMetric(db, {
      key: "week_mood", label: "Mood for the week", description: null,
      kind: "categorical", direction: 1, displayOrder: 8,
    });
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    addField(db, TEMPLATE_ID, section.section_key, {
      label: "Mood for the week", helpText: null, type: "single_select", visibility: "shared",
      isRequired: false, metricId: metric.id,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const problems = validateTemplate(db, currentVersion(db, TEMPLATE_ID).id);
    expect(problems.some((p) => p.code === "METRIC_OPTIONS_WITHOUT_SCORE")).toBe(true);
  });

  test("an answer refuses an unweighted option rather than storing a hole", () => {
    // Better to fail while filling in the meeting than to draw a chart with a gap in it.
    const db = testDb();
    const v = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v, "2026-09-07");

    const metric = createMetric(db, {
      key: "unweighted", label: "Unweighted", description: null,
      kind: "categorical", direction: 1, displayOrder: 8,
    });
    const section = loadVersionStructure(db, v)[0]!;
    const { fieldKey } = addField(db, TEMPLATE_ID, section.section_key, {
      label: "Pick one", helpText: null, type: "single_select", visibility: "shared",
      isRequired: false, metricId: metric.id,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const field = db
      .query<{ id: number }, [string]>("SELECT id FROM template_field WHERE field_key = ?")
      .get(fieldKey)!;
    const withOptions = getFieldWithOptions(db, field.id)!;

    expect(() => saveAnswer(db, meetingId, withOptions, {
      optionKeys: [withOptions.options[0]!.option_key],
    })).toThrow(/ANSWER_OPTION_NEEDS_SCORE/);
  });

  // ---- order --------------------------------------------------------------------------
  // display_order is data (migration 0004) but never a number the user types: the list on
  // /metrics is reordered by dragging or with the arrows, and both ways renumber 1..n.

  const activeKeys = (db: ReturnType<typeof testDb>) =>
    metricsWithUsage(db).map((m) => m.key);

  test("the arrows swap a metric with its neighbour and stop at the ends", () => {
    const db = testDb();
    const before = activeKeys(db);
    const first = getMetricByKey(db, before[0]!)!;
    const second = getMetricByKey(db, before[1]!)!;

    moveMetric(db, second.id, "up");
    expect(activeKeys(db).slice(0, 2)).toEqual([second.key, first.key]);

    moveMetric(db, second.id, "up"); // already first: nothing happens
    expect(activeKeys(db).slice(0, 2)).toEqual([second.key, first.key]);

    moveMetric(db, second.id, "down");
    expect(activeKeys(db)).toEqual(before);

    // Positions are consecutive afterwards, whatever the seed used (it used 90 for one).
    const orders = metricsWithUsage(db).map((m) => m.display_order);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
  });

  test("dragging sends the whole order; keys left out keep their place after it", () => {
    const db = testDb();
    const keys = activeKeys(db);
    const reversed = [...keys].reverse();
    reorderMetrics(db, reversed);
    expect(activeKeys(db)).toEqual(reversed);

    // A partial list (a metric created in another tab, say) puts the listed ones first
    // and the rest after, in their previous relative order — nothing disappears.
    const [a, b, ...rest] = reversed;
    reorderMetrics(db, [b!, a!]);
    expect(activeKeys(db)).toEqual([b!, a!, ...rest]);
  });

  test("an archived metric is skipped by the arrows but keeps a place in the order", () => {
    const db = testDb();
    const keys = activeKeys(db);
    const middle = getMetricByKey(db, keys[1]!)!;
    // Reference it so removal archives instead of deleting.
    addField(db, TEMPLATE_ID, loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id)[0]!.section_key, {
      label: "Q", helpText: null, type: "scale", visibility: "shared", isRequired: false,
      metricId: middle.id, scaleMin: 1, scaleMax: 5, scaleMinLabel: null, scaleMaxLabel: null,
    });
    expect(removeMetric(db, middle.id)).toBe("archived");

    const first = getMetricByKey(db, keys[0]!)!;
    moveMetric(db, first.id, "down");
    // The first metric lands after the one that followed the archived gap, not in the gap.
    expect(activeKeys(db).slice(0, 2)).toEqual([keys[2]!, keys[0]!]);
    expect(metricsWithUsage(db, 1, true).map((m) => m.key)).toContain(middle.key);
  });
});
