import { classes, html, type Raw } from "../html.ts";
import { layout } from "../layout.ts";
import { dict, format, plural, pluralForm } from "../../i18n/index.ts";
import type { Locale } from "../../db/types.ts";
import type { CadenceOverview, PersonCadence } from "../../db/queries/cadence.ts";
import type { CadenceStatus } from "../../domain/cadence.ts";
import type { OpenActionRow } from "../../db/queries/actions.ts";
import { formatDate } from "../../i18n/dates.ts";
import { joinLink } from "../components/join-link.ts";

/**
 * The tone of a group, as a class name. Presentation only: the grouping itself and its
 * order arrive from db/queries/cadence.ts. "ok" and "no_cadence" are deliberately plain —
 * if everything is coloured, nothing is.
 */
const GROUP_TONE: Record<CadenceStatus, string> = {
  overdue: "attention",
  due_soon: "soon",
  ok: "",
  no_cadence: "",
};

function cadenceLine(p: PersonCadence, t: ReturnType<typeof dict>): string {
  if (p.status === "no_cadence") {
    return p.lastHeldOn
      ? `${t.dashboard.lastMeeting}: ${p.daysSinceLast} ${t.dashboard.daysAgo}`
      : t.dashboard.neverMet;
  }
  if (p.status === "overdue") {
    return `${t.dashboard.overdueBy} ${Math.abs(p.daysUntilDue!)} ${t.dashboard.days}`;
  }
  return `${t.dashboard.dueIn} ${p.daysUntilDue} ${t.dashboard.days}`;
}

/**
 * `primary` is true only inside the overdue group. A page where every row offers the same
 * filled button offers no advice at all: the one call to action is the meeting that is
 * already late.
 */
function personRow(
  p: PersonCadence, locale: Locale, t: ReturnType<typeof dict>, primary: boolean,
): Raw {
  return html`
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
          ? html`<span class="small muted"> · ${
              plural(locale, p.open_actions, t.dashboard.openActionForms)
            }</span>`
          : ""}
      </span>
      ${joinLink(p.meeting_url, locale, { short: true })}
      <a class="${classes("btn", primary && "primary")}"
         href="/people/${p.id}/meetings/new">${t.dashboard.startMeeting}</a>
    </div>
  `;
}

export function dashboardPage(o: {
  locale: Locale;
  cadence: CadenceOverview;
  actions: OpenActionRow[];
  /** Today in the owner's timezone, from domain/cadence.ts:todayInTz(). */
  today: string;
}): string {
  const t = dict(o.locale);
  const c = o.cadence;

  const body = html`
    <h1>${t.dashboard.title}</h1>
    <p class="sub">${t.tagline}</p>

    ${c.total === 0
      ? html`
          <div class="empty">
            <p>${t.dashboard.emptyPeople}</p>
            <a class="btn primary" href="/people/new">${t.common.add}</a>
          </div>
        `
      : html`
          <p class="headline">
            <span><strong>${c.total}</strong> ${pluralForm(o.locale, c.total, t.dashboard.peopleForms)}</span>
            <span><strong>${c.waiting}</strong> ${pluralForm(o.locale, c.waiting, t.dashboard.waitingForms)}</span>
            <span><strong>${o.actions.length}</strong> ${pluralForm(o.locale, o.actions.length, t.dashboard.openActionForms)}</span>
            <span>${format(t.dashboard.todayIs, { date: formatDate(o.today, o.locale) })}</span>
          </p>

          ${c.groups.map(
            (g) => html`
              <div class="${classes("group", GROUP_TONE[g.key])}">
                <div class="group-head">
                  <h3>${t.dashboard.groupTitle[g.key]}</h3>
                  <span class="count">${g.people.length}</span>
                </div>
                <div class="rows">
                  ${g.people.map((p) => personRow(p, o.locale, t, g.key === "overdue"))}
                </div>
              </div>
            `,
          )}
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
