import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  compareByPeriod, distinctScaleCount, getMetricByKey, personTimeline,
} from "../db/queries/metrics.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID } from "../middleware/current-user.ts";
import { formatDate, formatMonth } from "../i18n/dates.ts";
import { dict, format } from "../i18n/index.ts";

/**
 * Chart routes return JSON already shaped as {labels, datasets} — the client does not
 * compute.
 *
 * The decision that matters: when a series is assembled from template versions with
 * different scales, plot normalized values (0..1) and say so in the caption. Otherwise a
 * move from a 1-5 to a 1-10 scale would read as a jump in satisfaction.
 */
export const chartRoutes = new Hono();

chartRoutes.get("/api/charts/person/:id/metric/:key", (c) => {
  const personId = Number.parseInt(c.req.param("id"), 10);
  const metric = getMetricByKey(db(), c.req.param("key"), OWNER_ID);
  if (!metric) return c.json({ error: "unknown metric" }, 404);

  const points = personTimeline(db(), personId, metric.id);
  const locale = loc(c);
  const t = dict(locale);

  const scales = new Set(points.map((p) => `${p.scale_min}-${p.scale_max}`));
  const versions = new Set(points.map((p) => p.template_version_id));
  const normalized = scales.size > 1 || metric.kind === "categorical";

  const labels = points.map((p) => formatDate(p.on_date, locale));
  const values = points.map((p) => (normalized ? p.norm_value : p.raw_value));

  const first = points[0];
  const yMin = normalized ? 0 : (first?.scale_min ?? 1);
  const yMax = normalized ? 1 : (first?.scale_max ?? 5);

  // Tooltip captions: which template version and which wording a point came from.
  const tooltips = points.map((p) =>
    versions.size > 1 ? `${p.field_label} (${t.templates.version} ${p.template_version_id})` : "");

  const notes: string[] = [];
  if (normalized) notes.push(t.charts.normalizedNote);
  if (metric.direction === -1) notes.push(t.charts.lowerIsBetter);
  if (points.length === 1) notes.push(t.charts.singlePoint);

  return c.json({
    metric: { key: metric.key, label: metric.label, direction: metric.direction },
    labels,
    normalized,
    yMin,
    yMax,
    tooltips,
    note: notes.join(" "),
    datasets: [{ label: metric.label, data: values }],
  });
});

/**
 * Comparing people on one metric in a single plot.
 *
 * The form is chosen for two different questions that one picture cannot answer:
 *   "how is the team feeling" — the average line plus a min-max band, readable at any team
 *      size;
 *   "who needs attention"    — the ranked list beside the chart (rendered on the server),
 *      because eight lines on one plot do not answer that question.
 *
 * Individual lines are an opt-in above the chart, capped at eight: a ninth series in a
 * categorical palette would mean generating a colour, and that produces indistinguishable
 * pairs.
 */
chartRoutes.get("/api/charts/compare/metric/:key", (c) => {
  const metric = getMetricByKey(db(), c.req.param("key"), OWNER_ID);
  if (!metric) return c.json({ error: "unknown metric" }, 404);

  const teamParam = c.req.query("team");
  const teamId = teamParam !== undefined && teamParam !== "" ? Number.parseInt(teamParam, 10) : null;
  const rows = compareByPeriod(db(), metric.id, teamId, "0000-01-01", OWNER_ID);

  const locale = loc(c);
  const t = dict(locale);
  const normalized = distinctScaleCount(db(), metric.id) > 1 || metric.kind === "categorical";
  const valueOf = (r: (typeof rows)[number]) => (normalized ? r.avg_norm : r.avg_raw);

  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const people = [...new Map(rows.map((r) => [r.person_id, r.full_name])).entries()]
    .sort((a, b) => a[0] - b[0]); // ordered by id: colour belongs to a person, not a rank

  const byKey = new Map(rows.map((r) => [`${r.person_id}|${r.period}`, valueOf(r)]));

  // The average is taken over people in the period, not over every answer: someone with
  // two meetings in a month must not weigh double.
  const avg: (number | null)[] = [];
  const lo: (number | null)[] = [];
  const hi: (number | null)[] = [];
  for (const period of periods) {
    const vals = rows.filter((r) => r.period === period).map(valueOf);
    if (vals.length === 0) { avg.push(null); lo.push(null); hi.push(null); continue; }
    avg.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    lo.push(Math.min(...vals));
    hi.push(Math.max(...vals));
  }

  const scale = db()
    .query<{ scale_min: number | null; scale_max: number | null }, [number]>(
      "SELECT scale_min, scale_max FROM template_field WHERE metric_id = ? AND type = 'scale' LIMIT 1",
    )
    .get(metric.id);

  const notes: string[] = [];
  if (normalized) notes.push(t.charts.normalizedNote);
  if (metric.direction === -1) notes.push(t.charts.lowerIsBetter);
  if (people.length > 8) {
    notes.push(format(t.charts.partialPeople, { total: people.length }));
  }

  return c.json({
    metric: { key: metric.key, label: metric.label, direction: metric.direction },
    labels: periods.map((p) => formatMonth(p, locale)),
    normalized,
    yMin: normalized ? 0 : (scale?.scale_min ?? 1),
    yMax: normalized ? 1 : (scale?.scale_max ?? 5),
    note: notes.join(" "),
    team: {
      avg,
      lo,
      hi,
      label: t.charts.teamAverage,
      bandLabel: t.charts.minMaxBand,
    },
    // A colour slot belongs to a person by id order, not to their current place in the
    // ranking: otherwise a changed score would repaint the chart.
    people: people.slice(0, 8).map(([id, name], slot) => ({
      id,
      name,
      slot,
      data: periods.map((p) => byKey.get(`${id}|${p}`) ?? null),
    })),
  });
});
