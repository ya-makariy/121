import type { Database } from "bun:sqlite";
import { classifyCadence, type CadenceState, type CadenceStatus } from "../../domain/cadence.ts";

export interface CadenceRow {
  id: number;
  full_name: string;
  role_title: string | null;
  cadence_days: number | null;
  last_on: string | null;
  anchor_on: string | null;
  next_scheduled_at: string | null;
  open_actions: number;
  meeting_url: string | null;
}

export interface PersonCadence extends CadenceRow, CadenceState {}

/**
 * The urgency groups in the order the dashboard shows them, most urgent first.
 *
 * The order is structure, not text: it lives in this array and nowhere else. Reading it
 * off a dictionary object's keys, or sorting by the translated heading, would let a
 * change of locale silently reshuffle the page.
 *
 * `no_cadence` is last and deliberately outside the three urgency buckets: a person with
 * no cadence is not on time, late or nearly late — there is nothing to be late for.
 */
export const CADENCE_GROUP_ORDER: readonly CadenceStatus[] = [
  "overdue", "due_soon", "ok", "no_cadence",
];

export interface CadenceGroup {
  key: CadenceStatus;
  people: PersonCadence[];
}

export interface CadenceOverview {
  /** In CADENCE_GROUP_ORDER. A group with nobody in it is not returned at all. */
  groups: CadenceGroup[];
  /** Everyone unarchived, across every group. */
  total: number;
  /** overdue + due_soon: the people today is actually asking about. */
  waiting: number;
}

/**
 * Cadence is computed entirely on read. ?today arrives as a parameter: date('now') in
 * SQLite is UTC, and by evening in Moscow the dashboard would be a day off (CLAUDE.md 4).
 *
 * "Last meeting" is the last completed meeting with counts_for_cadence = 1, and this is
 * the only query that narrows on that flag. A corridor check-in with the flag cleared
 * still carries answers into v_metric_point and into the summary; it must simply not
 * reset the clock on the next real 1:1.
 */
export function cadenceOverview(db: Database, today: string, ownerId = 1): PersonCadence[] {
  const rows = db
    .query<CadenceRow, [string, number]>(
      `SELECT
         p.id, p.full_name, p.role_title, p.cadence_days, p.meeting_url,
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
           -- The same gate queries/actions.ts:openActions applies, for the same reason and
           -- so that the number on the row keeps agreeing with the list it summarises: an
           -- agreement raised in a meeting still being held is not open yet.
           AND COALESCE(
                 (SELECT m.status FROM meeting m WHERE m.id = action_item.created_meeting_id),
                 'completed') = 'completed'
         GROUP BY person_id
       ) oa ON oa.person_id = p.id
       WHERE p.archived_at IS NULL AND p.owner_id = ?`,
    )
    .all(today, ownerId);

  return rows
    .map((r) => ({
      ...r,
      ...classifyCadence(
        { cadenceDays: r.cadence_days, lastHeldOn: r.last_on, anchorOn: r.anchor_on },
        today,
      ),
    }))
    .sort((a, b) => {
      const byStatus =
        CADENCE_GROUP_ORDER.indexOf(a.status) - CADENCE_GROUP_ORDER.indexOf(b.status);
      if (byStatus !== 0) return byStatus;
      if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
      return a.full_name.localeCompare(b.full_name);
    });
}

/**
 * The dashboard's list, already grouped by urgency.
 *
 * The grouping belongs here rather than in the view: which bucket a person falls into is
 * a fact about the data, computed from the same `?today` and the same
 * `classifyCadence()` as every other status in the app. A view that regrouped a flat list
 * would be free to answer differently than the person page does.
 */
export function cadenceGroups(db: Database, today: string, ownerId = 1): CadenceOverview {
  const people = cadenceOverview(db, today, ownerId);

  const groups: CadenceGroup[] = [];
  for (const key of CADENCE_GROUP_ORDER) {
    const inGroup = people.filter((p) => p.status === key);
    if (inGroup.length > 0) groups.push({ key, people: inGroup });
  }

  return {
    groups,
    total: people.length,
    waiting: people.filter((p) => p.status === "overdue" || p.status === "due_soon").length,
  };
}
