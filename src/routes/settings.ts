import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { basename } from "node:path";
import { db } from "../db/index.ts";
import { settingsPage } from "../views/pages/misc.ts";
import { loc } from "../middleware/locale.ts";
import { isLocale } from "../i18n/index.ts";
import { backupTo } from "../domain/backup.ts";
import { exportFullJson, exportFullMarkdown } from "../domain/export.ts";
import { nowIso } from "../lib/dates.ts";

export const settingsRoutes = new Hono();

settingsRoutes.get("/settings", (c) => c.html(settingsPage({ locale: loc(c) })));

settingsRoutes.post("/settings/locale", async (c) => {
  const form = await c.req.parseBody();
  const next = String(form["locale"] ?? "");
  if (isLocale(next)) {
    setCookie(c, "lang", next, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 31_536_000 });
    db().query("UPDATE app_user SET locale = ? WHERE id = 1").run(next);
  }
  const back = typeof form["return_to"] === "string" && form["return_to"] !== ""
    ? form["return_to"]
    : "/settings";
  return c.redirect(back, 303);
});

settingsRoutes.post("/settings/backup", async (c) => {
  const path = backupTo(db());
  const file = Bun.file(path);
  c.header("Content-Type", "application/vnd.sqlite3");
  c.header("Content-Disposition", `attachment; filename="${basename(path)}"`);
  return c.body(await file.arrayBuffer());
});

/**
 * Экспорт включает приватное — это бэкап. Отдельные роуты, отдельные функции,
 * никакого ?format= между саммари и выгрузкой. См. CLAUDE.md §1.
 */
settingsRoutes.get("/settings/export.json", (c) => {
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="121-export-${nowIso().slice(0, 10)}.json"`);
  return c.body(exportFullJson(db()));
});

settingsRoutes.get("/settings/export.md", (c) => {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="121-export-${nowIso().slice(0, 10)}.md"`);
  return c.body(exportFullMarkdown(db()));
});
