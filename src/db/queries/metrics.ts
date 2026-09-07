import type { Database } from "bun:sqlite";
import type { MetricRow } from "../types.ts";

export function listMetrics(db: Database, ownerId = 1): MetricRow[] {
  return db
    .query<MetricRow, [number]>(
      `SELECT * FROM metric WHERE owner_id = ? AND archived_at IS NULL
       ORDER BY display_order, label`,
    )
    .all(ownerId);
}

export function getMetricByKey(db: Database, key: string, ownerId = 1): MetricRow | null {
  return (
    db
      .query<MetricRow, [string, number]>("SELECT * FROM metric WHERE key = ? AND owner_id = ?")
      .get(key, ownerId) ?? null
  );
}

export interface MetricPoint {
  meeting_id: number;
  on_date: string;
  template_version_id: number | null;
  raw_value: number | null;
  norm_value: number | null;
  field_key: string;
  field_label: string;
  scale_min: number | null;
  scale_max: number | null;
}

/**
 * A person's timeline for one metric. Points may come from different template versions and
 * even from different templates — that is the whole point of "metric" being its own thing.
 */
export function personTimeline(
  db: Database, personId: number, metricId: number, fromDate = "0000-01-01",
): MetricPoint[] {
  return db
    .query<MetricPoint, [number, number, string]>(
      `SELECT p.meeting_id, p.on_date, p.template_version_id, p.raw_value, p.norm_value,
              p.field_key, p.field_label, f.scale_min, f.scale_max
       FROM v_metric_point p
       JOIN meeting_answer a ON a.meeting_id = p.meeting_id AND a.field_key = p.field_key
       JOIN template_field f ON f.id = a.field_id
       WHERE p.person_id = ? AND p.metric_id = ? AND p.on_date >= ?
       ORDER BY p.on_date, p.meeting_id`,
    )
    .all(personId, metricId, fromDate);
}

/** Which metrics this person has any points for — so no empty chart gets drawn. */
export function metricsWithDataForPerson(db: Database, personId: number): MetricRow[] {
  return db
    .query<MetricRow, [number]>(
      `SELECT m.* FROM metric m
       WHERE m.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM v_metric_point p
                     WHERE p.metric_id = m.id AND p.person_id = ?)
       ORDER BY m.display_order, m.label`,
    )
    .all(personId);
}

export interface TeamAggregateRow {
  period: string;
  people: number;
  avg_norm: number;
  min_norm: number;
  max_norm: number;
}

/**
 * Which roster an aggregate is built on.
 *
 * "current" answers "how is my team, as it stands, trending" — the manager's usual
 * question, and the default PLAN.md settled on. "at_the_time" answers "what was this team
 * like in March", which needs the people who were in it in March, whether or not they are
 * still around: `left_on` is a departure date, not a deletion. Both are one query away
 * because joined_on/left_on have been stored from the first day.
 */
export type TeamMembership = "current" | "at_the_time";

const MEMBERSHIP_JOIN: Record<TeamMembership, string> = {
  current: "tm.left_on IS NULL",
  at_the_time:
    `(tm.joined_on IS NULL OR tm.joined_on <= p.on_date)
     AND (tm.left_on IS NULL OR p.on_date <= tm.left_on)`,
};

/**
 * Team aggregate: average per person within the period first, then across people —
 * otherwise someone with two meetings in a month carries double the weight.
 *
 * The roster is chosen by the caller, never guessed; see TeamMembership above.
 */
export function teamAggregate(
  db: Database, teamId: number, metricId: number, fromDate: string, minPeople: number,
  membership: TeamMembership = "current",
): TeamAggregateRow[] {
  return db
    .query<TeamAggregateRow, [number, number, string, number]>(
      `WITH per_person AS (
         SELECT p.person_id, strftime('%Y-%m', p.on_date) AS period, AVG(p.norm_value) AS v
         FROM v_metric_point p
         JOIN team_member tm ON tm.person_id = p.person_id
           AND ${MEMBERSHIP_JOIN[membership] ?? MEMBERSHIP_JOIN.current}
         WHERE tm.team_id = ? AND p.metric_id = ? AND p.on_date >= ?
         GROUP BY p.person_id, period
       )
       SELECT period, COUNT(*) AS people, AVG(v) AS avg_norm,
              MIN(v) AS min_norm, MAX(v) AS max_norm
       FROM per_person
       GROUP BY period
       HAVING COUNT(*) >= ?
       ORDER BY period`,
    )
    .all(teamId, metricId, fromDate, minPeople);
}

export interface ComparePoint {
  period: string;
  person_id: number;
  full_name: string;
  avg_norm: number;
  avg_raw: number;
  n: number;
}

/**
 * Comparing people on one metric in a single plot.
 *
 * Grouped by month rather than by meeting date: people meet on different days, and raw
 * dates leave the lines unaligned, which makes the team trend unreadable. Within a month a
 * person is averaged, so two meetings in one month do not give them double weight.
 */
