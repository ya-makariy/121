import { describe, expect, test } from "bun:test";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId,
} from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions, loadVersionStructure } from "../src/db/queries/templates.ts";
import {
  currentVersion, diffVersions, draftHasNoAnswers, duplicateTemplate, ensureDraft,
  forkVersion, listVersions,
} from "../src/domain/template-version.ts";
import {
  addField, addOption, addSection, deleteField, deleteSection, moveField, reorderFields,
  updateField, updateOption, updateSection, validateTemplate,
} from "../src/domain/template-editor.ts";
import { getMetricByKey, personTimeline } from "../src/db/queries/metrics.ts";
import { TemplateEditError } from "../src/lib/errors.ts";

const TEMPLATE_ID = 1;

function fieldByKey(db: ReturnType<typeof testDb>, versionId: number, key: string) {
  return db
    .query<{ id: number; label: string; type: string; visibility: string; scale_max: number | null },
           [number, string]>(
      "SELECT id, label, type, visibility, scale_max FROM template_field WHERE version_id = ? AND field_key = ?",
    )
    .get(versionId, key);
}

/**
 * The guarantee the whole builder rests on: editing a template never rewrites meetings
 * that have already happened. See CLAUDE.md rule 5.
 */
describe("template versioning", () => {
  test("a draft is edited in place; no new version appears", () => {
    const db = testDb();
    const before = defaultVersionId(db);

    addSection(db, TEMPLATE_ID, "A new section", null);
    addSection(db, TEMPLATE_ID, "And another", null);

    expect(currentVersion(db, TEMPLATE_ID).id).toBe(before);
    expect(listVersions(db, TEMPLATE_ID)).toHaveLength(1);
  });

  test("a meeting freezes the version, and the next edit forks it", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);

    makeMeeting(db, personId, v1, "2026-09-07");
    expect(currentVersion(db, TEMPLATE_ID).frozen_at).not.toBeNull();

    addSection(db, TEMPLATE_ID, "Added after the meeting", null);

    const v2 = currentVersion(db, TEMPLATE_ID);
    expect(v2.id).not.toBe(v1);
    expect(v2.version_no).toBe(2);
    expect(v2.parent_version_id).toBe(v1);
    expect(v2.frozen_at).toBeNull();
    expect(v2.change_note).toContain("Added after the meeting");
  });

  test("a fork preserves every stable key, and options keep their weights", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    makeMeeting(db, personId, v1, "2026-09-07");

    const v2 = ensureDraft(db, TEMPLATE_ID);

    const keysOf = (versionId: number, table: string, column: string, join: string) =>
      db.query<{ k: string }, [number]>(
        `SELECT ${column} AS k FROM ${table} ${join} WHERE version_id = ? ORDER BY k`,
      ).all(versionId).map((r) => r.k);

    expect(keysOf(v2, "template_section", "section_key", ""))
      .toEqual(keysOf(v1, "template_section", "section_key", ""));
    expect(keysOf(v2, "template_field", "field_key", ""))
      .toEqual(keysOf(v1, "template_field", "field_key", ""));

    const options = (versionId: number) =>
      db.query<{ option_key: string; score: number | null }, [number]>(
        `SELECT o.option_key, o.score FROM template_field_option o
         JOIN template_field f ON f.id = o.field_id
         WHERE f.version_id = ? ORDER BY o.option_key`,
      ).all(versionId);
    expect(options(v2)).toEqual(options(v1));
  });

  test("a completed meeting keeps its old interpretation after the template changes", () => {
    // This is the point of the whole design: a scale answered as 4 out of 5 must not
    // silently become 4 out of 10 because the template was later widened.
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v1, "2026-07-01");

    const original = fieldByKey(db, v1, "job_satisfaction")!;
    const originalLabel = original.label; // captured, not hardcoded: the seed may be reworded
    saveAnswer(db, meetingId, getFieldWithOptions(db, original.id)!, { value: "4" });
    completeMeeting(db, meetingId);

    // Widen the scale and reword the question in what becomes version 2.
    updateField(db, TEMPLATE_ID, "job_satisfaction", {
      label: "How is work treating you now",
      helpText: null, type: "scale", visibility: "shared", isRequired: false,
      metricId: getMetricByKey(db, "job_satisfaction")!.id,
      scaleMin: 1, scaleMax: 10, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const v2 = currentVersion(db, TEMPLATE_ID).id;
    expect(v2).not.toBe(v1);

    // The old version is untouched.
    const oldField = fieldByKey(db, v1, "job_satisfaction")!;
    expect(oldField.scale_max).toBe(5);
    expect(oldField.label).toBe(originalLabel);

    // The answer still points at the old field, so it still means 4 out of 5.
    const answer = db
      .query<{ field_id: number; num_value: number | null }, [number]>(
        "SELECT field_id, num_value FROM meeting_answer WHERE meeting_id = ?",
      )
      .get(meetingId)!;
    expect(answer.field_id).toBe(original.id);
    expect(answer.num_value).toBe(4);

    // And the chart still normalizes it against the scale it was answered on.
    const points = personTimeline(db, personId, getMetricByKey(db, "job_satisfaction")!.id);
    expect(points).toHaveLength(1);
    expect(points[0]!.norm_value).toBeCloseTo(0.75, 5);
  });

  test("rewording keeps the series; the different-question toggle breaks it", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    makeMeeting(db, personId, v1, "2026-09-07");

    const input = {
      helpText: null, type: "scale" as const, visibility: "shared" as const, isRequired: false,
      metricId: null, scaleMin: 1, scaleMax: 5, scaleMinLabel: null, scaleMaxLabel: null,
    };

    const reworded = updateField(db, TEMPLATE_ID, "energy", { ...input, label: "Energy now" });
    expect(reworded.fieldKey).toBe("energy");

    const replaced = updateField(db, TEMPLATE_ID, "energy", {
      ...input, label: "Do you have anything left in the tank",
    }, { newQuestion: true });
    expect(replaced.fieldKey).not.toBe("energy");

    // The old key is gone from the current version but still lives in the frozen one.
    expect(fieldByKey(db, currentVersion(db, TEMPLATE_ID).id, "energy")).toBeNull();
    expect(fieldByKey(db, v1, "energy")).not.toBeNull();
  });

  test("a draft never has answers, which is why editing it is safe", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v1, "2026-09-07");
    const field = fieldByKey(db, v1, "growth_notes")!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { value: "a note" });

    expect(draftHasNoAnswers(db, v1)).toBe(false);
    const v2 = ensureDraft(db, TEMPLATE_ID);
    expect(draftHasNoAnswers(db, v2)).toBe(true);
  });

  test("deleting a question in a draft leaves past answers alone", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, v1, "2026-09-07");
    const field = fieldByKey(db, v1, "growth_notes")!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { value: "keep me" });
    completeMeeting(db, meetingId);

    deleteField(db, TEMPLATE_ID, "growth_notes");

    expect(fieldByKey(db, currentVersion(db, TEMPLATE_ID).id, "growth_notes")).toBeNull();
    const answer = db
      .query<{ text_value: string | null }, [number]>(
        "SELECT text_value FROM meeting_answer WHERE meeting_id = ?",
      )
      .get(meetingId)!;
    expect(answer.text_value).toBe("keep me");
  });

  test("deleting a section takes its fields and renumbers the rest", () => {
    const db = testDb();
    const before = loadVersionStructure(db, defaultVersionId(db));
    const victim = before[1]!;

    deleteSection(db, TEMPLATE_ID, victim.section_key);

    const after = loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id);
    expect(after).toHaveLength(before.length - 1);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i + 1));
    expect(after.some((s) => s.section_key === victim.section_key)).toBe(false);
  });

  test("reordering assigns consecutive positions and can move a field between sections", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const sections = loadVersionStructure(db, versionId);
    const pulse = sections.find((s) => s.fields.length > 2)!;
    const reversed = [...pulse.fields].reverse().map((f) => f.field_key);

    reorderFields(db, TEMPLATE_ID, pulse.section_key, reversed);

    const afterSections = loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id);
    const afterPulse = afterSections.find((s) => s.section_key === pulse.section_key)!;
    expect(afterPulse.fields.map((f) => f.field_key)).toEqual(reversed);
    expect(afterPulse.fields.map((f) => f.position)).toEqual(reversed.map((_, i) => i + 1));

    // Moving a question into a different section keeps it, and only once.
    const other = afterSections.find((s) => s.section_key !== pulse.section_key)!;
    const moved = reversed[0]!;
    reorderFields(db, TEMPLATE_ID, other.section_key, [...other.fields.map((f) => f.field_key), moved]);

    const final = loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id);
    const occurrences = final.flatMap((s) => s.fields).filter((f) => f.field_key === moved);
    expect(occurrences).toHaveLength(1);
    expect(final.find((s) => s.section_key === other.section_key)!.fields.map((f) => f.field_key))
      .toContain(moved);
  });

  test("moving a field up and down stays inside its section", () => {
    const db = testDb();
    const sections = loadVersionStructure(db, defaultVersionId(db));
    const section = sections.find((s) => s.fields.length >= 2)!;
    const [first, second] = section.fields;

    moveField(db, TEMPLATE_ID, second!.field_key, "up");
    let after = loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id)
      .find((s) => s.section_key === section.section_key)!;
    expect(after.fields[0]!.field_key).toBe(second!.field_key);

    // Moving the topmost field up is a no-op rather than an error.
    moveField(db, TEMPLATE_ID, second!.field_key, "up");
    after = loadVersionStructure(db, currentVersion(db, TEMPLATE_ID).id)
      .find((s) => s.section_key === section.section_key)!;
    expect(after.fields[0]!.field_key).toBe(second!.field_key);
    expect(after.fields[1]!.field_key).toBe(first!.field_key);
  });

  test("editing something that is not there fails with a code, not a crash", () => {
    const db = testDb();
    expect(() => updateSection(db, TEMPLATE_ID, "no_such_section", { title: "x", description: null }))
      .toThrow(TemplateEditError);
    expect(() => deleteField(db, TEMPLATE_ID, "no_such_field")).toThrow(/FIELD_NOT_FOUND/);
  });

  test("an invalid scale is refused", () => {
    const db = testDb();
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    const base = {
      label: "Bad scale", helpText: null, type: "scale" as const,
      visibility: "shared" as const, isRequired: false, metricId: null,
      scaleMinLabel: null, scaleMaxLabel: null,
    };
    expect(() => addField(db, TEMPLATE_ID, section.section_key, { ...base, scaleMin: 5, scaleMax: 5 }))
      .toThrow(/SCALE_INVALID/);
    expect(() => addField(db, TEMPLATE_ID, section.section_key, { ...base, scaleMin: 0, scaleMax: 90 }))
      .toThrow(/SCALE_TOO_LONG/);
  });

  test("a metric binding is dropped for types that cannot carry one", () => {
    const db = testDb();
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    const { fieldKey } = addField(db, TEMPLATE_ID, section.section_key, {
      label: "Just prose", helpText: null, type: "text", visibility: "shared",
      isRequired: false, metricId: getMetricByKey(db, "energy")!.id,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const row = db
      .query<{ metric_id: number | null; scale_min: number | null }, [string]>(
        "SELECT metric_id, scale_min FROM template_field WHERE field_key = ?",
      )
      .get(fieldKey)!;
    expect(row.metric_id).toBeNull();
    expect(row.scale_min).toBeNull();
  });

  test("switching away from a select clears its options only in the new version", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    makeMeeting(db, personId, v1, "2026-09-07"); // freezes v1, so the edit will fork

    const optionCount = (versionId: number) =>
      db.query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM template_field_option o
         JOIN template_field f ON f.id = o.field_id
         WHERE f.version_id = ? AND f.field_key = 'attrition_risk'`,
      ).get(versionId)!.n;

    expect(optionCount(v1)).toBe(3);

    updateField(db, TEMPLATE_ID, "attrition_risk", {
      label: "Attrition risk, in words", helpText: null, type: "text", visibility: "private",
      isRequired: false, metricId: null,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const v2 = currentVersion(db, TEMPLATE_ID).id;
    expect(v2).not.toBe(v1);
    expect(optionCount(v2)).toBe(0);
    // The frozen version keeps them, because history is not rewritten.
    expect(optionCount(v1)).toBe(3);
  });

  test("the diff reports rewording, rebinding and a visibility change separately", () => {
    const db = testDb();
    const v1 = defaultVersionId(db);
    const personId = makePerson(db);
    makeMeeting(db, personId, v1, "2026-09-07");

    updateField(db, TEMPLATE_ID, "growth_notes", {
      label: "Growth: what we agreed", helpText: null, type: "text",
      visibility: "private", isRequired: false, metricId: null,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });
    const v2 = currentVersion(db, TEMPLATE_ID).id;

    const diff = diffVersions(db, v1, v2);
    const kinds = diff.changes.filter((c) => c.fieldKey === "growth_notes").map((c) => c.kind);
    expect(kinds).toContain("relabelled");
    expect(kinds).toContain("visibility");

    const visibilityChange = diff.changes.find(
      (c) => c.fieldKey === "growth_notes" && c.kind === "visibility",
    )!;
    expect(visibilityChange.from).toBe("shared");
    expect(visibilityChange.to).toBe("private");
  });

  test("duplicating a template copies its structure into a fresh draft", () => {
    const db = testDb();
    const source = defaultVersionId(db);
    const copy = duplicateTemplate(db, TEMPLATE_ID, "A copy");

    expect(copy.id).not.toBe(TEMPLATE_ID);
    expect(copy.is_default).toBe(0);

    const copyVersion = currentVersion(db, copy.id);
    expect(copyVersion.frozen_at).toBeNull();
    expect(copyVersion.version_no).toBe(1);

    const count = (versionId: number, table: string) =>
      db.query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE version_id = ?`,
      ).get(versionId)!.n;
    expect(count(copyVersion.id, "template_section")).toBe(count(source, "template_section"));
    expect(count(copyVersion.id, "template_field")).toBe(count(source, "template_field"));
  });

  test("forking a version that does not exist fails with a code", () => {
    const db = testDb();
    expect(() => forkVersion(db, 9999, null)).toThrow(/VERSION_NOT_FOUND/);
  });
});

