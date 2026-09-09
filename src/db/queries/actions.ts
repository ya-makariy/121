import type { Database } from "bun:sqlite";
import type { ActionItemRow, ActionStatus, Assignee, Visibility } from "../types.ts";
import { nowIso } from "../../lib/dates.ts";

export interface OpenActionRow extends ActionItemRow {
  full_name: string;
  raised_on: string | null;
  age_days: number | null;
  is_late: 0 | 1;
}

/**
 * One query for two screens: personId = null gives the global list, a specific personId
 * gives the carry-over block in the next meeting's agenda.
 *
 * Carry-over is DERIVED, never copied: no duplicated rows and no status reconciliation.
 */
export function openActions(
  db: Database, today: string, personId: number | null = null, ownerId = 1,
): OpenActionRow[] {
  return db
    .query<OpenActionRow, any[]>(
      `SELECT ai.*, pr.full_name,
              cm.held_on AS raised_on,
              CAST(julianday(?) - julianday(COALESCE(cm.held_on, date(ai.created_at)))
                   AS INTEGER) AS age_days,
              CASE WHEN ai.due_on IS NOT NULL AND ai.due_on < ? THEN 1 ELSE 0 END AS is_late
       FROM action_item ai
       JOIN person pr ON pr.id = ai.person_id AND pr.archived_at IS NULL
       LEFT JOIN meeting cm ON cm.id = ai.created_meeting_id
       WHERE ai.status IN ('open','in_progress')
         AND ai.owner_id = ?
         AND (? IS NULL OR ai.person_id = ?)
         -- An agreement written down mid-meeting is not an obligation yet: the meeting is
         -- still a draft and the line may still be dropped. It enters the open list when
         -- the meeting is completed, which is the moment the two people agreed to it.
         AND COALESCE(cm.status, 'completed') = 'completed'
       ORDER BY is_late DESC, (ai.due_on IS NULL), ai.due_on, age_days DESC, ai.id`,
    )
    .all(today, today, ownerId, personId, personId) as OpenActionRow[];
}

export function listActionsForPerson(db: Database, personId: number): ActionItemRow[] {
  return db
    .query<ActionItemRow, [number]>(
      `SELECT * FROM action_item WHERE person_id = ?
       ORDER BY (status IN ('done','dropped')), position, id`,
    )
    .all(personId);
}

export interface ActionInput {
  person_id: number;
  created_meeting_id: number | null;
  title: string;
  details: string | null;
  assignee: Assignee;
  visibility: Visibility;
  due_on: string | null;
}

export function createAction(db: Database, input: ActionInput, ownerId = 1): ActionItemRow {
  const now = nowIso();
  return db
    .query<ActionItemRow, any[]>(
      `INSERT INTO action_item
         (owner_id, person_id, created_meeting_id, title, details, assignee, visibility,
          due_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      ownerId, input.person_id, input.created_meeting_id, input.title, input.details,
      input.assignee, input.visibility, input.due_on, now, now,
    )!;
}

export function setActionStatus(
  db: Database, id: number, status: ActionStatus, closedMeetingId: number | null = null,
  ownerId = 1,
): ActionItemRow | null {
  const now = nowIso();
  const closing = status === "done" || status === "dropped";
  return (
    db
      .query<ActionItemRow, any[]>(
        `UPDATE action_item SET
           status = ?,
           closed_at = CASE WHEN ? THEN ? ELSE NULL END,
           closed_meeting_id = CASE WHEN ? THEN COALESCE(?, closed_meeting_id) ELSE NULL END,
           updated_at = ?
         WHERE id = ? AND owner_id = ?
         RETURNING *`,
      )
      .get(status, closing ? 1 : 0, now, closing ? 1 : 0, closedMeetingId, now, id, ownerId) ?? null
  );
}

/** Records what was reviewed in a meeting and its status at that moment. */
export function recordActionReview(
  db: Database, meetingId: number, items: { id: number; status: ActionStatus }[],
): void {
  const ins = db.query(
    `INSERT INTO meeting_action_review (meeting_id, action_item_id, status_at_review)
     VALUES (?, ?, ?)
     ON CONFLICT (meeting_id, action_item_id) DO UPDATE SET status_at_review = excluded.status_at_review`,
  );
  for (const item of items) ins.run(meetingId, item.id, item.status);
}

/**
 * The agreements written down during THIS meeting, newest last.
 *
 * Deliberately not openActions(): that one answers "what is outstanding", and until the
 * meeting is completed these are not. This is the running list on the meeting page — what
 * we have agreed so far, in the order we agreed it.
 */
export function actionsCreatedIn(db: Database, meetingId: number): ActionItemRow[] {
  return db
    .query<ActionItemRow, [number]>(
      "SELECT * FROM action_item WHERE created_meeting_id = ? ORDER BY id",
    )
    .all(meetingId);
}

/**
 * Drops an agreement that was written down in this meeting and never left it.
 *
 * This is not a hole in rule 5. What the rule protects is history, and an agreement raised
 * two minutes ago in a meeting that is still a draft has none: it has never been carried
 * over, never been reviewed, never been closed, and nothing points at it. The guards below
 * say exactly that, in SQL rather than in the caller — it must have been created here, it
 * must still be open, and no meeting may have reviewed it. Anything else is a real
 * agreement with a past, and it is closed with a status, not deleted.
 */
export function deleteMeetingAction(
  db: Database, id: number, meetingId: number, ownerId = 1,
): boolean {
  return db
    .query(
      `DELETE FROM action_item
        WHERE id = ? AND owner_id = ? AND created_meeting_id = ?
          AND status = 'open' AND closed_at IS NULL AND closed_meeting_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM meeting_action_review r WHERE r.action_item_id = action_item.id
          )`,
    )
    .run(id, ownerId, meetingId).changes > 0;
}
