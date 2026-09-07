import type { Database } from "bun:sqlite";
import type { FieldType, Visibility } from "../db/types.ts";
import { nowIso } from "../lib/dates.ts";
import {
  answerCountForFieldKey, ensureDraft, mintFieldKey, mintOptionKey, mintSectionKey,
} from "./template-version.ts";
import { TemplateEditError } from "../lib/errors.ts";

/**
 * Template builder operations.
 *
 * Every operation starts with ensureDraft(): if meetings already used the current version,
 * the edit lands in a fork. That is why deleting a field or changing its type inside a
 * draft is safe — completed meetings hold on to the fields of their own frozen version.
 *
 * Everything is addressed by key (section_key / field_key / option_key), never by id:
 * after a fork the ids change and the keys do not. This removes old-id-to-new-id mapping
 * from the design entirely.
 */

const FIELD_TYPES: FieldType[] = [
  "scale", "text", "short_text", "checkbox", "single_select", "multi_select", "date",
];
const SELECT_TYPES: FieldType[] = ["single_select", "multi_select"];
const METRIC_TYPES: FieldType[] = ["scale", "single_select", "multi_select", "checkbox"];

export function isFieldType(v: string): v is FieldType {
  return (FIELD_TYPES as string[]).includes(v);
}

function touchTemplate(db: Database, templateId: number): void {
  db.query("UPDATE template SET updated_at = ? WHERE id = ?").run(nowIso(), templateId);
}

function sectionByKey(db: Database, versionId: number, key: string): { id: number; position: number } {
  const row = db
    .query<{ id: number; position: number }, [number, string]>(
      "SELECT id, position FROM template_section WHERE version_id = ? AND section_key = ?",
    )
    .get(versionId, key);
  if (!row) throw new TemplateEditError("SECTION_NOT_FOUND", { section: key });
  return row;
}

function fieldByKey(
  db: Database, versionId: number, key: string,
): { id: number; section_id: number; position: number; type: FieldType; metric_id: number | null } {
  const row = db
    .query<
      { id: number; section_id: number; position: number; type: FieldType; metric_id: number | null },
      [number, string]
    >(
      "SELECT id, section_id, position, type, metric_id FROM template_field WHERE version_id = ? AND field_key = ?",
    )
    .get(versionId, key);
  if (!row) throw new TemplateEditError("FIELD_NOT_FOUND", { field: key });
  return row;
}

// ─────────────────────────────────────────────────────────── sections

