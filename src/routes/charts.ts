import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  compareByPeriod, distinctScaleCount, getMetricByKey, personTimeline,
} from "../db/queries/metrics.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID } from "../middleware/current-user.ts";
import { formatDate, formatMonth } from "../lib/dates.ts";
import { dict } from "../i18n/index.ts";

/**
 * Роуты графиков отдают JSON уже в форме {labels, datasets} — клиент не считает.
 *
 * Ключевое решение: если серия собрана из версий шаблона с разными шкалами, рисуем
 * нормализованные значения (0..1) и говорим об этом в подписи. Иначе смена шкалы 1-5 на
 * 1-10 выглядела бы как скачок удовлетворённости.
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

  // Подписи в тултипе: из какой версии шаблона и какой формулировкой пришла точка.
  const tooltips = points.map((p) =>
    versions.size > 1 ? `${p.field_label} (${t.templates.version} ${p.template_version_id})` : "",
  );

  const notes: string[] = [];
  if (normalized) {
    notes.push(
      locale === "ru"
        ? "Шкалы разных версий шаблона отличаются, поэтому значения приведены к 0-100%."
        : "Template versions use different scales, so values are normalized to 0-100%.",
    );
  }
  if (metric.direction === -1) {
    notes.push(locale === "ru" ? "Ниже — лучше." : "Lower is better.");
  }
  if (points.length === 1) {
    notes.push(
      locale === "ru"
        ? "Одна точка — тренда пока нет, вернитесь после следующей встречи."
        : "One data point — no trend yet; come back after the next meeting.",
    );
  }

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
 * Сравнение людей по одной метрике на общем полотне.
 *
 * Форма выбрана под два разных вопроса, которые нельзя ответить одной картинкой:
 *   «какое настроение в команде» — линия среднего плюс полоса мин-макс, читается при
 *      любом размере команды;
 *   «кому уделить внимание»      — ранжированный список рядом с графиком (рендерится
 *      на сервере), потому что восемь ломаных на одном полотне на этот вопрос не отвечают.
 *
 * Индивидуальные линии — опция сверху, максимум 8: девятая серия в категориальной палитре
 * потребовала бы генерировать цвет, а это уже неразличимые пары.
 */
chartRoutes.get("/api/charts/compare/metric/:key", (c) => {
  const metric = getMetricByKey(db(), c.req.param("key"), OWNER_ID);
  if (!metric) return c.json({ error: "unknown metric" }, 404);

  const teamParam = c.req.query("team");
  const teamId = teamParam !== undefined && teamParam !== "" ? Number.parseInt(teamParam, 10) : null;
  const rows = compareByPeriod(db(), metric.id, teamId, "0000-01-01", OWNER_ID);

  const locale = loc(c);
  const normalized = distinctScaleCount(db(), metric.id) > 1 || metric.kind === "categorical";
  const valueOf = (r: (typeof rows)[number]) => (normalized ? r.avg_norm : r.avg_raw);

  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const people = [...new Map(rows.map((r) => [r.person_id, r.full_name])).entries()]
    .sort((a, b) => a[0] - b[0]); // порядок по id: цвет закреплён за человеком, не за рангом

  const byKey = new Map(rows.map((r) => [`${r.person_id}|${r.period}`, valueOf(r)]));

  // Среднее считается по людям в периоде, а не по всем ответам: человек с двумя
  // встречами за месяц не должен весить вдвое.
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

  const scales = db()
    .query<{ scale_min: number | null; scale_max: number | null }, [number]>(
      "SELECT scale_min, scale_max FROM template_field WHERE metric_id = ? AND type = 'scale' LIMIT 1",
    )
    .get(metric.id);

  const notes: string[] = [];
  if (normalized) {
    notes.push(
      locale === "ru"
        ? "Значения приведены к 0-100%: шкалы разных версий шаблона отличаются."
        : "Values normalized to 0-100%: template versions use different scales.",
    );
  }
  if (metric.direction === -1) notes.push(locale === "ru" ? "Ниже — лучше." : "Lower is better.");
  if (people.length > 8) {
    notes.push(
      locale === "ru"
        ? `Индивидуальные линии доступны для 8 человек из ${people.length}; остальные — в списке ниже.`
        : `Individual lines are available for 8 of ${people.length} people; the rest are in the list below.`,
    );
  }

  return c.json({
    metric: { key: metric.key, label: metric.label, direction: metric.direction },
    labels: periods.map((p) => formatMonth(p, locale)),
    normalized,
    yMin: normalized ? 0 : (scales?.scale_min ?? 1),
    yMax: normalized ? 1 : (scales?.scale_max ?? 5),
    note: notes.join(" "),
    team: {
      avg,
      lo,
      hi,
      label: locale === "ru" ? "Среднее по команде" : "Team average",
      bandLabel: locale === "ru" ? "Разброс мин-макс" : "Min-max range",
    },
    // Цветовой слот закреплён за человеком по порядку id, а не по его текущему месту
    // в рейтинге: иначе изменение оценки перекрашивало бы график.
    people: people.slice(0, 8).map(([id, name], slot) => ({
      id,
      name,
      slot,
      data: periods.map((p) => byKey.get(`${id}|${p}`) ?? null),
    })),
  });
});
