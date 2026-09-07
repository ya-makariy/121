import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, PersonRow, TemplateRow } from "../../db/types.ts";
import { joinLink } from "../components/join-link.ts";

export function peopleListPage(o: {
  locale: Locale; people: PersonRow[];
}): string {
  const t = dict(o.locale);
  const body = html`
    <h1>${t.people.title}</h1>
    <p class="sub"><a class="btn primary" href="/people/new">${t.common.add}</a></p>
    ${o.people.length === 0
      ? html`<div class="empty">${t.people.empty}</div>`
      : html`
          <div class="rows">
            ${o.people.map(
              (p) => html`
                <div class="row">
                  <span class="grow">
                    <a class="name" href="/people/${p.id}">${p.full_name}</a>
                    ${p.role_title ? html`<span class="small muted"> · ${p.role_title}</span>` : ""}
                  </span>
                  ${p.cadence_days
                    ? html`<span class="small muted">${p.cadence_days} ${t.dashboard.days}</span>`
                    : html`<span class="small muted">${t.dashboard.noCadence}</span>`}
                  ${joinLink(p.meeting_url, o.locale, { short: true })}
                  <a class="btn" href="/people/${p.id}/edit">${t.common.edit}</a>
                </div>
              `,
            )}
          </div>
        `}
  `;
  return layout({ locale: o.locale, title: t.people.title, nav: "people", path: "/people", body });
}

export function personFormPage(o: {
  locale: Locale;
  person: PersonRow | null;
  /** What to put in the inputs when a save failed: the submitted values, not the stored ones. */
  draft?: PersonRow;
  templates: TemplateRow[];
  error?: string;
}): string {
  const t = dict(o.locale);
  const p = o.draft ?? o.person;
  const action = o.person ? `/people/${o.person.id}` : "/people";

  const body = html`
    <h1>${o.person ? t.people.editTitle : t.people.addTitle}</h1>
    ${o.error ? html`<div class="notice error">${o.error}</div>` : ""}
    <form method="post" action="${action}" class="card">
      <div class="field">
        <label for="full_name">${t.people.fullName}</label>
        <input type="text" id="full_name" name="full_name" required
               value="${p?.full_name ?? ""}" autofocus />
      </div>
      <div class="grid2">
        <div class="field">
          <label for="role_title">${t.people.roleTitle}</label>
          <input type="text" id="role_title" name="role_title" value="${p?.role_title ?? ""}" />
        </div>
        <div class="field">
          <label for="email">${t.people.email}</label>
          <input type="email" id="email" name="email" value="${p?.email ?? ""}" />
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="cadence_days">
            ${t.people.cadenceDays}
            <span class="hint">${t.people.cadenceHint}</span>
          </label>
          <input type="number" id="cadence_days" name="cadence_days" min="1" max="365"
                 value="${p?.cadence_days ?? 14}" />
        </div>
        <div class="field">
          <label for="cadence_anchor_on">
            ${t.people.anchor}
            <span class="hint">${t.people.anchorHint}</span>
          </label>
          <input type="date" id="cadence_anchor_on" name="cadence_anchor_on"
                 value="${p?.cadence_anchor_on ?? ""}" />
        </div>
      </div>
      <div class="field">
        <label for="meeting_url">
          ${t.people.meetingUrl}
          <span class="hint">${t.people.meetingUrlHint}</span>
        </label>
        <input type="text" id="meeting_url" name="meeting_url" inputmode="url"
               placeholder="meet.google.com/abc-defg-hij" value="${p?.meeting_url ?? ""}" />
      </div>
      <div class="field">
        <label for="default_template_id">${t.people.defaultTemplate}</label>
        <select id="default_template_id" name="default_template_id">
          <option value="">${t.common.none}</option>
          ${o.templates.map(
            (tpl) => html`
              <option value="${tpl.id}" ${p?.default_template_id === tpl.id ? "selected" : ""}>
                ${tpl.name}
              </option>
            `,
          )}
        </select>
      </div>
      <div class="field">
        <label for="notes">
          ${t.people.notes}
          <span class="hint">${t.people.notesHint}</span>
        </label>
        <textarea id="notes" name="notes">${p?.notes ?? ""}</textarea>
      </div>
      <div class="actions-bar">
        <button class="primary" type="submit">${t.common.save}</button>
        <a class="btn" href="${o.person ? `/people/${o.person.id}` : "/people"}">${t.common.cancel}</a>
      </div>
    </form>
    ${o.person
      ? html`
          <form method="post" action="/people/${o.person.id}/archive" class="actions-bar">
            <button class="danger" type="submit">${t.common.archive}</button>
          </form>
        `
      : ""}
  `;

  return layout({
    locale: o.locale,
    title: o.person ? t.people.editTitle : t.people.addTitle,
    nav: "people",
    path: o.person ? `/people/${o.person.id}/edit` : "/people/new",
    body,
  });
}
