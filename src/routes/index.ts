import { Hono } from "hono";
import { dashboardRoutes } from "./dashboard.ts";
import { peopleRoutes } from "./people.ts";
import { meetingRoutes } from "./meetings.ts";
import { actionRoutes } from "./actions.ts";
import { chartRoutes } from "./charts.ts";
import { compareRoutes } from "./compare.ts";
import { publicShareRoutes, shareRoutes } from "./shares.ts";
import { settingsRoutes } from "./settings.ts";
import { templateRoutes } from "./templates.ts";
import { metricRoutes } from "./metrics.ts";
import { teamRoutes } from "./teams.ts";
import { locale } from "../middleware/locale.ts";
import { theme } from "../middleware/theme.ts";
import { currentUser } from "../middleware/current-user.ts";

export function mountRoutes(app: Hono): void {
  // The public summary page is mounted FIRST and outside the branch where v2 will add
  // authentication. All it needs is the default locale and a snapshot from the database.
  app.route("/", publicShareRoutes);

  // The manager's branch. In v1 currentUser() is a stub returning user id=1; in v2 a
  // session check appears here, and this is the only place that changes.
  const app_ = new Hono();
  app_.use("*", locale(), theme(), currentUser());
  app_.route("/", dashboardRoutes);
  app_.route("/", peopleRoutes);
  app_.route("/", meetingRoutes);
  app_.route("/", actionRoutes);
  app_.route("/", chartRoutes);
  app_.route("/", compareRoutes);
  app_.route("/", shareRoutes);
  app_.route("/", settingsRoutes);
  app_.route("/", templateRoutes);
  app_.route("/", metricRoutes);
  app_.route("/", teamRoutes);
  app.route("/", app_);
}