describe("template check", () => {
  test("a metric-bound select without weights is an error", () => {
    const db = testDb();
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    const { fieldKey } = addField(db, TEMPLATE_ID, section.section_key, {
      label: "Mood this week", helpText: null, type: "single_select", visibility: "shared",
      isRequired: false, metricId: getMetricByKey(db, "attrition_risk")!.id,
      scaleMin: null, scaleMax: null, scaleMinLabel: null, scaleMaxLabel: null,
    });

    let problems = validateTemplate(db, currentVersion(db, TEMPLATE_ID).id);
    expect(problems.some((p) => p.code === "METRIC_OPTIONS_WITHOUT_SCORE")).toBe(true);

    // The seeded placeholders have no weight; giving them one through the real editor
    // API clears the error.
    const options = db
      .query<{ option_key: string; label: string }, [string]>(
        `SELECT o.option_key, o.label FROM template_field_option o
         JOIN template_field f ON f.id = o.field_id WHERE f.field_key = ?
         ORDER BY o.position`,
      )
      .all(fieldKey);
    options.forEach((o, i) => {
      updateOption(db, TEMPLATE_ID, fieldKey, o.option_key, {
        label: o.label, score: i === 0 ? 0 : 1, color: null,
      });
    });
    addOption(db, TEMPLATE_ID, fieldKey, { label: "Great", score: 1, color: null });

    problems = validateTemplate(db, currentVersion(db, TEMPLATE_ID).id);
    expect(problems.some((p) => p.code === "METRIC_OPTIONS_WITHOUT_SCORE")).toBe(false);
  });

  test("two questions bound to one metric is a warning", () => {
    const db = testDb();
    const section = loadVersionStructure(db, defaultVersionId(db))[0]!;
    addField(db, TEMPLATE_ID, section.section_key, {
      label: "Energy, again", helpText: null, type: "scale", visibility: "shared",
      isRequired: false, metricId: getMetricByKey(db, "energy")!.id,
      scaleMin: 1, scaleMax: 5, scaleMinLabel: null, scaleMaxLabel: null,
    });

    const problems = validateTemplate(db, currentVersion(db, TEMPLATE_ID).id);
    const dup = problems.find((p) => p.code === "DUPLICATE_METRIC_BINDING")!;
    expect(dup.level).toBe("warning");
    expect(dup.params.count).toBe(2);
  });

  test("an empty section is information, not an error", () => {
    const db = testDb();
    addSection(db, TEMPLATE_ID, "Nothing here yet", null);
    const problems = validateTemplate(db, currentVersion(db, TEMPLATE_ID).id);
    const empty = problems.find((p) => p.code === "EMPTY_SECTION")!;
    expect(empty.level).toBe("info");
    expect(empty.params.title).toBe("Nothing here yet");
  });

  test("the seeded starter template has no errors out of the box", () => {
    // Whatever else changes, a fresh install must be usable without fixing anything.
    const db = testDb();
    const problems = validateTemplate(db, defaultVersionId(db));
    expect(problems.filter((p) => p.level === "error")).toEqual([]);
  });
});
