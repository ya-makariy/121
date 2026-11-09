import type { Database } from "bun:sqlite";
import type { PersonRow } from "../types.ts";
import { nowIso, type Birthday } from "../../lib/dates.ts";
import { classifyBirthday, isUpcoming, type BirthdayState } from "../../domain/birthdays.ts";

export function listPeople(db: Database, ownerId = 1): PersonRow[] {
  return db
    .query<PersonRow, [number]>(
      "SELECT * FROM person WHERE owner_id = ? AND archived_at IS NULL ORDER BY full_name",
    )
    .all(ownerId);
}

/**
 * The archive, as its own list. Rule 5 forbids a hard delete so that longitudinal history
 * survives; an archive nobody can see or undo is that same delete without the warning.
 */
export function listArchivedPeople(db: Database, ownerId = 1): PersonRow[] {
  return db
    .query<PersonRow, [number]>(
      "SELECT * FROM person WHERE owner_id = ? AND archived_at IS NOT NULL ORDER BY full_name",
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
  meeting_url: string | null;
  /** null means "not given": no month, no day, no year. */
  birthday: Birthday | null;
  notes: string | null;
}

export function createPerson(db: Database, input: PersonInput, ownerId = 1): PersonRow {
  const now = nowIso();
  return db
    .query<PersonRow, any[]>(
      `INSERT INTO person
         (owner_id, full_name, email, role_title, cadence_days, cadence_anchor_on,
          default_template_id, meeting_url, birth_month, birth_day, birth_year, notes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      ownerId, input.full_name, input.email, input.role_title, input.cadence_days,
      input.cadence_anchor_on, input.default_template_id, input.meeting_url,
      input.birthday?.month ?? null, input.birthday?.day ?? null, input.birthday?.year ?? null,
      input.notes, now, now,
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
           cadence_anchor_on = ?, default_template_id = ?, meeting_url = ?,
           birth_month = ?, birth_day = ?, birth_year = ?, notes = ?,
           updated_at = ?
         WHERE id = ? AND owner_id = ?
         RETURNING *`,
      )
      .get(
        input.full_name, input.email, input.role_title, input.cadence_days,
        input.cadence_anchor_on, input.default_template_id, input.meeting_url,
        input.birthday?.month ?? null, input.birthday?.day ?? null, input.birthday?.year ?? null,
        input.notes, nowIso(), id, ownerId,
      ) ?? null
  );
}

/** Archive, never delete: the value of this tool is its longitudinal history. */
export function archivePerson(db: Database, id: number, ownerId = 1): void {
  const now = nowIso();
  db.query("UPDATE person SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(now, now, id, ownerId);
}

/**
 * Undoes it. Nothing else has to be restored: archiving only ever wrote `archived_at`, so
 * meetings, answers and chart points were never touched and come back with the person.
 */
export function restorePerson(db: Database, id: number, ownerId = 1): void {
  const now = nowIso();
  db.query("UPDATE person SET archived_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(now, id, ownerId);
}

/** The birthday on a row, or null when none was given. Month and day travel together. */
export function birthdayOf(p: Pick<PersonRow, "birth_month" | "birth_day" | "birth_year">): Birthday | null {
  if (p.birth_month === null || p.birth_day === null) return null;
  return { month: p.birth_month, day: p.birth_day, year: p.birth_year };
}

export interface UpcomingBirthday extends BirthdayState {
  id: number;
  full_name: string;
}

/**
 * Whose birthday falls within the next `windowDays` days, soonest first. Archived people
 * are left out: their history stays, but the dashboard is about the people one still meets.
 *
 * The window arithmetic is done in the domain, not in SQL: a window that crosses the new
 * year ("28 December to 4 January") and the 29th of February are both awkward in a month-day
 * comparison and trivial once each birthday is turned into its next date.
 */
export function upcomingBirthdays(
  db: Database, today: string, windowDays: number, ownerId = 1,
): UpcomingBirthday[] {
  const rows = db
    .query<Pick<PersonRow, "id" | "full_name" | "birth_month" | "birth_day" | "birth_year">, [number]>(
      `SELECT id, full_name, birth_month, birth_day, birth_year
       FROM person
       WHERE owner_id = ? AND archived_at IS NULL AND birth_month IS NOT NULL`,
    )
    .all(ownerId);

  return rows
    .flatMap((r) => {
      const b = birthdayOf(r);
      if (b === null) return [];
      const state = classifyBirthday(b, today);
      return isUpcoming(state, windowDays) ? [{ id: r.id, full_name: r.full_name, ...state }] : [];
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.full_name.localeCompare(b.full_name));
}
