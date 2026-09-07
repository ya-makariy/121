import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  distinctScaleCount, getMetricByKey, metricsWithAnyData, sortByAttention, standings,
  teamsWithPeople,
} from "../db/queries/metrics.ts";
import { comparePage } from "../views/pages/compare.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID } from "../middleware/current-user.ts";

export const compareRoutes = new Hono();

compareRoutes.get("/compare", (c) => {
  const metrics = metricsWithAnyData(db(), OWNER_ID);
  const requested = c.req.query("metric");
  const metric = (requested ? getMetricByKey(db(), requested, OWNER_ID) : null) ?? metrics[0] ?? null;

  const teamParam = c.req.query("team");
  const teamId = teamParam !== undefined && teamParam !== ""
    ? Number.parseInt(teamParam, 10)
    : null;

  const rows = metric === null ? [] : standings(db(), metric.id, teamId, OWNER_ID);

  return c.html(
    comparePage({
      locale: loc(c),
      metrics,
      teams: teamsWithPeople(db(), OWNER_ID),
      selectedMetric: metric,
      selectedTeam: teamId,
      standings: metric === null ? [] : sortByAttention(rows, metric.direction),
      normalized: metric === null
        ? false
        : distinctScaleCount(db(), metric.id) > 1 || metric.kind === "categorical",
    }),
  );
});
