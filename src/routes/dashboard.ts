import { Hono } from "hono";
import { thm } from "../middleware/theme.ts";
import { db } from "../db/index.ts";
import { cadenceGroups } from "../db/queries/cadence.ts";
import { openActions } from "../db/queries/actions.ts";
import { dashboardPage } from "../views/pages/dashboard.ts";
import { loc } from "../middleware/locale.ts";
import { user, OWNER_ID } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", (c) => {
  const t = today(user(c).timezone);
  return c.html(
    dashboardPage({
      locale: loc(c), theme: thm(c),
      cadence: cadenceGroups(db(), t, OWNER_ID),
      actions: openActions(db(), t, null, OWNER_ID),
      today: t,
    }),
  );
});
