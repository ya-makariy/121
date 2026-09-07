import { Hono } from "hono";
import { db } from "../db/index.ts";
import { openActions, setActionStatus } from "../db/queries/actions.ts";
import { actionsPage } from "../views/pages/misc.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import type { ActionStatus } from "../db/types.ts";

export const actionRoutes = new Hono();

actionRoutes.get("/actions", (c) =>
  c.html(
    actionsPage({
      locale: loc(c),
      actions: openActions(db(), today(user(c).timezone), null, OWNER_ID),
    }),
  ));

actionRoutes.post("/actions/:id/status", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  const status = String(form["status"] ?? "done") as ActionStatus;
  const meetingId = typeof form["meeting_id"] === "string"
    ? Number.parseInt(form["meeting_id"], 10)
    : null;

  setActionStatus(db(), id, status, meetingId, OWNER_ID);
  const back = typeof form["return_to"] === "string" ? form["return_to"] : "/actions";
  return c.redirect(back, 303);
});