export function addSection(
  db: Database, templateId: number, title: string, description: string | null,
): number {
  const trimmed = title.trim();
  if (trimmed === "") throw new TemplateEditError("SECTION_TITLE_REQUIRED");

  const versionId = ensureDraft(db, templateId, `Added section "${trimmed}"`);
  const next = db
    .query<{ n: number }, [number]>(
      "SELECT COALESCE(MAX(position), 0) + 1 AS n FROM template_section WHERE version_id = ?",
    )
    .get(versionId)!.n;

  db.query(
    `INSERT INTO template_section (version_id, section_key, title, description, position)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(versionId, mintSectionKey(trimmed), trimmed, description, next);

  touchTemplate(db, templateId);
  return versionId;
}

export function updateSection(
  db: Database, templateId: number, sectionKey: string,
  patch: { title: string; description: string | null },
): number {
  const trimmed = patch.title.trim();
  if (trimmed === "") throw new TemplateEditError("SECTION_TITLE_REQUIRED");

  const versionId = ensureDraft(db, templateId, `Changed section "${trimmed}"`);
  const section = sectionByKey(db, versionId, sectionKey);
  db.query("UPDATE template_section SET title = ?, description = ? WHERE id = ?")
    .run(trimmed, patch.description, section.id);

  touchTemplate(db, templateId);
  return versionId;
}

export function deleteSection(db: Database, templateId: number, sectionKey: string): number {
  const versionId = ensureDraft(db, templateId, "Deleted a section");
  const section = sectionByKey(db, versionId, sectionKey);
  // The section's fields go with it via ON DELETE CASCADE. Inside a draft that is safe:
  // answers from past meetings hang off fields of frozen versions.
  db.query("DELETE FROM template_section WHERE id = ?").run(section.id);
  normalizeSectionPositions(db, versionId);

  touchTemplate(db, templateId);
  return versionId;
}

function normalizeSectionPositions(db: Database, versionId: number): void {
  const rows = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM template_section WHERE version_id = ? ORDER BY position, id",
    )
    .all(versionId);
  const upd = db.query("UPDATE template_section SET position = ? WHERE id = ?");
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

function normalizeFieldPositions(db: Database, sectionId: number): void {
  const rows = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM template_field WHERE section_id = ? ORDER BY position, id",
    )
    .all(sectionId);
  const upd = db.query("UPDATE template_field SET position = ? WHERE id = ?");
  rows.forEach((r, i) => upd.run(i + 1, r.id));
}

export function moveSection(
  db: Database, templateId: number, sectionKey: string, direction: "up" | "down",
): number {
  const versionId = ensureDraft(db, templateId, "Reordered sections");
  normalizeSectionPositions(db, versionId);
  const section = sectionByKey(db, versionId, sectionKey);

  const neighbour = db
    .query<{ id: number; position: number }, [number, number]>(
      direction === "up"
        ? `SELECT id, position FROM template_section
           WHERE version_id = ? AND position < ? ORDER BY position DESC LIMIT 1`
        : `SELECT id, position FROM template_section
           WHERE version_id = ? AND position > ? ORDER BY position LIMIT 1`,
    )
    .get(versionId, section.position);
  if (!neighbour) return versionId;

  db.query("UPDATE template_section SET position = ? WHERE id = ?").run(neighbour.position, section.id);
  db.query("UPDATE template_section SET position = ? WHERE id = ?").run(section.position, neighbour.id);

  touchTemplate(db, templateId);
  return versionId;
}

/** A whole ordering — this is what dragging sends. */
export function reorderSections(db: Database, templateId: number, keys: string[]): number {
  const versionId = ensureDraft(db, templateId, "Reordered sections");
  const upd = db.query("UPDATE template_section SET position = ? WHERE version_id = ? AND section_key = ?");
  keys.forEach((key, i) => upd.run(i + 1, versionId, key));
  normalizeSectionPositions(db, versionId);
  touchTemplate(db, templateId);
  return versionId;
}

// ─────────────────────────────────────────────────────────── fields

export interface FieldInput {
  label: string;
  helpText: string | null;
  type: FieldType;
  visibility: Visibility;
  isRequired: boolean;
  metricId: number | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
}

/** Coerces input to what the schema allows: irrelevant columns nulled, scale filled in. */
function normalizeFieldInput(input: FieldInput): FieldInput {
  const isScale = input.type === "scale";
  const canBindMetric = METRIC_TYPES.includes(input.type);
  return {
    ...input,
    label: input.label.trim(),
    // A metric binds only to a measurable type; anything else is just a note.
    metricId: canBindMetric ? input.metricId : null,
    scaleMin: isScale ? (input.scaleMin ?? 1) : null,
    scaleMax: isScale ? (input.scaleMax ?? 5) : null,
    scaleMinLabel: isScale ? input.scaleMinLabel : null,
    scaleMaxLabel: isScale ? input.scaleMaxLabel : null,
  };
}

function assertValidField(input: FieldInput): void {
  if (input.label === "") throw new TemplateEditError("FIELD_LABEL_REQUIRED");
  if (input.type === "scale") {
    if (input.scaleMin === null || input.scaleMax === null || input.scaleMax <= input.scaleMin) {
      throw new TemplateEditError("SCALE_INVALID");
    }
    if (input.scaleMax - input.scaleMin > 20) {
      throw new TemplateEditError("SCALE_TOO_LONG");
    }
  }
}

/** Placeholder labels for a fresh select field; the route passes localized ones. */
const DEFAULT_OPTION_LABELS = ["Option 1", "Option 2"];

export function addField(
  db: Database, templateId: number, sectionKey: string, input: FieldInput,
  optionLabels: string[] = DEFAULT_OPTION_LABELS,
): { versionId: number; fieldKey: string } {
  const normalized = normalizeFieldInput(input);
  assertValidField(normalized);

  const versionId = ensureDraft(db, templateId, `Added question "${normalized.label}"`);
  const section = sectionByKey(db, versionId, sectionKey);
  const next = db
    .query<{ n: number }, [number]>(
      "SELECT COALESCE(MAX(position), 0) + 1 AS n FROM template_field WHERE section_id = ?",
    )
    .get(section.id)!.n;

  const fieldKey = mintFieldKey(normalized.label);
  db.query(
    `INSERT INTO template_field
       (version_id, section_id, field_key, label, help_text, type, visibility, is_required,
        position, metric_id, scale_min, scale_max, scale_min_label, scale_max_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    versionId, section.id, fieldKey, normalized.label, normalized.helpText, normalized.type,
    normalized.visibility, normalized.isRequired ? 1 : 0, next, normalized.metricId,
    normalized.scaleMin, normalized.scaleMax, normalized.scaleMinLabel, normalized.scaleMaxLabel,
  );

  // A select field with no options has nothing to pick: seed placeholders.
  if (SELECT_TYPES.includes(normalized.type)) {
    const field = fieldByKey(db, versionId, fieldKey);
    seedOptions(db, field.id, optionLabels);
  }

  touchTemplate(db, templateId);
  return { versionId, fieldKey };
}

/**
 * Editing a field. `newQuestion` is the explicit "this is a different question" toggle:
 * the schema cannot tell a typo fix from a change of meaning, so it asks. A fresh
 * field_key breaks the series on purpose.
 */
function seedOptions(db: Database, fieldId: number, labels: string[]): void {
  const ins = db.query(
    "INSERT INTO template_field_option (field_id, option_key, label, score, position) VALUES (?, ?, ?, ?, ?)",
  );
  labels.forEach((label, i) => ins.run(fieldId, mintOptionKey(label), label, null, i + 1));
}

export function updateField(
  db: Database, templateId: number, fieldKey: string, input: FieldInput,
  options: { newQuestion?: boolean; optionLabels?: string[] } = {},
): { versionId: number; fieldKey: string } {
  const normalized = normalizeFieldInput(input);
  assertValidField(normalized);

  const versionId = ensureDraft(db, templateId, `Changed question "${normalized.label}"`);
  const field = fieldByKey(db, versionId, fieldKey);
  const nextKey = options.newQuestion ? mintFieldKey(normalized.label) : fieldKey;

  db.query(
    `UPDATE template_field SET
       field_key = ?, label = ?, help_text = ?, type = ?, visibility = ?, is_required = ?,
       metric_id = ?, scale_min = ?, scale_max = ?, scale_min_label = ?, scale_max_label = ?
     WHERE id = ?`,
  ).run(
    nextKey, normalized.label, normalized.helpText, normalized.type, normalized.visibility,
    normalized.isRequired ? 1 : 0, normalized.metricId, normalized.scaleMin, normalized.scaleMax,
    normalized.scaleMinLabel, normalized.scaleMaxLabel, field.id,
  );

  // Switching to a non-select type would leave dangling options behind.
  if (!SELECT_TYPES.includes(normalized.type)) {
    db.query("DELETE FROM template_field_option WHERE field_id = ?").run(field.id);
  } else {
    const count = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM template_field_option WHERE field_id = ?",
      )
      .get(field.id)!.n;
    if (count === 0) seedOptions(db, field.id, options.optionLabels ?? DEFAULT_OPTION_LABELS);
  }

  touchTemplate(db, templateId);
  return { versionId, fieldKey: nextKey };
}

