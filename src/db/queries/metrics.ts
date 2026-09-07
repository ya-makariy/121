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
 * Таймлайн метрики по человеку. Точки могут приходить из разных версий шаблона и даже
 * из разных шаблонов — это и есть смысл отдельной сущности «метрика».
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

/** Какие метрики у человека вообще есть точки — чтобы не рисовать пустые графики. */
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
 * Агрегат по команде: сначала среднее по человеку за период, потом по людям — иначе
 * человек с двумя встречами за месяц получает двойной вес.
 *
 * Состав берётся текущий (left_on IS NULL): реальный вопрос руководителя — «как движется
 * команда в её нынешнем составе». joined_on/left_on хранятся, поэтому альтернатива
 * «состав на тот момент» остаётся правкой запроса, а не миграцией.
 */
export function teamAggregate(
  db: Database, teamId: number, metricId: number, fromDate: string, minPeople: number,
): TeamAggregateRow[] {
  return db
    .query<TeamAggregateRow, [number, number, string, number]>(
      `WITH per_person AS (
         SELECT p.person_id, strftime('%Y-%m', p.on_date) AS period, AVG(p.norm_value) AS v
         FROM v_metric_point p
         JOIN team_member tm ON tm.person_id = p.person_id AND tm.left_on IS NULL
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
 * Сравнение людей по одной метрике на общем полотне.
 *
 * Группировка по месяцу, а не по датам встреч: люди встречаются в разные дни, и по сырым
 * датам линии не выравниваются — общий тренд команды становится нечитаемым. Внутри месяца
 * у человека берётся среднее, поэтому две встречи за месяц не дают ему двойной вес.
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
 * Последнее значение метрики по каждому человеку и предыдущее рядом с ним.
 *
 * Это и есть ответ на вопрос «кому уделить внимание»: график из восьми ломаных
 * не читается, а список, отсортированный худшим вперёд, читается сразу.
 * Порядок задаётся в приложении, потому что зависит от metric.direction.
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

/** Худшие впереди, с учётом направления метрики. */
export function sortByAttention(rows: PersonStanding[], direction: 1 | -1): PersonStanding[] {
  return [...rows].sort((a, b) => {
    const av = a.norm_value ?? 0;
    const bv = b.norm_value ?? 0;
    // direction = 1: меньше — хуже. direction = -1: больше — хуже.
    return direction === 1 ? av - bv : bv - av;
  });
}

/** Метрики, по которым вообще есть точки — чтобы не предлагать пустые графики. */
export function metricsWithAnyData(db: Database, ownerId = 1): MetricRow[] {
  return db
    .query<MetricRow, [number]>(
      `SELECT m.* FROM metric m
       WHERE m.archived_at IS NULL AND m.owner_id = ?
         AND EXISTS (SELECT 1 FROM v_metric_point p WHERE p.metric_id = m.id)
       -- Порядок задан данными (metric.display_order): первым экраном сравнения
       -- не должна открываться приватная оценка риска ухода.
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
 * Сколько разных шкал кормили эту метрику. Больше одной — график обязан рисовать
 * нормированные значения, иначе смена шкалы 1-5 на 1-10 выглядит как рост.
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
