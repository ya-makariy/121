import { Hono } from "hono";
import { db } from "../db/index.ts";
import { listMetrics } from "../db/queries/metrics.ts";
import { templatesPage, type TemplateSummary } from "../views/pages/misc.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID } from "../middleware/current-user.ts";

export const templateRoutes = new Hono();

/**
 * Этап 3 — только просмотр: редактор шаблонов делается следующим этапом, чтобы
 * сначала получить работающий сквозной путь до реальной 1:1.
 */
templateRoutes.get("/templates", (c) => {
  const templates = db()
    .query<TemplateSummary, [number]>(
      `SELECT t.*, tv.version_no, tv.frozen_at,
              (SELECT COUNT(*) FROM template_section s WHERE s.version_id = tv.id) AS section_count,
              (SELECT COUNT(*) FROM template_field f WHERE f.version_id = tv.id) AS field_count
       FROM template t
       LEFT JOIN template_version tv ON tv.id = t.current_version_id
       WHERE t.owner_id = ? AND t.archived_at IS NULL
       ORDER BY t.is_default DESC, t.name`,
    )
    .all(OWNER_ID);

  return c.html(
    templatesPage({ locale: loc(c), templates, metrics: listMetrics(db(), OWNER_ID) }),
  );
});