export function compareByPeriod(
  db: Database, metricId: number, teamId: number | null, fromDate = "0000-01-01", ownerId = 1,
): ComparePoint[] {
  return db
    .query<ComparePoint, any[]>(
      `SELECT strftime('%Y-%m', p.on_date) AS period,
              p.person_id, pr.full_name,
              AVG(p.norm_value) AS avg_norm,
              AVG(p.raw_value)  AS avg_raw,
              COUNT(*)          AS n
       FROM v_metric_point p
       JOIN person pr ON pr.id = p.person_id AND pr.archived_at IS NULL AND pr.owner_id = ?
       WHERE p.metric_id = ? AND p.on_date >= ?
         AND (? IS NULL OR EXISTS (
               SELECT 1 FROM team_member tm
               WHERE tm.person_id = p.person_id AND tm.team_id = ? AND tm.left_on IS NULL))
       GROUP BY period, p.person_id
       ORDER BY period, pr.full_name`,
    )
    .all(ownerId, metricId, fromDate, teamId, teamId);
}

export interface PersonStanding {
  person_id: number;
  full_name: string;
  on_date: string;
  raw_value: number | null;
  norm_value: number | null;
  n: number;
  prev_norm: number | null;
  prev_date: string | null;
}

/**
 * Each person's latest value for a metric, with the previous one beside it.
 *
 * This is the actual answer to "who needs attention": a plot of eight lines does not read,
 * while a list sorted worst-first reads instantly. The ordering is applied in the
 * application because it depends on metric.direction.
 */
export function standings(
  db: Database, metricId: number, teamId: number | null, ownerId = 1,
): PersonStanding[] {
  return db
    .query<PersonStanding, any[]>(
      `WITH pts AS (
         SELECT p.person_id, pr.full_name, p.on_date, p.raw_value, p.norm_value, p.meeting_id,
                ROW_NUMBER() OVER (PARTITION BY p.person_id
                                   ORDER BY p.on_date DESC, p.meeting_id DESC) AS rn,
                COUNT(*)   OVER (PARTITION BY p.person_id) AS n
         FROM v_metric_point p
         JOIN person pr ON pr.id = p.person_id AND pr.archived_at IS NULL AND pr.owner_id = ?
         WHERE p.metric_id = ?
           AND (? IS NULL OR EXISTS (
                 SELECT 1 FROM team_member tm
                 WHERE tm.person_id = p.person_id AND tm.team_id = ? AND tm.left_on IS NULL))
       )
       SELECT cur.person_id, cur.full_name, cur.on_date, cur.raw_value, cur.norm_value, cur.n,
              prev.norm_value AS prev_norm, prev.on_date AS prev_date
       FROM pts cur
       LEFT JOIN pts prev ON prev.person_id = cur.person_id AND prev.rn = 2
       WHERE cur.rn = 1`,
    )
    .all(ownerId, metricId, teamId, teamId);
}

/** Worst first, honouring the metric direction. */
export function sortByAttention(rows: PersonStanding[], direction: 1 | -1): PersonStanding[] {
  return [...rows].sort((a, b) => {
    const av = a.norm_value ?? 0;
    const bv = b.norm_value ?? 0;
    // direction = 1: lower is worse. direction = -1: higher is worse.
    return direction === 1 ? av - bv : bv - av;
  });
}

/** Metrics that have any points at all — so no empty chart is offered. */
export function metricsWithAnyData(db: Database, ownerId = 1): MetricRow[] {
  return db
    .query<MetricRow, [number]>(
      `SELECT m.* FROM metric m
       WHERE m.archived_at IS NULL AND m.owner_id = ?
         AND EXISTS (SELECT 1 FROM v_metric_point p WHERE p.metric_id = m.id)
       -- The order is data (metric.display_order): the comparison screen must not open
       -- on the private attrition-risk assessment.
       ORDER BY m.display_order, m.label`,
    )
    .all(ownerId);
}

export interface TeamOption { id: number; name: string; people: number }

export function teamsWithPeople(db: Database, ownerId = 1): TeamOption[] {
  return db
    .query<TeamOption, [number]>(
      `SELECT t.id, t.name,
              (SELECT COUNT(*) FROM team_member tm
               WHERE tm.team_id = t.id AND tm.left_on IS NULL) AS people
       FROM team t
       WHERE t.owner_id = ? AND t.archived_at IS NULL
       ORDER BY t.name`,
    )
    .all(ownerId);
}

/**
 * How many distinct scales have fed this metric. More than one means the chart must plot
 * normalized values, otherwise moving from a 1-5 to a 1-10 scale looks like growth.
 */
export function distinctScaleCount(db: Database, metricId: number): number {
  return db
    .query<{ n: number }, [number]>(
      `SELECT COUNT(DISTINCT COALESCE(scale_min, -1) || ':' || COALESCE(scale_max, -1)) AS n
       FROM template_field
       WHERE metric_id = ? AND type = 'scale'`,
    )
    .get(metricId)!.n;
}
