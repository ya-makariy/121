import type { Database } from "bun:sqlite";
import type { AnswerRow, MeetingRow } from "../types.ts";
import { nowIso } from "../../lib/dates.ts";

export function listMeetingsForPerson(db: Database, personId: number): MeetingRow[] {
  return db
    .query<MeetingRow, [number]>(
      `SELECT * FROM meeting
       WHERE person_id = ?
       ORDER BY COALESCE(held_on, date(scheduled_at), date(created_at)) DESC, id DESC`,
    )
    .all(personId);
}

export function getMeeting(db: Database, id: number, ownerId = 1): MeetingRow | null {
  return (
    db
      .query<MeetingRow, [number, number]>("SELECT * FROM meeting WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) ?? null
  );
}

/**
 * Создание встречи привязывает её к текущей версии шаблона и замораживает эту версию.
 * После заморозки правка шаблона форкает версию — заполненные встречи не
 * переинтерпретируются. См. domain/template-version.ts.
 */
export function createMeeting(
  db: Database,
  input: { person_id: number; template_version_id: number | null; held_on: string; title?: string | null },
  ownerId = 1,
): MeetingRow {
  const now = nowIso();
  const meeting = db
    .query<MeetingRow, any[]>(
      `INSERT INTO meeting
         (owner_id, person_id, template_version_id, status, title, held_on, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      ownerId, input.person_id, input.template_version_id, input.title ?? null,
      input.held_on, now, now,
    )!;

  if (input.template_version_id !== null) {
    db.query("UPDATE template_version SET frozen_at = ? WHERE id = ? AND frozen_at IS NULL")
      .run(now, input.template_version_id);
  }
  return meeting;
}

export function listAnswers(db: Database, meetingId: number): AnswerRow[] {
  return db
    .query<AnswerRow, [number]>("SELECT * FROM meeting_answer WHERE meeting_id = ?")
    .all(meetingId);
}

export function listAnswerOptionKeys(db: Database, meetingId: number): Map<number, string[]> {
  const rows = db
    .query<{ field_id: number; option_key: string }, [number]>(
      `SELECT a.field_id, ao.option_key
       FROM meeting_answer a
       JOIN meeting_answer_option ao ON ao.answer_id = a.id
       WHERE a.meeting_id = ?`,
    )
    .all(meetingId);
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const list = map.get(r.field_id);
    if (list) list.push(r.option_key);
    else map.set(r.field_id, [r.option_key]);
  }
  return map;
}

export function updateMeetingFields(
  db: Database,
  id: number,
  patch: { held_on?: string; title?: string | null; private_notes?: string | null;
           duration_min?: number | null; counts_for_cadence?: 0 | 1 },
  ownerId = 1,
): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    args.push(value);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(nowIso(), id, ownerId);
  db.query(`UPDATE meeting SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`).run(...args as any);
}

export function completeMeeting(db: Database, id: number, ownerId = 1): MeetingRow | null {
  const now = nowIso();
  return (
    db
      .query<MeetingRow, [string, string, number, number]>(
        `UPDATE meeting SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND held_on IS NOT NULL
         RETURNING *`,
      )
      .get(now, now, id, ownerId) ?? null
  );
}

export function reopenMeeting(db: Database, id: number, ownerId = 1): void {
  db.query(
    `UPDATE meeting SET status = 'draft', completed_at = NULL, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(nowIso(), id, ownerId);
}
