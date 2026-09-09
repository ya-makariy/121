import { Hono, type Context } from "hono";
import { thm } from "../middleware/theme.ts";
import { db } from "../db/index.ts";
import { getPerson } from "../db/queries/people.ts";
import { defaultTemplate, getFieldWithOptions, getTemplate, listTemplates, loadVersionStructure } from "../db/queries/templates.ts";
import {
  answeredFieldIds, completeMeeting, createMeeting, getMeeting, listAnswerOptionKeys,
  listAnswers, reopenMeeting, updateMeetingFields,
} from "../db/queries/meetings.ts";
import {
  actionsCreatedIn, createAction, deleteMeetingAction, openActions, recordActionReview,
} from "../db/queries/actions.ts";
import { listShareLinks } from "../db/queries/shares.ts";
import { meetingPage, newMeetingPage } from "../views/pages/meeting.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import { saveAnswer } from "../domain/answers.ts";
import { optionName, valueName, type AnswerValue } from "../views/components/field-input.ts";
import type { Assignee, MeetingRow, Visibility } from "../db/types.ts";
import { dict } from "../i18n/index.ts";
import { escapeHtml } from "../views/html.ts";
import { errorMessage } from "../i18n/index.ts";
import { SnapshotError } from "../lib/errors.ts";
import { agreementList } from "../views/components/meeting-agreements.ts";
import { parseDateInput } from "../lib/dates.ts";

export const meetingRoutes = new Hono();

function str(form: Record<string, unknown>, key: string): string | null {
  const v = form[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * A date as the field sends it, back to the canonical YYYY-MM-DD (rule 4).
 *
 * The app renders day-month-year because a native date control renders whatever the
 * browser feels like; parseDateInput is the one place that reading is undone, and it
 * accepts the canonical form too, so nothing that already worked stopped working.
 */
function date(form: Record<string, unknown>, key: string): string | null {
  const v = str(form, key);
  return v === null ? null : parseDateInput(v);
}

/** True when this request came from htmx and wants the fragment, not a redirect. */
function wantsPartial(c: Context): boolean {
  return c.req.header("HX-Request") !== undefined;
}

meetingRoutes.get("/people/:id/meetings/new", (c) => {
  const person = getPerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  if (!person) return c.notFound();
  return c.html(
    newMeetingPage({
      locale: loc(c), theme: thm(c),
      person,
      templates: listTemplates(db(), OWNER_ID),
      today: today(user(c).timezone),
    }),
  );
});

meetingRoutes.post("/people/:id/meetings", async (c) => {
  const personId = Number.parseInt(c.req.param("id"), 10);
  const person = getPerson(db(), personId, OWNER_ID);
  if (!person) return c.notFound();

  const form = await c.req.parseBody();
  const heldOn = date(form, "held_on") ?? today(user(c).timezone);
  const templateIdRaw = str(form, "template_id");

  // The meeting binds to the CURRENT template version and freezes it: any later edit to
  // the template forks the version, and this meeting stays exactly as it was.
  let versionId: number | null = null;
  if (templateIdRaw !== null) {
    const tpl = getTemplate(db(), Number.parseInt(templateIdRaw, 10))
      ?? defaultTemplate(db(), OWNER_ID);
    versionId = tpl?.current_version_id ?? null;
  }

  const meeting = createMeeting(
    db(), { person_id: personId, template_version_id: versionId, held_on: heldOn }, OWNER_ID,
  );
  return c.redirect(`/meetings/${meeting.id}`, 303);
});

meetingRoutes.get("/meetings/:id", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();
  const person = getPerson(db(), meeting.person_id, OWNER_ID);
  if (!person) return c.notFound();

  const sections = meeting.template_version_id === null
    ? []
    : loadVersionStructure(db(), meeting.template_version_id);

  const optionKeys = listAnswerOptionKeys(db(), id);
  const optionLabels = new Map<number, string>();
  for (const section of sections) {
    for (const field of section.fields) {
      const keys = optionKeys.get(field.id);
      if (!keys) continue;
      optionLabels.set(
        field.id,
        field.options.filter((o) => keys.includes(o.option_key)).map((o) => o.label).join(", "),
      );
    }
  }

  const answers = new Map<number, AnswerValue & { optionLabels?: string | null }>();
  for (const a of listAnswers(db(), id)) {
    answers.set(a.field_id, {
      num: a.num_value,
      text: a.text_value,
      date: a.date_value,
      bool: a.bool_value,
      optionKeys: optionKeys.get(a.field_id) ?? [],
      optionLabels: optionLabels.get(a.field_id) ?? null,
    });
  }

  return c.html(
    meetingPage({
      locale: loc(c), theme: thm(c),
      meeting,
      person,
      sections,
      answers,
      // Counted in SQL and handed to the view with the structure, never in the browser.
      answered: answeredFieldIds(db(), id),
      carryOver: openActions(db(), today(user(c).timezone), meeting.person_id, OWNER_ID)
        .filter((a) => a.created_meeting_id !== id),
      // What was agreed here, in the order it was agreed. openActions above answers a
      // different question and deliberately excludes these.
      agreements: actionsCreatedIn(db(), id),
      shares: listShareLinks(db(), id),
      today: today(user(c).timezone),
    }),
  );
});

/** Autosave for a single field. Returns a tiny partial for the saved indicator. */
meetingRoutes.patch("/meetings/:id/answers/:fieldId", async (c) => {
  const meetingId = Number.parseInt(c.req.param("id"), 10);
  const fieldId = Number.parseInt(c.req.param("fieldId"), 10);

  const meeting = getMeeting(db(), meetingId, OWNER_ID);
  if (!meeting) return c.notFound();
  const field = getFieldWithOptions(db(), fieldId);
  if (!field || field.version_id !== meeting.template_version_id) return c.notFound();

  const form = await c.req.parseBody({ all: true });
  const optionRaw = form[optionName(fieldId)];
  const optionKeys = optionRaw === undefined
    ? []
    : Array.isArray(optionRaw) ? optionRaw.map(String) : [String(optionRaw)];
  const value = form[valueName(fieldId)];

  saveAnswer(db(), meetingId, field, {
    value: value === undefined ? null : String(value),
    optionKeys,
  });

  return c.html(escapeHtml(dict(loc(c)).common.saved));
});

/**
 * Toggles whether this meeting counts as a 1:1 for cadence. Autosaves like an answer and
 * returns the same tiny "saved" partial.
 *
 * The flag narrows cadence arithmetic only (see db/queries/cadence.ts). The meeting keeps
 * its answers, its chart points and its summary: a five-minute check-in is still a
 * recorded conversation, it just must not push the next real 1:1 out by a full cadence.
 */
meetingRoutes.post("/meetings/:id/counts-for-cadence", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  // The form carries a hidden 0 alongside the box, so "off" arrives as a value rather
  // than as a missing key: an unchecked checkbox submits nothing at all.
  const form = await c.req.parseBody({ all: true });
  const raw = form["counts_for_cadence"];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw.map(String) : [String(raw)];
  const counts = values.includes("1") ? 1 : 0;

  updateMeetingFields(db(), id, { counts_for_cadence: counts }, OWNER_ID);
  return c.html(escapeHtml(dict(loc(c)).common.saved));
});

