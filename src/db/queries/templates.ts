import type { Database } from "bun:sqlite";
import type {
  FieldRow, FieldWithOptions, OptionRow, SectionRow, SectionWithFields,
  TemplateRow, TemplateVersionRow,
} from "../types.ts";

export function listTemplates(db: Database, ownerId = 1): TemplateRow[] {
  return db
    .query<TemplateRow, [number]>(
      "SELECT * FROM template WHERE owner_id = ? AND archived_at IS NULL ORDER BY is_default DESC, name",
    )
    .all(ownerId);
}

export function defaultTemplate(db: Database, ownerId = 1): TemplateRow | null {
  return (
    db
      .query<TemplateRow, [number]>(
        `SELECT * FROM template
         WHERE owner_id = ? AND archived_at IS NULL
         ORDER BY is_default DESC, id
         LIMIT 1`,
      )
      .get(ownerId) ?? null
  );
}

export function getTemplate(db: Database, id: number): TemplateRow | null {
  return db.query<TemplateRow, [number]>("SELECT * FROM template WHERE id = ?").get(id) ?? null;
}

export function getVersion(db: Database, versionId: number): TemplateVersionRow | null {
  return (
    db
      .query<TemplateVersionRow, [number]>("SELECT * FROM template_version WHERE id = ?")
      .get(versionId) ?? null
  );
}

/**
 * Полная структура версии шаблона: секции -> поля -> опции, в порядке отображения.
 * Три запроса вместо N+1; на этих объёмах этого более чем достаточно.
 */
export function loadVersionStructure(db: Database, versionId: number): SectionWithFields[] {
  const sections = db
    .query<SectionRow, [number]>(
      "SELECT * FROM template_section WHERE version_id = ? ORDER BY position, id",
    )
    .all(versionId);

  const fields = db
    .query<FieldRow, [number]>(
      "SELECT * FROM template_field WHERE version_id = ? ORDER BY section_id, position, id",
    )
    .all(versionId);

  const options =
    fields.length === 0
      ? []
      : db
          .query<OptionRow, [number]>(
            `SELECT o.* FROM template_field_option o
             JOIN template_field f ON f.id = o.field_id
             WHERE f.version_id = ?
             ORDER BY o.field_id, o.position, o.id`,
          )
          .all(versionId);

  const byField = new Map<number, OptionRow[]>();
  for (const o of options) {
    const list = byField.get(o.field_id);
    if (list) list.push(o);
    else byField.set(o.field_id, [o]);
  }

  const withOptions: FieldWithOptions[] = fields.map((f) => ({
    ...f,
    options: byField.get(f.id) ?? [],
  }));

  return sections.map((s) => ({
    ...s,
    fields: withOptions.filter((f) => f.section_id === s.id),
  }));
}

export function getFieldWithOptions(db: Database, fieldId: number): FieldWithOptions | null {
  const field = db
    .query<FieldRow, [number]>("SELECT * FROM template_field WHERE id = ?")
    .get(fieldId);
  if (!field) return null;
  const options = db
    .query<OptionRow, [number]>(
      "SELECT * FROM template_field_option WHERE field_id = ? ORDER BY position, id",
    )
    .all(fieldId);
  return { ...field, options };
}
