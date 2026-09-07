import { Hono } from "hono";
import { db } from "../db/index.ts";
import {
  archivePerson, createPerson, getPerson, listArchivedPeople, listPeople, restorePerson,
  updatePerson, type PersonInput,
} from "../db/queries/people.ts";
import { listTemplates } from "../db/queries/templates.ts";
import { listTeams, teamsForPerson } from "../db/queries/teams.ts";
import { listMeetingsForPerson } from "../db/queries/meetings.ts";
import { listActionsForPerson } from "../db/queries/actions.ts";
import { metricsWithDataForPerson } from "../db/queries/metrics.ts";
import { cadenceOverview } from "../db/queries/cadence.ts";
import { peopleListPage, personFormPage } from "../views/pages/people.ts";
import { personPage } from "../views/pages/person.ts";
import type { PersonRow } from "../db/types.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import { dict, errorMessage } from "../i18n/index.ts";
import { safeExternalUrl } from "../lib/url.ts";
import { UrlError } from "../lib/errors.ts";
import { addTeamMember, assertAssignable, TeamEditError } from "../domain/teams.ts";

export const peopleRoutes = new Hono();

/**
 * What to show in the form when saving failed. Re-reading the row from the database would
 * silently discard what the person just typed — and the link they pasted is exactly the
 * thing they would least like to retype.
 */
