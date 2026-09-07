import type { Database } from "bun:sqlite";
import type { FieldRow, SectionRow, TemplateRow, TemplateVersionRow } from "../db/types.ts";
import { nowIso } from "../lib/dates.ts";
import { mintKey } from "../lib/ids.ts";
import { TemplateEditError } from "../lib/errors.ts";

/**
 * Template versioning. The rule implemented here (CLAUDE.md rule 5):
 *
 *   a version is edited in place while frozen_at IS NULL;
 *   the first meeting bound to it freezes it;
 *   editing a frozen version forks it, copying sections, fields and options and
 *   preserving section_key / field_key / option_key.
 *
 * Hence the invariant the whole editor rests on: **a draft cannot have filled-in
 * meetings**, so inside a draft it is safe to change a field's type, scale or visibility —
 * there is nothing to reinterpret. Completed meetings stay attached to their frozen
 * version forever.
 */

export function mintSectionKey(title: string): string {
  return mintKey("sec", title);
}
export function mintFieldKey(label: string): string {
  return mintKey("f", label);
}
export function mintOptionKey(label: string): string {
  return mintKey("opt", label);
}

export function currentVersion(db: Database, templateId: number): TemplateVersionRow {
  const row = db
    .query<TemplateVersionRow, [number]>(
      `SELECT tv.* FROM template_version tv
       JOIN template t ON t.current_version_id = tv.id
       WHERE t.id = ?`,
    )
    .get(templateId);
  if (!row) throw new TemplateEditError("NO_CURRENT_VERSION", { template: templateId });
  return row;
}

/** Freeze a version — called when the first meeting binds to it. */
export function freezeIfNeeded(db: Database, versionId: number): void {
  db.query("UPDATE template_version SET frozen_at = ? WHERE id = ? AND frozen_at IS NULL")
    .run(nowIso(), versionId);
}

/**
 * A copy of a version that preserves every stable key. The keys, not the ids, provide
 * continuity: `field_key` ties one question across versions, `metric_id` ties one
 * measurement across templates.
 */
