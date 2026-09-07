import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index.ts";
import { listTeamMembers, listTeams, getTeam } from "../db/queries/teams.ts";
import { teamsPage, type TeamWithRoster } from "../views/pages/teams.ts";
import { loc } from "../middleware/locale.ts";
import { errorMessage } from "../i18n/index.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import {
  archiveTeam, createTeam, recordDeparture, restoreTeam, setMemberPrimary, TeamEditError,
  updateTeam,
} from "../domain/teams.ts";

export const teamRoutes = new Hono();

function str(form: Record<string, unknown>, key: string): string | null {
  const v = form[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function id(c: Context, name: string): number {
  return Number.parseInt(c.req.param(name) ?? "", 10);
}

function render(c: Context, error: string | null = null) {
  const editParam = c.req.query("edit");
  const editing = editParam === undefined
    ? null
    : getTeam(db(), Number.parseInt(editParam, 10), OWNER_ID);
  const all = listTeams(db(), OWNER_ID, true);
  const active: TeamWithRoster[] = all
    .filter((t) => t.archived_at === null)
    .map((t) => ({ ...t, members: listTeamMembers(db(), t.id) }));

  return c.html(
    teamsPage({
      locale: loc(c),
      teams: active,
      archived: all.filter((t) => t.archived_at !== null),
      editing,
      error,
    }),
  );
}

/** Every write here can be refused by a rule, and a refusal must show as text, not a 500. */
function guard(c: Context, run: () => void) {
  try {
    run();
  } catch (err) {
    if (err instanceof TeamEditError) return render(c, errorMessage(loc(c), err));
    throw err;
  }
  return c.redirect("/teams", 303);
}

teamRoutes.get("/teams", (c) => render(c));

teamRoutes.post("/teams", async (c) => {
  const form = await c.req.parseBody();
  return guard(c, () =>
    createTeam(
      db(), { name: str(form, "name") ?? "", description: str(form, "description") }, OWNER_ID,
    ));
});

teamRoutes.post("/teams/:id", async (c) => {
  const form = await c.req.parseBody();
  return guard(c, () =>
    updateTeam(
      db(), id(c, "id"),
      { name: str(form, "name") ?? "", description: str(form, "description") },
      OWNER_ID,
    ));
});

teamRoutes.post("/teams/:id/archive", (c) =>
  guard(c, () => archiveTeam(db(), id(c, "id"), OWNER_ID)));

teamRoutes.post("/teams/:id/restore", (c) =>
  guard(c, () => restoreTeam(db(), id(c, "id"), OWNER_ID)));

teamRoutes.post("/teams/:id/members/:personId/primary", async (c) => {
  const form = await c.req.parseBody();
  return guard(c, () =>
    setMemberPrimary(db(), id(c, "id"), id(c, "personId"), str(form, "is_primary") === "1", OWNER_ID));
});

// A departure is dated in the manager's timezone, never by date('now'): CLAUDE.md rule 4.
teamRoutes.post("/teams/:id/members/:personId/leave", (c) =>
  guard(c, () =>
    recordDeparture(db(), id(c, "id"), id(c, "personId"), today(user(c).timezone), OWNER_ID)));
