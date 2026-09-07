import type { Database } from "bun:sqlite";
import type { PersonRow } from "../types.ts";
import { nowIso } from "../../lib/dates.ts";

export function listPeople(db: Database, ownerId = 1): PersonRow[] {
  return db
    .query<PersonRow, [number]>(
      "SELECT * FROM person WHERE owner_id = ? AND archived_at IS NULL ORDER BY full_name",
    )
    .all(ownerId);
}

export function getPerson(db: Database, id: number, ownerId = 1): PersonRow | null {
  return (
    db
      .query<PersonRow, [number, number]>("SELECT * FROM person WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) ?? null
  );
}

export interface PersonInput {
  full_name: string;
  email: string | null;
  role_title: string | null;
  cadence_days: number | null;
  cadence_anchor_on: string | null;
  default_template_id: number | null;
  notes: string | null;
}

export function createPerson(db: Database, input: PersonInput, ownerId = 1): PersonRow {
  const now = nowIso();
  return db
    .query<PersonRow, any[]>(
      `INSERT INTO person
         (owner_id, full_name, email, role_title, cadence_days, cadence_anchor_on,
          default_template_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      ownerId, input.full_name, input.email, input.role_title, input.cadence_days,
      input.cadence_anchor_on, input.default_template_id, input.notes, now, now,
    )!;
}

export function updatePerson(
  db: Database, id: number, input: PersonInput, ownerId = 1,
): PersonRow | null {
  return (
    db
      .query<PersonRow, any[]>(
        `UPDATE person SET
           full_name = ?, email = ?, role_title = ?, cadence_days = ?,
           cadence_anchor_on = ?, default_template_id = ?, notes = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?
         RETURNING *`,
      )
      .get(
        input.full_name, input.email, input.role_title, input.cadence_days,
        input.cadence_anchor_on, input.default_template_id, input.notes, nowIso(),
        id, ownerId,
      ) ?? null
  );
}

/** Archive, never delete: the value of this tool is its longitudinal history. */
export function archivePerson(db: Database, id: number, ownerId = 1): void {
  const now = nowIso();
  db.query("UPDATE person SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(now, now, id, ownerId);
}