function draftPerson(form: Record<string, unknown>, existing: PersonRow | null): PersonRow {
  const raw = (k: string) => {
    const v = form[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const cadence = raw("cadence_days");
  const template = raw("default_template_id");

  return {
    ...(existing ?? BLANK_PERSON),
    full_name: raw("full_name") ?? "",
    email: raw("email"),
    role_title: raw("role_title"),
    cadence_days: cadence === null ? null : Number.parseInt(cadence, 10),
    cadence_anchor_on: raw("cadence_anchor_on"),
    default_template_id: template === null ? null : Number.parseInt(template, 10),
    // Deliberately the raw value, not the validated one: it is what needs correcting.
    meeting_url: raw("meeting_url"),
    notes: raw("notes"),
  };
}

const BLANK_PERSON: PersonRow = {
  id: 0, full_name: "", email: null, role_title: null, timezone: null, started_on: null,
  cadence_days: null, cadence_anchor_on: null, default_template_id: null,
  meeting_url: null, notes: null, archived_at: null, created_at: "", updated_at: "",
};

function parsePersonInput(form: Record<string, unknown>): PersonInput {
  const str = (k: string) => {
    const v = form[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const cadence = str("cadence_days");

  // A link is validated here, not at render time: storing something we would refuse to
  // render leaves a field that silently does nothing. See lib/url.ts.
  const rawUrl = str("meeting_url");
  const meetingUrl = rawUrl === null ? null : safeExternalUrl(rawUrl);
  if (rawUrl !== null && meetingUrl === null) {
    throw new UrlError("URL_INVALID", { url: rawUrl });
  }

  return {
    full_name: str("full_name") ?? "",
    email: str("email"),
    role_title: str("role_title"),
    cadence_days: cadence === null ? null : Number.parseInt(cadence, 10),
    cadence_anchor_on: str("cadence_anchor_on"),
    default_template_id: str("default_template_id") === null
      ? null
      : Number.parseInt(str("default_template_id")!, 10),
    meeting_url: meetingUrl,
    notes: str("notes"),
  };
}

/**
 * The team the form asks for. `null` means "no team picked", which changes nothing: a
 * person leaves a team on a date, recorded on the teams page, never by being unpicked here
 * (CLAUDE.md rule 5).
 */
interface TeamAssignment {
  teamId: number | null;
  isPrimary: boolean;
}

function parseTeamAssignment(form: Record<string, unknown>): TeamAssignment {
  const raw = form["team_id"];
  const teamId = typeof raw === "string" && raw.trim() !== ""
    ? Number.parseInt(raw, 10)
    : null;
  return {
    teamId: teamId !== null && Number.isFinite(teamId) ? teamId : null,
    isPrimary: form["is_primary"] !== undefined,
  };
}

peopleRoutes.get("/people", (c) =>
  c.html(peopleListPage({
    locale: loc(c),
    people: listPeople(db(), OWNER_ID),
    archived: listArchivedPeople(db(), OWNER_ID),
  })));

peopleRoutes.get("/people/new", (c) =>
  c.html(personFormPage({
    locale: loc(c), person: null, templates: listTemplates(db(), OWNER_ID),
    teams: listTeams(db(), OWNER_ID),
  })));

peopleRoutes.post("/people", async (c) => {
  const form = await c.req.parseBody();
  const team = parseTeamAssignment(form);
  const showForm = (error: string) =>
    c.html(
      personFormPage({
        locale: loc(c),
        // Rendered as a draft with id 0, so the form still posts to /people.
        person: null,
        draft: draftPerson(form, null),
        templates: listTemplates(db(), OWNER_ID),
        teams: listTeams(db(), OWNER_ID),
        teamDraft: team,
        error,
      }),
      422,
    );

  let input: PersonInput;
  try {
    input = parsePersonInput(form);
  } catch (err) {
    if (err instanceof UrlError) return showForm(errorMessage(loc(c), err));
    throw err;
  }
  if (input.full_name === "") return showForm(dict(loc(c)).people.nameRequired);

  // Checked before the person is written, so a bad team cannot leave a half-saved person.
  // A brand-new person holds no primary team yet, hence personId: null.
  if (team.teamId !== null) {
    try {
      assertAssignable(db(), team.teamId, null, team.isPrimary, OWNER_ID);
    } catch (err) {
      if (err instanceof TeamEditError) return showForm(errorMessage(loc(c), err));
      throw err;
    }
  }

  const person = createPerson(db(), input, OWNER_ID);
  if (team.teamId !== null) {
    addTeamMember(
      db(),
      {
        teamId: team.teamId, personId: person.id, isPrimary: team.isPrimary,
        onDate: today(user(c).timezone),
      },
      OWNER_ID,
    );
  }
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
  const id = Number.parseInt(c.req.param("id"), 10);
  const person = getPerson(db(), id, OWNER_ID);
  if (!person) return c.notFound();
  return c.html(personFormPage({
    locale: loc(c), person, templates: listTemplates(db(), OWNER_ID),
    teams: listTeams(db(), OWNER_ID), memberships: teamsForPerson(db(), id),
  }));
});

peopleRoutes.post("/people/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  const team = parseTeamAssignment(form);
  const showForm = (error: string) => {
    const person = getPerson(db(), id, OWNER_ID);
    if (!person) return c.notFound();
    return c.html(
      personFormPage({
        locale: loc(c), person, draft: draftPerson(form, person),
        templates: listTemplates(db(), OWNER_ID), teams: listTeams(db(), OWNER_ID),
        memberships: teamsForPerson(db(), id), teamDraft: team, error,
      }),
      422,
    );
  };

  let input: PersonInput;
  try {
    input = parsePersonInput(form);
  } catch (err) {
    if (err instanceof UrlError) return showForm(errorMessage(loc(c), err));
    throw err;
  }
  if (input.full_name === "") return showForm(dict(loc(c)).people.nameRequired);

  // The team goes first: a second primary team is refused, and refusing it after the
  // profile was already written would report an error over a save that did happen.
  if (team.teamId !== null) {
    try {
      addTeamMember(
        db(),
        {
          teamId: team.teamId, personId: id, isPrimary: team.isPrimary,
          onDate: today(user(c).timezone),
        },
        OWNER_ID,
      );
    } catch (err) {
      if (err instanceof TeamEditError) return showForm(errorMessage(loc(c), err));
      throw err;
    }
  }

  if (!updatePerson(db(), id, input, OWNER_ID)) return c.notFound();
  return c.redirect(`/people/${id}`, 303);
});

peopleRoutes.post("/people/:id/archive", (c) => {
  archivePerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  return c.redirect("/people", 303);
});

// The other half of archiving. Without it the archive is a delete with no warning, which
// is exactly what CLAUDE.md rule 5 exists to prevent. Same shape as /metrics/:id/restore.
peopleRoutes.post("/people/:id/restore", (c) => {
  restorePerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  return c.redirect("/people", 303);
});
