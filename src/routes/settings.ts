import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { basename } from "node:path";
import { db } from "../db/index.ts";
import { setLocale, setTimezone } from "../db/queries/app-user.ts";
import { settingsPage } from "../views/pages/misc.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { errorMessage, isLocale } from "../i18n/index.ts";
import { isTheme, THEMES } from "../lib/theme.ts";
import { thm } from "../middleware/theme.ts";
import { assertTimezone, timezoneChoices, today } from "../domain/cadence.ts";
import { backupTo } from "../domain/backup.ts";
import { exportFullJson, exportFullMarkdown } from "../domain/export.ts";
import { nowIso } from "../lib/dates.ts";
import { SettingsError } from "../lib/errors.ts";

export const settingsRoutes = new Hono();

/**
 * The zone is read back from the request's user rather than from a local variable: it is
 * what cadence is being counted in at this moment, and the page shows today in it.
 */
function render(c: Context, error: string | null = null) {
  const timezone = user(c).timezone;
  return c.html(
    settingsPage({
      locale: loc(c),
      theme: thm(c),
      themes: [...THEMES],
      timezone,
      timezones: timezoneChoices(timezone),
      todayInZone: today(timezone),
      error,
    }),
  );
}

settingsRoutes.get("/settings", (c) => render(c));

settingsRoutes.post("/settings/locale", async (c) => {
  const form = await c.req.parseBody();
  const next = String(form["locale"] ?? "");
  if (isLocale(next)) {
    setCookie(c, "lang", next, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 31_536_000 });
    setLocale(db(), next, OWNER_ID);
  }
  const back = typeof form["return_to"] === "string" && form["return_to"] !== ""
    ? form["return_to"]
    : "/settings";
  return c.redirect(back, 303);
});

/**
 * The surface. Unlike the locale, nothing is written to app_user: the operating system's
 * appearance setting is per device, so an override of it belongs on the same device. An
 * unrecognised value is simply ignored rather than refused with a code — there is no way
 * to reach this route except through the switch or the settings form, both of which offer
 * a closed set, and a bad surface cannot corrupt anything the way a bad timezone can.
 */
settingsRoutes.post("/settings/theme", async (c) => {
  const form = await c.req.parseBody();
  const next = String(form["theme"] ?? "");
  if (isTheme(next)) {
    setCookie(c, "theme", next, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 31_536_000 });
  }
  const back = typeof form["return_to"] === "string" && form["return_to"] !== ""
    ? form["return_to"]
    : "/settings";
  return c.redirect(back, 303);
});

/**
 * The timezone is the input to todayInTz(), so a bad value would make the cadence
 * dashboard lie rather than fail: it is refused with a code, never stored (CLAUDE.md 4).
 */
settingsRoutes.post("/settings/timezone", async (c) => {
  const form = await c.req.parseBody();
  const next = String(form["timezone"] ?? "");
  try {
    setTimezone(db(), assertTimezone(next), OWNER_ID);
  } catch (err) {
    if (err instanceof SettingsError) return render(c, errorMessage(loc(c), err));
    throw err;
  }
  return c.redirect("/settings", 303);
});

settingsRoutes.post("/settings/backup", async (c) => {
  const path = backupTo(db());
  const file = Bun.file(path);
  c.header("Content-Type", "application/vnd.sqlite3");
  c.header("Content-Disposition", `attachment; filename="${basename(path)}"`);
  return c.body(await file.arrayBuffer());
});

/**
 * Export includes private content — it is a backup. Separate routes, separate functions,
 * no ?format= standing between a summary and a full dump. See CLAUDE.md rule 2.
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
