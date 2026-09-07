import { html } from "../html.ts";
import { layout, publicLayout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, MeetingRow, PersonRow, ShareLinkRow } from "../../db/types.ts";
import type { SharePayload } from "../../domain/snapshot.ts";
import { formatDate } from "../../i18n/dates.ts";
import { config } from "../../config.ts";

/** The manager-side page: build a snapshot, view it, download it, revoke it. */
export function sharePage(o: {
  locale: Locale;
  meeting: MeetingRow;
  person: PersonRow;
  shares: ShareLinkRow[];
  preview: SharePayload | null;
  markdown: string | null;
}): string {
  const t = dict(o.locale);
  const active = o.shares.find((s) => s.revoked_at === null);

  const body = html`
    <h1>${t.share.title}</h1>
    <p class="sub">
      ${o.person.full_name} · ${o.meeting.held_on ? formatDate(o.meeting.held_on, o.locale) : ""}
      · <a href="/meetings/${o.meeting.id}">${t.common.back}</a>
    </p>

    <div class="notice">${t.share.localOnly}</div>

    <form method="post" action="/meetings/${o.meeting.id}/share" class="actions-bar">
      <button class="primary" type="submit">${active ? t.share.rebuild : t.share.build}</button>
      <span class="small muted">${t.share.hint}</span>
    </form>

    ${active
      ? html`
          <h2>${t.share.created} ${formatDate(active.created_at.slice(0, 10), o.locale)}</h2>
          <div class="card">
            <div class="field">
              <label>${t.common.open}</label>
              <input type="text" readonly value="${config.baseUrl}/s/${active.token}" />
            </div>
            <div class="actions-bar">
              <a class="btn" href="/s/${active.token}" target="_blank">${t.common.open}</a>
              <a class="btn primary" href="/s/${active.token}.md?download=1">${t.share.downloadMd}</a>
              <span class="small muted">${active.view_count} ${t.share.views}</span>
              <form method="post" action="/shares/${active.id}/revoke">
                <input type="hidden" name="meeting_id" value="${o.meeting.id}" />
                <button class="danger" type="submit">${t.share.revoke}</button>
              </form>
            </div>
          </div>
        `
      : ""}

    ${o.markdown
      ? html`
          <h2>${t.share.copyMd}</h2>
          <pre class="md">${o.markdown}</pre>
        `
      : o.preview === null
        ? html`<div class="empty">${t.share.nothingShared}</div>`
        : ""}

    ${o.shares.filter((s) => s.revoked_at !== null).length > 0
      ? html`
          <h2>${t.share.revoked}</h2>
          <div class="rows">
            ${o.shares
              .filter((s) => s.revoked_at !== null)
              .map(
                (s) => html`
                  <div class="row">
                    <span class="grow small muted">
                      ${formatDate(s.created_at.slice(0, 10), o.locale)} · ${s.view_count} ${t.share.views}
                    </span>
                    <span class="badge neutral">${t.share.revoked}</span>
                  </div>
                `,
              )}
          </div>
        `
      : ""}
  `;

  return layout({
    locale: o.locale, title: t.share.title, nav: "people",
    path: `/meetings/${o.meeting.id}/share`, body,
  });
}

/**
 * The public summary page. Rendered FROM THE SNAPSHOT, not from live data: the mentee sees
 * exactly what was assembled at the moment of sharing.
 */
export function publicSharePage(payload: SharePayload): string {
  const t = dict(payload.locale);

  const body = html`
    <h1>${t.share.forPerson} ${payload.personName}</h1>
    <p class="sub">
      ${formatDate(payload.heldOn, payload.locale)}
      ${payload.title ? html` · ${payload.title}` : ""}
    </p>

    ${payload.sections.map((section) => {
      const items = section.items.filter(
        (i) =>
          i.scale !== null || i.options !== null || i.checked !== null || i.date !== null ||
          (i.text !== null && i.text.trim() !== ""),
      );
      if (items.length === 0) return "";
      return html`
        <h2>${section.title}</h2>
        <div class="card">
          ${items.map(
            (i) => html`
              <div class="snapshot-item">
                <div class="q">${i.label}</div>
                <div class="a">
                  ${i.scale
                    ? html`<span class="scale-readout">${i.scale.value} ${t.common.of} ${i.scale.max}</span>${
                        i.scale.value === i.scale.min && i.scale.minLabel
                          ? html` <span class="muted">(${i.scale.minLabel})</span>`
                          : i.scale.value === i.scale.max && i.scale.maxLabel
                            ? html` <span class="muted">(${i.scale.maxLabel})</span>`
                            : ""
                      }`
                    : i.options
                      ? html`${i.options}`
                      : i.checked !== null
                        ? html`${i.checked ? t.common.yes : t.common.no}`
                        : i.date
                          ? html`${formatDate(i.date, payload.locale)}`
                          : html`${i.text}`}
                </div>
              </div>
            `,
          )}
        </div>
      `;
    })}

    ${payload.actions.length > 0
      ? html`
          <h2>${t.share.agreements}</h2>
          <div class="card">
            <ul class="check">
              ${payload.actions.map(
                (a) => html`
                  <li class="${a.status === "done" || a.status === "dropped" ? "done" : ""}">
                    ${a.status === "done" ? "☑" : "☐"} ${a.title}
                    <span class="small muted">
                      · ${a.assignee === "manager" ? t.meeting.assigneeManager
                        : a.assignee === "person" ? t.meeting.assigneePerson
                        : t.meeting.assigneeBoth}
                      ${a.dueOn ? html` · ${t.meeting.dueOn} ${formatDate(a.dueOn, payload.locale)}` : ""}
                    </span>
                    ${a.details ? html`<div class="small muted">${a.details}</div>` : ""}
                  </li>
                `,
              )}
            </ul>
          </div>
        `
      : ""}

    <p class="small muted">${t.share.generated}: ${payload.generatedAt.slice(0, 10)}</p>
  `;

  return publicLayout({
    locale: payload.locale,
    title: `${t.share.forPerson} ${payload.personName}`,
    body,
  });
}

export function shareNotFoundPage(locale: Locale): string {
  const t = dict(locale);
  return publicLayout({
    locale,
    title: t.share.notFound,
    body: html`<div class="empty">${t.share.notFound}</div>`,
  });
}
