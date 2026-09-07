import type { Database } from "bun:sqlite";
import type { MetricKind, MetricRow } from "../db/types.ts";
import { nowIso } from "../lib/dates.ts";
import { slugify } from "../i18n/translit.ts";
import { MetricEditError } from "../lib/errors.ts";

/**
 * Metric operations.
 *
 * The rule that matters: `metric.key` is immutable from the moment anything references the
 * metric. The key is the identity of a measurement; renaming it silently merges or breaks
 * history. Only `label` gets renamed.
 */

const KEY_RE = /^[a-z][a-z0-9_]{1,48}$/;

/** A key derived from a label: "Goal clarity" -> goal_clarity, transliterating if needed. */
export function suggestKey(label: string): string {
  const base = slugify(label, 48);
  return base === "" ? "metric" : /^[a-z]/.test(base) ? base : `m_${base}`;
}

export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key)) throw new MetricEditError("METRIC_KEY_INVALID", { key });
}

/** A template field already references this metric, so its key is fixed for good. */
export function metricIsReferenced(db: Database, metricId: number): boolean {
  return (
    db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM template_field WHERE metric_id = ?",
      )
      .get(metricId)!.n > 0
  );
}

export function metricHasData(db: Database, metricId: number): boolean {
  return (
    db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM v_metric_point WHERE metric_id = ?",
      )
      .get(metricId)!.n > 0
  );
}

export interface MetricInput {
  key: string;
  label: string;
  description: string | null;
  kind: MetricKind;
  direction: 1 | -1;
  displayOrder: number;
}

export function createMetric(db: Database, input: MetricInput, ownerId = 1): MetricRow {
  const label = input.label.trim();
  if (label === "") throw new MetricEditError("METRIC_LABEL_REQUIRED");

  const key = input.key.trim() === "" ? suggestKey(label) : input.key.trim();
  assertValidKey(key);

  const taken = db
    .query<{ id: number }, [string, number]>("SELECT id FROM metric WHERE key = ? AND owner_id = ?")
    .get(key, ownerId);
  if (taken) throw new MetricEditError("METRIC_KEY_TAKEN", { key });

  return db
    .query<MetricRow, any[]>(
      `INSERT INTO metric (owner_id, key, label, description, kind, direction, display_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      ownerId, key, label, input.description, input.kind, input.direction,
      input.displayOrder, nowIso(),
    )!;
}

/**
 * Editing a metric. The key changes only while nothing references the metric.
 * Direction may change: it corrects an interpretation ("higher is worse"), not the data,
 * and a metric set up wrongly has to be fixable.
 */
export function updateMetric(
  db: Database, metricId: number, input: Omit<MetricInput, "kind">, ownerId = 1,
): MetricRow {
  const label = input.label.trim();
  if (label === "") throw new MetricEditError("METRIC_LABEL_REQUIRED");

  const existing = db
    .query<MetricRow, [number, number]>("SELECT * FROM metric WHERE id = ? AND owner_id = ?")
    .get(metricId, ownerId);
  if (!existing) throw new MetricEditError("METRIC_NOT_FOUND");

  const key = input.key.trim();
  if (key !== existing.key) {
    if (metricIsReferenced(db, metricId)) {
      throw new MetricEditError("METRIC_KEY_LOCKED", { key: existing.key });
    }
    assertValidKey(key);
    const taken = db
      .query<{ id: number }, [string, number, number]>(
        "SELECT id FROM metric WHERE key = ? AND owner_id = ? AND id <> ?",
      )
      .get(key, ownerId, metricId);
    if (taken) throw new MetricEditError("METRIC_KEY_TAKEN", { key });
  }

  return db
    .query<MetricRow, any[]>(
      `UPDATE metric SET key = ?, label = ?, description = ?, direction = ?, display_order = ?
       WHERE id = ? AND owner_id = ? RETURNING *`,
    )
    .get(key, label, input.description, input.direction, input.displayOrder, metricId, ownerId)!;
}

/**
 * An unreferenced metric is really deleted — that is a mistake made while creating it.
 * A referenced one is archived: history stands behind it, and deleting it would strip the
 * meaning from points already collected.
 */
export function removeMetric(db: Database, metricId: number, ownerId = 1): "deleted" | "archived" {
  if (metricIsReferenced(db, metricId)) {
    db.query("UPDATE metric SET archived_at = ? WHERE id = ? AND owner_id = ?")
      .run(nowIso(), metricId, ownerId);
    return "archived";
  }
  db.query("DELETE FROM metric WHERE id = ? AND owner_id = ?").run(metricId, ownerId);
  return "deleted";
}

export function restoreMetric(db: Database, metricId: number, ownerId = 1): void {
  db.query("UPDATE metric SET archived_at = NULL WHERE id = ? AND owner_id = ?")
    .run(metricId, ownerId);
}

export interface MetricUsage extends MetricRow {
  field_count: number;
  template_count: number;
  point_count: number;
  referenced: boolean;
}

/** Where a metric is used — needed to understand the consequences of an edit. */
export function metricsWithUsage(db: Database, ownerId = 1, includeArchived = false): MetricUsage[] {
  const rows = db
    .query<Omit<MetricUsage, "referenced">, [number]>(
      `SELECT m.*,
              (SELECT COUNT(*) FROM template_field f WHERE f.metric_id = m.id) AS field_count,
              (SELECT COUNT(DISTINCT tv.template_id)
               FROM template_field f JOIN template_version tv ON tv.id = f.version_id
               WHERE f.metric_id = m.id) AS template_count,
              (SELECT COUNT(*) FROM v_metric_point p WHERE p.metric_id = m.id) AS point_count
       FROM metric m
       WHERE m.owner_id = ?${includeArchived ? "" : " AND m.archived_at IS NULL"}
       ORDER BY m.display_order, m.label`,
    )
    .all(ownerId);
  return rows.map((r) => ({ ...r, referenced: r.field_count > 0 }));
}

export function getMetric(db: Database, metricId: number, ownerId = 1): MetricRow | null {
  return (
    db
      .query<MetricRow, [number, number]>("SELECT * FROM metric WHERE id = ? AND owner_id = ?")
      .get(metricId, ownerId) ?? null
  );
}

export function nextDisplayOrder(db: Database, ownerId = 1): number {
  return db
    .query<{ n: number }, [number]>(
      "SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM metric WHERE owner_id = ? AND display_order < 90",
    )
    .get(ownerId)!.n;
}

export { MetricEditError };