export function deleteField(db: Database, templateId: number, fieldKey: string): number {
  const versionId = ensureDraft(db, templateId, "Deleted a question");
  const field = fieldByKey(db, versionId, fieldKey);
  db.query("DELETE FROM template_field WHERE id = ?").run(field.id);
  normalizeFieldPositions(db, field.section_id);
  touchTemplate(db, templateId);
  return versionId;
}

export function moveField(
  db: Database, templateId: number, fieldKey: string, direction: "up" | "down",
): number {
  const versionId = ensureDraft(db, templateId, "Reordered questions");
  const field = fieldByKey(db, versionId, fieldKey);
  normalizeFieldPositions(db, field.section_id);
  const fresh = fieldByKey(db, versionId, fieldKey);

  const neighbour = db
    .query<{ id: number; position: number }, [number, number]>(
      direction === "up"
        ? `SELECT id, position FROM template_field
           WHERE section_id = ? AND position < ? ORDER BY position DESC LIMIT 1`
        : `SELECT id, position FROM template_field
           WHERE section_id = ? AND position > ? ORDER BY position LIMIT 1`,
    )
    .get(fresh.section_id, fresh.position);
  if (!neighbour) return versionId;

  db.query("UPDATE template_field SET position = ? WHERE id = ?").run(neighbour.position, fresh.id);
  db.query("UPDATE template_field SET position = ? WHERE id = ?").run(fresh.position, neighbour.id);

  touchTemplate(db, templateId);
  return versionId;
}

