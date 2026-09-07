import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  archivePerson, createPerson, getPerson, listPeople, updatePerson, type PersonInput,
} from "../db/queries/people.ts";
import { listTemplates } from "../db/queries/templates.ts";
import { listMeetingsForPerson } from "../db/queries/meetings.ts";
import { listActionsForPerson } from "../db/queries/actions.ts";
import { metricsWithDataForPerson } from "../db/queries/metrics.ts";
import { cadenceOverview } from "../db/queries/cadence.ts";
import { peopleListPage, personFormPage } from "../views/pages/people.ts";
import { personPage } from "../views/pages/person.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import { dict } from "../i18n/index.ts";

export const peopleRoutes = new Hono();

function parsePersonInput(form: Record<string, unknown>): PersonInput {
  const str = (k: string) => {
    const v = form[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const cadence = str("cadence_days");
  return {
    full_name: str("full_name") ?? "",
    email: str("email"),
    role_title: str("role_title"),
    cadence_days: cadence === null ? null : Number.parseInt(cadence, 10),
    cadence_anchor_on: str("cadence_anchor_on"),
    default_template_id: str("default_template_id") === null
      ? null
      : Number.parseInt(str("default_template_id")!, 10),
    notes: str("notes"),
  };
}

peopleRoutes.get("/people", (c) =>
  c.html(peopleListPage({ locale: loc(c), people: listPeople(db(), OWNER_ID) })));

peopleRoutes.get("/people/new", (c) =>
  c.html(personFormPage({
    locale: loc(c), person: null, templates: listTemplates(db(), OWNER_ID),
  })));

peopleRoutes.post("/people", async (c) => {
  const input = parsePersonInput(await c.req.parseBody());
  if (input.full_name === "") {
    return c.html(
      personFormPage({
        locale: loc(c), person: null, templates: listTemplates(db(), OWNER_ID),
        error: dict(loc(c)).people.nameRequired,
      }),
      422,
    );
  }
  const person = createPerson(db(), input, OWNER_ID);
  return c.redirect(`/people/${person.id}`, 303);
});

peopleRoutes.get("/people/:id", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const person = getPerson(db(), id, OWNER_ID);
  if (!person) return c.notFound();

  const t = today(user(c).timezone);
  const cadence = cadenceOverview(db(), t, OWNER_ID).find((p) => p.id === id) ?? null;

  return c.html(
    personPage({
      locale: loc(c),
      person,
      cadence,
      meetings: listMeetingsForPerson(db(), id),
      actions: listActionsForPerson(db(), id),
      metrics: metricsWithDataForPerson(db(), id),
    }),
  );
});

peopleRoutes.get("/people/:id/edit", (c) => {
  const person = getPerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  if (!person) return c.notFound();
  return c.html(personFormPage({
    locale: loc(c), person, templates: listTemplates(db(), OWNER_ID),
  }));
});

peopleRoutes.post("/people/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const input = parsePersonInput(await c.req.parseBody());
  if (input.full_name === "") {
    const person = getPerson(db(), id, OWNER_ID);
    if (!person) return c.notFound();
    return c.html(
      personFormPage({
        locale: loc(c), person, templates: listTemplates(db(), OWNER_ID),
        error: dict(loc(c)).people.nameRequired,
      }),
      422,
    );
  }
  if (!updatePerson(db(), id, input, OWNER_ID)) return c.notFound();
  return c.redirect(`/people/${id}`, 303);
});

peopleRoutes.post("/people/:id/archive", (c) => {
  archivePerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  return c.redirect("/people", 303);
});
