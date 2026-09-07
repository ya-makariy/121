import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale } from "../../db/types.ts";
import type { PersonCadence } from "../../db/queries/cadence.ts";
import type { OpenActionRow } from "../../db/queries/actions.ts";
import { formatDate } from "../../i18n/dates.ts";

function cadenceLine(p: PersonCadence, t: ReturnType<typeof dict>): string {
  if (p.status === "no_cadence") {
    return p.lastHeldOn
      ? `${t.dashboard.lastMeeting}: ${p.daysSinceLast} ${t.dashboard.days} ${t.dashboard.daysAgo}`
      : t.dashboard.neverMet;
  }
  if (p.status === "overdue") {
    return `${t.dashboard.overdueBy} ${Math.abs(p.daysUntilDue!)} ${t.dashboard.days}`;
  }
  return `${t.dashboard.dueIn} ${p.daysUntilDue} ${t.dashboard.days}`;
}

export function dashboardPage(o: {
  locale: Locale;
  people: PersonCadence[];
  actions: OpenActionRow[];
}): string {
  const t = dict(o.locale);

  const body = html`
    <h1>${t.dashboard.title}</h1>
    <p class="sub">${t.tagline}</p>

    ${o.people.length === 0
      ? html`
          <div class="empty">
            <p>${t.dashboard.emptyPeople}</p>
            <a class="btn primary" href="/people/new">${t.common.add}</a>
          </div>
        `
      : html`
          <h2>${t.dashboard.cadence}</h2>
          <div class="rows">
            ${o.people.map(
              (p) => html`
                <div class="row">
                  <span class="badge ${p.status}">
                    ${p.status === "overdue" ? t.dashboard.overdue
                      : p.status === "due_soon" ? t.dashboard.dueSoon
                      : p.status === "ok" ? t.dashboard.ok
                      : t.dashboard.noCadence}
                  </span>
                  <span class="grow">
                    <a class="name" href="/people/${p.id}">${p.full_name}</a>
                    <span class="small muted"> · ${cadenceLine(p, t)}</span>
                    ${p.next_scheduled_at
                      ? html`<span class="small muted"> · ${t.dashboard.scheduled}</span>`
                      : ""}
                    ${p.open_actions > 0
                      ? html`<span class="small muted"> · ${p.open_actions} ${t.actions.title.toLowerCase()}</span>`
                      : ""}
                  </span>
                  <a class="btn" href="/people/${p.id}/meetings/new">${t.dashboard.startMeeting}</a>
                </div>
              `,
            )}
          </div>
        `}

    <h2>${t.dashboard.openActions}</h2>
    ${o.actions.length === 0
      ? html`<div class="empty">${t.dashboard.noOpenActions}</div>`
      : html`
          <div class="rows">
            ${o.actions.slice(0, 12).map(
              (a) => html`
                <div class="row">
                  ${a.is_late === 1 ? html`<span class="badge overdue">${t.actions.late}</span>` : ""}
                  <span class="grow">
                    ${a.title}
                    <span class="small muted">
                      · <a href="/people/${a.person_id}">${a.full_name}</a>
                      ${a.due_on ? html` · ${t.meeting.dueOn} ${formatDate(a.due_on, o.locale)}` : ""}
                    </span>
                  </span>
                  <form method="post" action="/actions/${a.id}/status">
                    <input type="hidden" name="status" value="done" />
                    <input type="hidden" name="return_to" value="/" />
                    <button class="link" type="submit">${t.actions.markDone}</button>
                  </form>
                </div>
              `,
            )}
          </div>
          ${o.actions.length > 12
            ? html`<p class="small"><a href="/actions">${t.actions.title} →</a></p>`
            : ""}
        `}
  `;

  return layout({ locale: o.locale, title: t.dashboard.title, nav: "dashboard", path: "/", body });
}
