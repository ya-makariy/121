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
import { locale } from "../middleware/locale.ts";
import { currentUser } from "../middleware/current-user.ts";

export function mountRoutes(app: Hono): void {
  // Публичная страница саммари монтируется ПЕРВОЙ и вне ветки, где в v2 появится
  // авторизация. Ей нужны только локаль по умолчанию и снапшот из БД.
  app.route("/", publicShareRoutes);

  // Ветка руководителя. В v1 currentUser() — заглушка, возвращающая пользователя id=1;
  // в v2 здесь появится проверка сессии, и это единственное место, которое изменится.
  const app_ = new Hono();
  app_.use("*", locale(), currentUser());
  app_.route("/", dashboardRoutes);
  app_.route("/", peopleRoutes);
  app_.route("/", meetingRoutes);
  app_.route("/", actionRoutes);
  app_.route("/", chartRoutes);
  app_.route("/", compareRoutes);
  app_.route("/", shareRoutes);
  app_.route("/", settingsRoutes);
  app_.route("/", templateRoutes);
  app.route("/", app_);
}
