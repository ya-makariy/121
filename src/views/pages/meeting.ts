import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type {
  Locale, MeetingRow, PersonRow, SectionWithFields, ShareLinkRow, TemplateRow,
} from "../../db/types.ts";
import type { OpenActionRow } from "../../db/queries/actions.ts";
import { fieldInput, fieldReadout, type AnswerValue, EMPTY_ANSWER } from "../components/field-input.ts";
import { formatDate } from "../../lib/dates.ts";

export function newMeetingPage(o: {
  locale: Locale; person: PersonRow; templates: TemplateRow[]; today: string;
}): string {
  const t = dict(o.locale);
  const preselected = o.person.default_template_id
    ?? o.templates.find((x) => x.is_default === 1)?.id
    ?? o.templates[0]?.id;

  const body = html`
    <h1>${t.meeting.newTitle}</h1>
    <p class="sub">${o.person.full_name}</p>
    <form method="post" action="/people/${o.person.id}/meetings" class="card">
      <div class="grid2">
        <div class="field">
          <label for="held_on">${t.meeting.heldOn}</label>
          <input type="date" id="held_on" name="held_on" value="${o.today}" required />
        </div>
        <div class="field">
          <label for="template_id">${t.meeting.template}</label>
          <select id="template_id" name="template_id">
            ${o.templates.map(
              (tpl) => html`
                <option value="${tpl.id}" ${tpl.id === preselected ? "selected" : ""}>
                  ${tpl.name}
                </option>
              `,
            )}
            <option value="">${t.meeting.freeform}</option>
          </select>
        </div>
      </div>
      <div class="actions-bar">
        <button class="primary" type="submit">${t.common.add}</button>
        <a class="btn" href="/people/${o.person.id}">${t.common.cancel}</a>
      </div>
    </form>
  `;

  return layout({
    locale: o.locale, title: t.meeting.newTitle, nav: "people",
    path: `/people/${o.person.id}/meetings/new`, body,
  });
}

export function meetingPage(o: {
  locale: Locale;
  meeting: MeetingRow;
  person: PersonRow;
  sections: SectionWithFields[];
  answers: Map<number, AnswerValue & { optionLabels?: string | null }>;
  carryOver: OpenActionRow[];
  shares: ShareLinkRow[];
  today: string;
}): string {
  const t = dict(o.locale);
  const m = o.meeting;
  const editable = m.status === "draft" || m.status === "scheduled";
  const activeShare = o.shares.find((s) => s.revoked_at === null);

  const body = html`
    <h1>${o.person.full_name}</h1>
    <p class="sub">
      ${m.held_on ? formatDate(m.held_on, o.locale) : ""}
      · <span class="badge ${m.status === "completed" ? "ok" : "neutral"}">
          ${m.status === "completed" ? t.meeting.completed : t.meeting.draft}
        </span>
      · <a href="/people/${o.person.id}">${o.person.full_name}</a>
    </p>

    <!-- Перенос вычисляется на чтении, а не копируется строками. -->
    <h2>${t.meeting.carryOver}</h2>
    ${o.carryOver.length === 0
      ? html`<div class="empty">${t.meeting.carryOverEmpty}</div>`
      : html`
          <div class="rows">
            ${o.carryOver.map(
              (a) => html`
                <div class="row">
                  ${a.is_late === 1 ? html`<span class="badge overdue">${t.actions.late}</span>` : ""}
                  <span class="grow">
                    ${a.title}
                    ${a.raised_on
                      ? html`<span class="small muted"> · ${t.actions.raisedOn} ${formatDate(a.raised_on, o.locale)}</span>`
                      : ""}
                    ${a.visibility === "private"
                      ? html` <span class="badge private">${t.templates.visibilityPrivate}</span>`
                      : ""}
                  </span>
                  <form method="post" action="/actions/${a.id}/status">
                    <input type="hidden" name="status" value="done" />
                    <input type="hidden" name="meeting_id" value="${m.id}" />
                    <input type="hidden" name="return_to" value="/meetings/${m.id}" />
                    <button class="link" type="submit">${t.actions.markDone}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `}

    ${o.sections.map((section) => {
      const isPrivateSection = section.fields.length > 0
        && section.fields.every((f) => f.visibility === "private");
      const rendered = editable
        ? section.fields.map((f) =>
            fieldInput(f, o.answers.get(f.id) ?? EMPTY_ANSWER, m.id, o.locale))
        : section.fields
            .map((f) => fieldReadout(f, o.answers.get(f.id) ?? EMPTY_ANSWER, o.locale))
            .filter((x) => x !== null);

      if (!editable && rendered.length === 0) return "";

      return html`
        <div class="section-head">
          <h2>${section.title}</h2>
          ${isPrivateSection
            ? html`<span class="badge private">${t.meeting.privateSection}</span>`
            : ""}
        </div>
        ${section.description ? html`<p class="section-desc">${section.description}</p>` : ""}
        <div class="card ${isPrivateSection ? "private" : ""}">${rendered}</div>
      `;
    })}

    <h2>${t.meeting.newAction}</h2>
    <form method="post" action="/meetings/${m.id}/actions" class="card">
      <div class="field">
        <label for="title">${t.meeting.actionTitle}</label>
        <input type="text" id="title" name="title" required />
      </div>
      <div class="grid2">
        <div class="field">
          <label for="assignee">${t.meeting.assignee}</label>
          <select id="assignee" name="assignee">
            <option value="person">${t.meeting.assigneePerson}</option>
            <option value="manager">${t.meeting.assigneeManager}</option>
            <option value="both">${t.meeting.assigneeBoth}</option>
          </select>
        </div>
        <div class="field">
          <label for="due_on">${t.meeting.dueOn}</label>
          <input type="date" id="due_on" name="due_on" />
        </div>
      </div>
      <div class="field">
        <label for="visibility">${t.meeting.actionVisibility}</label>
        <select id="visibility" name="visibility">
          <option value="shared">${t.meeting.visibilityShared}</option>
          <option value="private">${t.meeting.visibilityPrivate}</option>
        </select>
      </div>
      <button class="primary" type="submit">${t.common.add}</button>
    </form>

    <h2>${t.meeting.privateNotes}</h2>
    <form method="post" action="/meetings/${m.id}/private-notes" class="card private">
      <div class="field">
        <label for="private_notes"><span class="hint">${t.meeting.privateHint}</span></label>
        <textarea id="private_notes" name="private_notes">${m.private_notes ?? ""}</textarea>
      </div>
      <button type="submit">${t.common.save}</button>
    </form>

    <div class="actions-bar">
      ${m.status === "completed"
        ? html`
            <form method="post" action="/meetings/${m.id}/reopen">
              <button type="submit">${t.meeting.reopen}</button>
            </form>
            <a class="btn primary" href="/meetings/${m.id}/share">${t.meeting.share}</a>
          `
        : html`
            <form method="post" action="/meetings/${m.id}/complete">
              <button class="primary" type="submit">${t.meeting.complete}</button>
            </form>
            <span class="small muted">${t.meeting.completeHint}</span>
          `}
      ${activeShare
        ? html`<a class="btn" href="/meetings/${m.id}/share">${t.share.title}</a>`
        : ""}
    </div>
  `;

  return layout({
    locale: o.locale,
    title: `${o.person.full_name} · ${m.held_on ?? ""}`,
    nav: "people",
    path: `/meetings/${m.id}`,
    body,
  });
}