/** Dragging within and between sections: the target section and the ordering arrive. */
export function reorderFields(
  db: Database, templateId: number, sectionKey: string, fieldKeys: string[],
): number {
  const versionId = ensureDraft(db, templateId, "Reordered questions");
  const section = sectionByKey(db, versionId, sectionKey);
  const upd = db.query(
    "UPDATE template_field SET section_id = ?, position = ? WHERE version_id = ? AND field_key = ?",
  );
  fieldKeys.forEach((key, i) => upd.run(section.id, i + 1, versionId, key));
  touchTemplate(db, templateId);
  return versionId;
}

// ─────────────────────────────────────────────────────────── options

export function addOption(
  db: Database, templateId: number, fieldKey: string,
  input: { label: string; score: number | null; color: string | null },
): number {
  const label = input.label.trim();
  if (label === "") throw new TemplateEditError("OPTION_LABEL_REQUIRED");

  const versionId = ensureDraft(db, templateId, `Added option "${label}"`);
  const field = fieldByKey(db, versionId, fieldKey);
  if (!SELECT_TYPES.includes(field.type)) {
    throw new TemplateEditError("OPTIONS_ONLY_FOR_SELECT");
  }
  const next = db
    .query<{ n: number }, [number]>(
      "SELECT COALESCE(MAX(position), 0) + 1 AS n FROM template_field_option WHERE field_id = ?",
    )
    .get(field.id)!.n;

  db.query(
    "INSERT INTO template_field_option (field_id, option_key, label, score, color, position) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(field.id, mintOptionKey(label), label, input.score, input.color, next);

  touchTemplate(db, templateId);
  return versionId;
}

export function updateOption(
  db: Database, templateId: number, fieldKey: string, optionKey: string,
  input: { label: string; score: number | null; color: string | null },
): number {
  const label = input.label.trim();
  if (label === "") throw new TemplateEditError("OPTION_LABEL_REQUIRED");

  const versionId = ensureDraft(db, templateId, `Changed option "${label}"`);
  const field = fieldByKey(db, versionId, fieldKey);
  db.query(
    "UPDATE template_field_option SET label = ?, score = ?, color = ? WHERE field_id = ? AND option_key = ?",
  ).run(label, input.score, input.color, field.id, optionKey);

  touchTemplate(db, templateId);
  return versionId;
}

export function deleteOption(
  db: Database, templateId: number, fieldKey: string, optionKey: string,
): number {
  const versionId = ensureDraft(db, templateId, "Deleted an option");
  const field = fieldByKey(db, versionId, fieldKey);
  db.query("DELETE FROM template_field_option WHERE field_id = ? AND option_key = ?")
    .run(field.id, optionKey);
  touchTemplate(db, templateId);
  return versionId;
}

// ─────────────────────────────────────────────────────────── template check

export type ProblemLevel = "error" | "warning" | "info";

export interface TemplateProblem {
  level: ProblemLevel;
  code: string;
  params: Record<string, string | number>;
  fieldKey?: string;
}

/**
 * A check run before data starts being collected with this template. The point is to catch
 * problems here rather than when a chart is drawn or a meeting is being filled in.
 *
 * Problems carry a code and parameters; the wording lives in the dictionaries
 * (CLAUDE.md rule 1).
 */
export function validateTemplate(db: Database, versionId: number): TemplateProblem[] {
  const problems: TemplateProblem[] = [];

  const sections = db
    .query<{ id: number; title: string; fields: number }, [number]>(
      `SELECT s.id, s.title,
              (SELECT COUNT(*) FROM template_field f WHERE f.section_id = s.id) AS fields
       FROM template_section s WHERE s.version_id = ? ORDER BY s.position`,
    )
    .all(versionId);

  if (sections.length === 0) {
    problems.push({ level: "warning", code: "NO_SECTIONS", params: {} });
  }
  for (const s of sections) {
    if (s.fields === 0) {
      problems.push({ level: "info", code: "EMPTY_SECTION", params: { title: s.title } });
    }
  }

  const fields = db
    .query<
      { field_key: string; label: string; type: FieldType; metric_id: number | null;
        metric_label: string | null; opts: number; opts_without_score: number },
      [number]
    >(
      `SELECT f.field_key, f.label, f.type, f.metric_id, m.label AS metric_label,
              (SELECT COUNT(*) FROM template_field_option o WHERE o.field_id = f.id) AS opts,
              (SELECT COUNT(*) FROM template_field_option o
               WHERE o.field_id = f.id AND o.score IS NULL) AS opts_without_score
       FROM template_field f
       LEFT JOIN metric m ON m.id = f.metric_id
       WHERE f.version_id = ?`,
    )
    .all(versionId);

  for (const f of fields) {
    if (SELECT_TYPES.includes(f.type) && f.opts === 0) {
      problems.push({
        level: "error", fieldKey: f.field_key,
        code: "SELECT_WITHOUT_OPTIONS", params: { label: f.label },
      });
    }
    // Without a score a metric-bound select never becomes a chart — and that would only
    // surface a month later, once the data is already collected.
    if (f.metric_id !== null && SELECT_TYPES.includes(f.type) && f.opts_without_score > 0) {
      problems.push({
        level: "error", fieldKey: f.field_key,
        code: "METRIC_OPTIONS_WITHOUT_SCORE",
        params: {
          label: f.label,
          metric: f.metric_label ?? "",
          count: f.opts_without_score,
        },
      });
    }
  }

  // Two bindings to one metric in a single version produce two points per meeting:
  // there is no telling which of them is the real one.
  const dupes = db
    .query<{ label: string; n: number }, [number]>(
      `SELECT m.label, COUNT(*) AS n
       FROM template_field f JOIN metric m ON m.id = f.metric_id
       WHERE f.version_id = ?
       GROUP BY f.metric_id HAVING COUNT(*) > 1`,
    )
    .all(versionId);
  for (const d of dupes) {
    problems.push({
      level: "warning",
      code: "DUPLICATE_METRIC_BINDING",
      params: { metric: d.label, count: d.n },
    });
  }

  return problems;
}

export { answerCountForFieldKey };