meetingRoutes.post("/meetings/:id/private-notes", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  updateMeetingFields(db(), id, { private_notes: str(form, "private_notes") }, OWNER_ID);
  return c.redirect(`/meetings/${id}`, 303);
});

/**
 * Writes down one agreement and answers with the running list.
 *
 * The answer is the list fragment, not a redirect: a 303 back to /meetings/:id reloaded a
 * page that can be 1600px long and dropped you at the top of it, having shown you nothing
 * of what you had just agreed. Without htmx the redirect is still there, so the form works
 * with scripting off.
 */
meetingRoutes.post("/meetings/:id/actions", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  const form = await c.req.parseBody();
  const title = str(form, "title");
  if (title !== null) {
    createAction(
      db(),
      {
        person_id: meeting.person_id,
        created_meeting_id: id,
        title,
        details: str(form, "details"),
        assignee: (str(form, "assignee") ?? "person") as Assignee,
        visibility: (str(form, "visibility") ?? "shared") as Visibility,
        due_on: date(form, "due_on"),
      },
      OWNER_ID,
    );
  }
  return respondWithAgreements(c, meeting);
});

/**
 * Drops an agreement raised in this meeting, while the meeting is still open.
 *
 * The guards that make this safe are in the SQL (queries/actions.ts:deleteMeetingAction);
 * the one added here is the meeting's own status, because a completed meeting's agreements
 * are entered and are closed with a status rather than deleted.
 */
meetingRoutes.post("/meetings/:id/actions/:actionId/delete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  if (meeting.status === "draft" || meeting.status === "scheduled") {
    deleteMeetingAction(db(), Number.parseInt(c.req.param("actionId"), 10), id, OWNER_ID);
  }
  return respondWithAgreements(c, meeting);
});

meetingRoutes.post("/meetings/:id/complete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  // Record what was reviewed in this meeting and the status it had at that moment.
  const reviewed = openActions(db(), today(user(c).timezone), meeting.person_id, OWNER_ID)
    .filter((a) => a.created_meeting_id !== id)
    .map((a) => ({ id: a.id, status: a.status }));
  recordActionReview(db(), id, reviewed);

  if (!completeMeeting(db(), id, OWNER_ID)) {
    return c.text(errorMessage(loc(c), new SnapshotError("MEETING_NO_DATE")), 422);
  }
  return c.redirect(`/meetings/${id}/share`, 303);
});

meetingRoutes.post("/meetings/:id/reopen", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  reopenMeeting(db(), id, OWNER_ID);
  return c.redirect(`/meetings/${id}`, 303);
});

/** The list fragment for htmx, the old redirect for a browser without it. */
function respondWithAgreements(c: Context, meeting: MeetingRow) {
  if (!wantsPartial(c)) return c.redirect(`/meetings/${meeting.id}`, 303);
  return c.html(
    agreementList({
      locale: loc(c),
      meetingId: meeting.id,
      actions: actionsCreatedIn(db(), meeting.id),
      editable: meeting.status === "draft" || meeting.status === "scheduled",
    }).value,
  );
}
