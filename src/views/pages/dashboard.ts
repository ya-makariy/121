import { classes, html, type Raw } from "../html.ts";
import type { Theme } from "../../lib/theme.ts";
import { layout } from "../layout.ts";
import { dict, format, plural, pluralForm } from "../../i18n/index.ts";
import type { Locale } from "../../db/types.ts";
import type { CadenceOverview, PersonCadence } from "../../db/queries/cadence.ts";
import type { CadenceStatus } from "../../domain/cadence.ts";
import type { OpenActionRow } from "../../db/queries/actions.ts";
import type { UpcomingBirthday } from "../../db/queries/people.ts";
import { formatDate, formatDayMonth } from "../../i18n/dates.ts";
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

/**
 * "today!", "tomorrow", "in 5 days · 14 November". The day itself is named from the third
 * day on: "in 5 days" alone sends the reader to a calendar, and the reminder exists so they
 * need not open one.
 */
function birthdayWhen(b: UpcomingBirthday, locale: Locale, t: ReturnType<typeof dict>): string {
  if (b.daysUntil === 0) return t.dashboard.birthdayToday;
  if (b.daysUntil === 1) return t.dashboard.birthdayTomorrow;
  const [, month, day] = b.on.split("-").map((x) => Number.parseInt(x, 10)) as [number, number, number];
  const when = format(t.dashboard.birthdayIn, {
    days: b.daysUntil, unit: pluralForm(locale, b.daysUntil, t.dashboard.dayForms),
  });
  return `${when} · ${formatDayMonth(month, day, locale)}`;
}

/**
 * The reminder block. Rendered only when someone's birthday is within the window: an empty
 * "no birthdays" line every day would train the eye to skip the block on the day it matters.
 */
function birthdaysBlock(
  birthdays: UpcomingBirthday[], locale: Locale, t: ReturnType<typeof dict>,
): Raw | "" {
  if (birthdays.length === 0) return "";
  return html`
    <div class="group birthdays">
      <div class="group-head">
        <h3><span aria-hidden="true">\u{1F382}</span> ${t.dashboard.birthdays}</h3>
        <span class="count">${birthdays.length}</span>
      </div>
      <div class="rows">
        ${birthdays.map(
          (b) => html`
            <div class="row">
              <span class="${classes("badge", b.daysUntil === 0 ? "birthday_today" : "neutral")}">
                ${birthdayWhen(b, locale, t)}
              </span>
              <span class="grow">
                <a class="name" href="/people/${b.id}">${b.full_name}</a>
                ${b.turning !== null
                  ? html`<span class="small muted"> · ${format(t.people.turns, { age: b.turning })}</span>`
                  : ""}
              </span>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

export function dashboardPage(o: {
  locale: Locale; theme: Theme;
  cadence: CadenceOverview;
  actions: OpenActionRow[];
  /** Whose birthday is within config.birthdayWindowDays, soonest first. */
  birthdays: UpcomingBirthday[];
  /** Today in the owner's timezone, from domain/cadence.ts:todayInTz(). */
  today: string;
}): string {
  const t = dict(o.locale);
  const c = o.cadence;

  const body = html`
    <h1>${t.dashboard.title}</h1>
    <p class="sub">${format(t.dashboard.todayIs, { date: formatDate(o.today, o.locale) })}</p>

    ${birthdaysBlock(o.birthdays, o.locale, t)}

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

  return layout({ locale: o.locale, theme: o.theme, title: t.dashboard.title, nav: "dashboard", path: "/", body });
}