export function forkVersion(db: Database, versionId: number, changeNote: string | null): number {
  const source = db
    .query<TemplateVersionRow, [number]>("SELECT * FROM template_version WHERE id = ?")
    .get(versionId);
  if (!source) throw new TemplateEditError("VERSION_NOT_FOUND", { version: versionId });

  const now = nowIso();
  const nextNo = db
    .query<{ n: number }, [number]>(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM template_version WHERE template_id = ?",
    )
    .get(source.template_id)!.n;

  const created = db
    .query<{ id: number }, [number, number, number, string | null, string]>(
      `INSERT INTO template_version
         (template_id, version_no, parent_version_id, change_note, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(source.template_id, nextNo, versionId, changeNote, now)!;
  const newId = created.id;

  db.query(
    `INSERT INTO template_section (version_id, section_key, title, description, position)
     SELECT ?, section_key, title, description, position
     FROM template_section WHERE version_id = ?`,
  ).run(newId, versionId);

  // section_id is rebuilt through section_key: the copy has ids of its own.
  db.query(
    `INSERT INTO template_field
       (version_id, section_id, field_key, label, help_text, type, visibility, is_required,
        position, metric_id, scale_min, scale_max, scale_step, scale_min_label, scale_max_label,
        config_json)
     SELECT ?, ns.id, f.field_key, f.label, f.help_text, f.type, f.visibility, f.is_required,
            f.position, f.metric_id, f.scale_min, f.scale_max, f.scale_step,
            f.scale_min_label, f.scale_max_label, f.config_json
     FROM template_field f
     JOIN template_section olds ON olds.id = f.section_id
     JOIN template_section ns   ON ns.version_id = ? AND ns.section_key = olds.section_key
     WHERE f.version_id = ?`,
  ).run(newId, newId, versionId);

  // field_id through field_key, for the same reason.
  db.query(
    `INSERT INTO template_field_option (field_id, option_key, label, score, color, position)
     SELECT newf.id, o.option_key, o.label, o.score, o.color, o.position
     FROM template_field_option o
     JOIN template_field oldf ON oldf.id = o.field_id
     JOIN template_field newf ON newf.version_id = ? AND newf.field_key = oldf.field_key
     WHERE oldf.version_id = ?`,
  ).run(newId, versionId);

  db.query("UPDATE template SET current_version_id = ?, updated_at = ? WHERE id = ?")
    .run(newId, now, source.template_id);

  return newId;
}

/**
 * The version that may be edited. Forks if the current one is frozen.
 *
 * Every editor mutation starts here, which is why "I edited a template that meetings
 * already used" physically cannot damage history: the edit lands in a new version.
 */
export function ensureDraft(
  db: Database, templateId: number, changeNote: string | null = null,
): number {
  const version = currentVersion(db, templateId);
  if (version.frozen_at === null) return version.id;
  return forkVersion(db, version.id, changeNote);
}

/** Invariant check — used by tests and as a guard before risky edits. */
export function draftHasNoAnswers(db: Database, versionId: number): boolean {
  const row = db
    .query<{ n: number }, [number]>(
      `SELECT COUNT(*) AS n FROM meeting_answer a
       JOIN template_field f ON f.id = a.field_id
       WHERE f.version_id = ?`,
    )
    .get(versionId)!;
  return row.n === 0;
}

export function answerCountForFieldKey(db: Database, templateId: number, fieldKey: string): number {
  return db
    .query<{ n: number }, [number, string]>(
      `SELECT COUNT(*) AS n
       FROM meeting_answer a
       JOIN template_field f ON f.id = a.field_id
       JOIN template_version tv ON tv.id = f.version_id
       WHERE tv.template_id = ? AND f.field_key = ?`,
    )
    .get(templateId, fieldKey)!.n;
}

// ─────────────────────────────────────────────────────────── version diff

export type ChangeKind =
  | "added" | "removed" | "relabelled" | "retyped" | "rescaled"
  | "rebound" | "unbound" | "visibility" | "moved";

export interface FieldChange {
  kind: ChangeKind;
  fieldKey: string;
  label: string;
  from?: string | null;
  to?: string | null;
}

export interface VersionDiff {
  from: TemplateVersionRow;
  to: TemplateVersionRow;
  changes: FieldChange[];
  sectionChanges: FieldChange[];
}

interface DiffFieldRow extends FieldRow {
  metric_key: string | null;
  section_key: string;
}

function diffFields(db: Database, versionId: number): DiffFieldRow[] {
  return db
    .query<DiffFieldRow, [number]>(
      `SELECT f.*, m.key AS metric_key, s.section_key
       FROM template_field f
       JOIN template_section s ON s.id = f.section_id
       LEFT JOIN metric m ON m.id = f.metric_id
       WHERE f.version_id = ?`,
    )
    .all(versionId);
}

/**
 * The diff keys off field_key, because that is what "the same question" means. A
 * visibility change is reported as its own item: it is the change that alters what the
 * mentee will see.
 */
export function diffVersions(db: Database, fromId: number, toId: number): VersionDiff {
  const get = (id: number) =>
    db.query<TemplateVersionRow, [number]>("SELECT * FROM template_version WHERE id = ?").get(id);
  const from = get(fromId);
  const to = get(toId);
  if (!from || !to) throw new TemplateEditError("VERSION_NOT_FOUND", { version: fromId });

  const before = new Map(diffFields(db, fromId).map((f) => [f.field_key, f]));
  const after = new Map(diffFields(db, toId).map((f) => [f.field_key, f]));
  const changes: FieldChange[] = [];

  for (const [key, f] of after) {
    const old = before.get(key);
    if (!old) {
      changes.push({ kind: "added", fieldKey: key, label: f.label });
      continue;
    }
    if (old.label !== f.label) {
      changes.push({
        kind: "relabelled", fieldKey: key, label: f.label, from: old.label, to: f.label,
      });
    }
    if (old.type !== f.type) {
      changes.push({ kind: "retyped", fieldKey: key, label: f.label, from: old.type, to: f.type });
    }
    if (old.scale_min !== f.scale_min || old.scale_max !== f.scale_max) {
      changes.push({
        kind: "rescaled", fieldKey: key, label: f.label,
        from: `${old.scale_min}-${old.scale_max}`, to: `${f.scale_min}-${f.scale_max}`,
      });
    }
    if (old.metric_key !== f.metric_key) {
      changes.push({
        kind: f.metric_key === null ? "unbound" : "rebound",
        fieldKey: key, label: f.label, from: old.metric_key, to: f.metric_key,
      });
    }
    if (old.visibility !== f.visibility) {
      changes.push({
        kind: "visibility", fieldKey: key, label: f.label,
        from: old.visibility, to: f.visibility,
      });
    }
    if (old.section_key !== f.section_key || old.position !== f.position) {
      changes.push({ kind: "moved", fieldKey: key, label: f.label });
    }
  }

  for (const [key, f] of before) {
    if (!after.has(key)) changes.push({ kind: "removed", fieldKey: key, label: f.label });
  }

  const sectionsBefore = new Map(
    db.query<SectionRow, [number]>("SELECT * FROM template_section WHERE version_id = ?")
      .all(fromId).map((s) => [s.section_key, s]),
  );
  const sectionsAfter = new Map(
    db.query<SectionRow, [number]>("SELECT * FROM template_section WHERE version_id = ?")
      .all(toId).map((s) => [s.section_key, s]),
  );
  const sectionChanges: FieldChange[] = [];
  for (const [key, s] of sectionsAfter) {
    const old = sectionsBefore.get(key);
    if (!old) sectionChanges.push({ kind: "added", fieldKey: key, label: s.title });
    else if (old.title !== s.title) {
      sectionChanges.push({
        kind: "relabelled", fieldKey: key, label: s.title, from: old.title, to: s.title,
      });
    }
  }
  for (const [key, s] of sectionsBefore) {
    if (!sectionsAfter.has(key)) {
      sectionChanges.push({ kind: "removed", fieldKey: key, label: s.title });
    }
  }

  return { from, to, changes, sectionChanges };
}

export function listVersions(db: Database, templateId: number): TemplateVersionRow[] {
  return db
    .query<TemplateVersionRow, [number]>(
      "SELECT * FROM template_version WHERE template_id = ? ORDER BY version_no DESC",
    )
    .all(templateId);
}

export function meetingCountForVersion(db: Database, versionId: number): number {
  return db
    .query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM meeting WHERE template_version_id = ?",
    )
    .get(versionId)!.n;
}

export function createTemplate(db: Database, name: string, ownerId = 1): TemplateRow {
  const now = nowIso();
  const template = db
    .query<TemplateRow, [number, string, string, string]>(
      `INSERT INTO template (owner_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?) RETURNING *`,
    )
    .get(ownerId, name, now, now)!;

  const version = db
    .query<{ id: number }, [number, string]>(
      `INSERT INTO template_version (template_id, version_no, created_at)
       VALUES (?, 1, ?) RETURNING id`,
    )
    .get(template.id, now)!;

  db.query("UPDATE template SET current_version_id = ? WHERE id = ?").run(version.id, template.id);
  return { ...template, current_version_id: version.id };
}

/** A whole-template copy — easier than assembling something similar from scratch. */
export function duplicateTemplate(
  db: Database, templateId: number, name: string, ownerId = 1,
): TemplateRow {
  const source = currentVersion(db, templateId);
  const template = createTemplate(db, name, ownerId);
  const draftId = template.current_version_id!;

  db.query(
    `INSERT INTO template_section (version_id, section_key, title, description, position)
     SELECT ?, section_key, title, description, position
     FROM template_section WHERE version_id = ?`,
  ).run(draftId, source.id);

  db.query(
    `INSERT INTO template_field
       (version_id, section_id, field_key, label, help_text, type, visibility, is_required,
        position, metric_id, scale_min, scale_max, scale_step, scale_min_label, scale_max_label,
        config_json)
     SELECT ?, ns.id, f.field_key, f.label, f.help_text, f.type, f.visibility, f.is_required,
            f.position, f.metric_id, f.scale_min, f.scale_max, f.scale_step,
            f.scale_min_label, f.scale_max_label, f.config_json
     FROM template_field f
     JOIN template_section olds ON olds.id = f.section_id
     JOIN template_section ns   ON ns.version_id = ? AND ns.section_key = olds.section_key
     WHERE f.version_id = ?`,
  ).run(draftId, draftId, source.id);

  db.query(
    `INSERT INTO template_field_option (field_id, option_key, label, score, color, position)
     SELECT newf.id, o.option_key, o.label, o.score, o.color, o.position
     FROM template_field_option o
     JOIN template_field oldf ON oldf.id = o.field_id
     JOIN template_field newf ON newf.version_id = ? AND newf.field_key = oldf.field_key
     WHERE oldf.version_id = ?`,
  ).run(draftId, source.id);

  return template;
}

export { TemplateEditError };
