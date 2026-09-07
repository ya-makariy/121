import { Hono } from "hono";
import { thm } from "../middleware/theme.ts";
import type { Context } from "hono";
import { db } from "../db/index.ts";
import { metricsPage } from "../views/pages/metrics.ts";
import { loc } from "../middleware/locale.ts";
import { errorMessage } from "../i18n/index.ts";
import { OWNER_ID } from "../middleware/current-user.ts";
import {
  createMetric, getMetric, MetricEditError, metricIsReferenced, metricsWithUsage,
  nextDisplayOrder, removeMetric, restoreMetric, updateMetric,
} from "../domain/metrics-editor.ts";
import type { MetricKind } from "../db/types.ts";

export const metricRoutes = new Hono();

function str(form: Record<string, unknown>, key: string): string | null {
  const v = form[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function render(c: Context, error: string | null = null) {
  const editParam = c.req.query("edit");
  const editing = editParam !== undefined ? getMetric(db(), Number.parseInt(editParam, 10), OWNER_ID) : null;
  const all = metricsWithUsage(db(), OWNER_ID, true);

  return c.html(
    metricsPage({
      locale: loc(c), theme: thm(c),
      metrics: all.filter((m) => m.archived_at === null),
      archived: all.filter((m) => m.archived_at !== null),
      editing,
      editingReferenced: editing !== null && metricIsReferenced(db(), editing.id),
      nextOrder: nextDisplayOrder(db(), OWNER_ID),
      error,
    }),
  );
}

metricRoutes.get("/metrics", (c) => render(c));

metricRoutes.post("/metrics", async (c) => {
  const form = await c.req.parseBody();
  const kindRaw = str(form, "kind");
  const kind: MetricKind = kindRaw === "categorical" ? "categorical" : "scalar";
  try {
    createMetric(
      db(),
      {
        key: str(form, "key") ?? "",
        label: str(form, "label") ?? "",
        description: str(form, "description"),
        kind,
        direction: str(form, "direction") === "-1" ? -1 : 1,
        displayOrder: Number.parseInt(str(form, "display_order") ?? "100", 10) || 100,
      },
      OWNER_ID,
    );
  } catch (err) {
    if (err instanceof MetricEditError) return render(c, errorMessage(loc(c), err));
    throw err;
  }
  return c.redirect("/metrics", 303);
});

metricRoutes.post("/metrics/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  try {
    updateMetric(
      db(), id,
      {
        key: str(form, "key") ?? "",
        label: str(form, "label") ?? "",
        description: str(form, "description"),
        direction: str(form, "direction") === "-1" ? -1 : 1,
        displayOrder: Number.parseInt(str(form, "display_order") ?? "100", 10) || 100,
      },
      OWNER_ID,
    );
  } catch (err) {
    if (err instanceof MetricEditError) return render(c, errorMessage(loc(c), err));
    throw err;
  }
  return c.redirect("/metrics", 303);
});

metricRoutes.post("/metrics/:id/remove", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  removeMetric(db(), id, OWNER_ID);
  return c.redirect("/metrics", 303);
});

metricRoutes.post("/metrics/:id/restore", (c) => {
  restoreMetric(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  return c.redirect("/metrics", 303);
});
