import type { Database } from "bun:sqlite";
import { classifyCadence, type CadenceState } from "../../domain/cadence.ts";

export interface CadenceRow {
  id: number;
  full_name: string;
  role_title: string | null;
  cadence_days: number | null;
  last_on: string | null;
  anchor_on: string | null;
  next_scheduled_at: string | null;
  open_actions: number;
}

export interface PersonCadence extends CadenceRow, CadenceState {}

/**
 * Каденс целиком считается на чтении. ?today приходит параметром: date('now') в SQLite
 * это UTC, и вечером в Москве дашборд начал бы врать на день (CLAUDE.md §3).
 */
export function cadenceOverview(db: Database, today: string, ownerId = 1): PersonCadence[] {
  const rows = db
    .query<CadenceRow, [string, number]>(
      `SELECT
         p.id, p.full_name, p.role_title, p.cadence_days,
         lm.last_on,
         COALESCE(p.cadence_anchor_on, date(p.created_at)) AS anchor_on,
         ns.next_at AS next_scheduled_at,
         COALESCE(oa.cnt, 0) AS open_actions
       FROM person p
       LEFT JOIN (
         SELECT person_id, MAX(held_on) AS last_on
         FROM meeting
         WHERE status = 'completed' AND counts_for_cadence = 1
         GROUP BY person_id
       ) lm ON lm.person_id = p.id
       LEFT JOIN (
         SELECT person_id, MIN(scheduled_at) AS next_at
         FROM meeting
         WHERE status = 'scheduled' AND date(scheduled_at) >= ?
         GROUP BY person_id
       ) ns ON ns.person_id = p.id
       LEFT JOIN (
         SELECT person_id, COUNT(*) AS cnt
         FROM action_item
         WHERE status IN ('open','in_progress')
         GROUP BY person_id
       ) oa ON oa.person_id = p.id
       WHERE p.archived_at IS NULL AND p.owner_id = ?`,
    )
    .all(today, ownerId);

  const order: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2, no_cadence: 3 };

  return rows
    .map((r) => ({
      ...r,
      ...classifyCadence(
        { cadenceDays: r.cadence_days, lastHeldOn: r.last_on, anchorOn: r.anchor_on },
        today,
      ),
    }))
    .sort((a, b) => {
      const byStatus = order[a.status]! - order[b.status]!;
      if (byStatus !== 0) return byStatus;
      if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
      return a.full_name.localeCompare(b.full_name);
    });
}
