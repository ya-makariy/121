import { Database } from "bun:sqlite";
import { applyPragmas } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { nowIso } from "../src/lib/dates.ts";
import type { FieldType, Visibility } from "../src/db/types.ts";

/** A clean in-memory database with all migrations applied, seed included. */
export function testDb(): Database {
  const db = new Database(":memory:", { create: true, strict: false });
  applyPragmas(db);
  migrate(db);
  return db;
}

export function makePerson(db: Database, name = "Someone Nameless"): number {
  const now = nowIso();
  const row = db
    .query<{ id: number }, [string, string, string]>(
      `INSERT INTO person (owner_id, full_name, cadence_days, created_at, updated_at)
       VALUES (1, ?, 14, ?, ?) RETURNING id`,
    )
    .get(name, now, now)!;
  return row.id;
}

export function makeMeeting(
  db: Database, personId: number, versionId: number | null, heldOn: string,
): number {
  const now = nowIso();
  const row = db
    .query<{ id: number }, any[]>(
      `INSERT INTO meeting
         (owner_id, person_id, template_version_id, status, held_on, created_at, updated_at)
       VALUES (1, ?, ?, 'draft', ?, ?, ?) RETURNING id`,
    )
    .get(personId, versionId, heldOn, now, now)!;
  if (versionId !== null) {
    db.query("UPDATE template_version SET frozen_at = ? WHERE id = ? AND frozen_at IS NULL")
      .run(now, versionId);
  }
  return row.id;
}

export function completeMeeting(db: Database, meetingId: number): void {
  const now = nowIso();
  db.query("UPDATE meeting SET status='completed', completed_at=?, updated_at=? WHERE id=?")
    .run(now, now, meetingId);
}

export function defaultVersionId(db: Database): number {
  return db
    .query<{ current_version_id: number }, []>(
      "SELECT current_version_id FROM template WHERE is_default = 1",
    )
    .get()!.current_version_id;
}

/** Adds a section with one field to a version — used by the metric and privacy tests. */
export function addField(
  db: Database,
  versionId: number,
  opts: {
    sectionKey?: string; fieldKey: string; label: string; type: FieldType;
    visibility: Visibility; metricKey?: string;
    scaleMin?: number; scaleMax?: number; position?: number;
  },
): number {
  const sectionKey = opts.sectionKey ?? `sec_${opts.fieldKey}`;
  let section = db
    .query<{ id: number }, [number, string]>(
      "SELECT id FROM template_section WHERE version_id = ? AND section_key = ?",
    )
    .get(versionId, sectionKey);
  if (!section) {
    section = db
      .query<{ id: number }, [number, string, string]>(
        `INSERT INTO template_section (version_id, section_key, title, position)
         VALUES (?, ?, ?, 99) RETURNING id`,
      )
      .get(versionId, sectionKey, opts.label)!;
  }

  const metricId = opts.metricKey
    ? db.query<{ id: number }, [string]>("SELECT id FROM metric WHERE key = ?").get(opts.metricKey)!.id
    : null;

  return db
    .query<{ id: number }, any[]>(
      `INSERT INTO template_field
         (version_id, section_id, field_key, label, type, visibility, position,
          metric_id, scale_min, scale_max)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      versionId, section.id, opts.fieldKey, opts.label, opts.type, opts.visibility,
      opts.position ?? 50, metricId,
      opts.scaleMin ?? null, opts.scaleMax ?? null,
    )!.id;
}
