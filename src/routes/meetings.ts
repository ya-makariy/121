import { Hono } from "hono";
import { db } from "../db/index.ts";
import { getPerson } from "../db/queries/people.ts";
import { defaultTemplate, getFieldWithOptions, getTemplate, listTemplates, loadVersionStructure } from "../db/queries/templates.ts";
import {
  completeMeeting, createMeeting, getMeeting, listAnswerOptionKeys, listAnswers,
  reopenMeeting, updateMeetingFields,
} from "../db/queries/meetings.ts";
import { createAction, openActions, recordActionReview } from "../db/queries/actions.ts";
import { listShareLinks } from "../db/queries/shares.ts";
import { meetingPage, newMeetingPage } from "../views/pages/meeting.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID, user } from "../middleware/current-user.ts";
import { today } from "../domain/cadence.ts";
import { saveAnswer } from "../domain/answers.ts";
import type { AnswerValue } from "../views/components/field-input.ts";
import type { Assignee, Visibility } from "../db/types.ts";
import { dict } from "../i18n/index.ts";
import { escapeHtml } from "../views/html.ts";

export const meetingRoutes = new Hono();

function str(form: Record<string, unknown>, key: string): string | null {
  const v = form[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

meetingRoutes.get("/people/:id/meetings/new", (c) => {
  const person = getPerson(db(), Number.parseInt(c.req.param("id"), 10), OWNER_ID);
  if (!person) return c.notFound();
  return c.html(
    newMeetingPage({
      locale: loc(c),
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
  const heldOn = str(form, "held_on") ?? today(user(c).timezone);
  const templateIdRaw = str(form, "template_id");

  // Встреча привязывается к ТЕКУЩЕЙ версии шаблона и замораживает её:
  // дальнейшая правка шаблона форкает версию, а эта встреча остаётся как была.
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
      locale: loc(c),
      meeting,
      person,
      sections,
      answers,
      carryOver: openActions(db(), today(user(c).timezone), meeting.person_id, OWNER_ID)
        .filter((a) => a.created_meeting_id !== id),
      shares: listShareLinks(db(), id),
      today: today(user(c).timezone),
    }),
  );
});

/** Автосохранение одного поля. Отдаёт крошечный партиал в индикатор состояния. */
meetingRoutes.patch("/meetings/:id/answers/:fieldId", async (c) => {
  const meetingId = Number.parseInt(c.req.param("id"), 10);
  const fieldId = Number.parseInt(c.req.param("fieldId"), 10);

  const meeting = getMeeting(db(), meetingId, OWNER_ID);
  if (!meeting) return c.notFound();
  const field = getFieldWithOptions(db(), fieldId);
  if (!field || field.version_id !== meeting.template_version_id) return c.notFound();

  const form = await c.req.parseBody({ all: true });
  const optionRaw = form["option"];
  const optionKeys = optionRaw === undefined
    ? []
    : Array.isArray(optionRaw) ? optionRaw.map(String) : [String(optionRaw)];
  const value = form["value"];

  saveAnswer(db(), meetingId, field, {
    value: value === undefined ? null : String(value),
    optionKeys,
  });

  return c.html(escapeHtml(dict(loc(c)).common.saved));
});

meetingRoutes.post("/meetings/:id/private-notes", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  updateMeetingFields(db(), id, { private_notes: str(form, "private_notes") }, OWNER_ID);
  return c.redirect(`/meetings/${id}`, 303);
});

meetingRoutes.post("/meetings/:id/actions", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  const form = await c.req.parseBody();
  const title = str(form, "title");
  if (title === null) return c.redirect(`/meetings/${id}`, 303);

  createAction(
    db(),
    {
      person_id: meeting.person_id,
      created_meeting_id: id,
      title,
      details: str(form, "details"),
      assignee: (str(form, "assignee") ?? "person") as Assignee,
      visibility: (str(form, "visibility") ?? "shared") as Visibility,
      due_on: str(form, "due_on"),
    },
    OWNER_ID,
  );
  return c.redirect(`/meetings/${id}`, 303);
});

meetingRoutes.post("/meetings/:id/complete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  // Фиксируем, что разобрали на встрече и в каком статусе это было на тот момент.
  const reviewed = openActions(db(), today(user(c).timezone), meeting.person_id, OWNER_ID)
    .filter((a) => a.created_meeting_id !== id)
    .map((a) => ({ id: a.id, status: a.status }));
  recordActionReview(db(), id, reviewed);

  if (!completeMeeting(db(), id, OWNER_ID)) {
    return c.text("У встречи не указана дата — завершить нельзя", 422);
  }
  return c.redirect(`/meetings/${id}/share`, 303);
});

meetingRoutes.post("/meetings/:id/reopen", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  reopenMeeting(db(), id, OWNER_ID);
  return c.redirect(`/meetings/${id}`, 303);
});
