import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, MeetingRow, MetricRow, PersonRow, ActionItemRow } from "../../db/types.ts";
import type { PersonCadence } from "../../db/queries/cadence.ts";
import { formatDate } from "../../i18n/dates.ts";
import { joinLink } from "../components/join-link.ts";

export function personPage(o: {
  locale: Locale;
  person: PersonRow;
  cadence: PersonCadence | null;
  meetings: MeetingRow[];
  actions: ActionItemRow[];
  metrics: MetricRow[];
}): string {
  const t = dict(o.locale);
  const p = o.person;

  const statusLabel = (m: MeetingRow) =>
    m.status === "completed" ? t.meeting.completed
    : m.status === "scheduled" ? t.meeting.scheduled
    : m.status === "cancelled" ? t.meeting.cancelled
    : t.meeting.draft;

  const body = html`
    <h1>${p.full_name}</h1>
    <p class="sub">
      ${p.role_title ? html`${p.role_title} · ` : ""}
      ${o.cadence && o.cadence.status !== "no_cadence"
        ? html`<span class="badge ${o.cadence.status}">${
            o.cadence.status === "overdue" ? t.dashboard.overdue
            : o.cadence.status === "due_soon" ? t.dashboard.dueSoon
            : t.dashboard.ok
          }</span>`
        : html`<span class="badge no_cadence">${t.dashboard.noCadence}</span>`}
      · <a href="/people/${p.id}/edit">${t.common.edit}</a>
    </p>

    <p class="actions-bar">
      <a class="btn primary" href="/people/${p.id}/meetings/new">${t.dashboard.startMeeting}</a>
      ${joinLink(p.meeting_url, o.locale)}
    </p>

    <h2>${t.people.dynamics}</h2>
    ${o.metrics.length === 0
      ? html`<div class="empty">${t.people.noDynamics}</div>`
      : html`
          <div class="card">
            <div class="field">
              <label for="metric-pick">${t.templates.metric}</label>
              <select id="metric-pick">
                ${o.metrics.map((m) => html`<option value="${m.key}">${m.label}</option>`)}
              </select>
            </div>
            <div class="chart-wrap"><canvas id="metric-chart"
              data-person="${p.id}"
              data-load-failed="${t.charts.loadFailed}"
              data-src="/api/charts/person/${p.id}/metric/"></canvas></div>
            <p class="chart-note" id="chart-note"></p>
          </div>
          <script src="/vendor/chart.umd.min.js"></script>
          <script src="/metric-chart.js"></script>
        `}

    <h2>${t.people.meetings}</h2>
    ${o.meetings.length === 0
      ? html`<div class="empty">${t.people.noMeetings}</div>`
      : html`
          <div class="rows">
            ${o.meetings.map(
              (m) => html`
                <div class="row">
                  <span class="grow">
                    <a class="name" href="/meetings/${m.id}">
                      ${m.held_on ? formatDate(m.held_on, o.locale) : t.common.none}
                    </a>
                    ${m.title ? html`<span class="small muted"> · ${m.title}</span>` : ""}
                  </span>
                  <span class="badge ${m.status === "completed" ? "ok" : "neutral"}">
                    ${statusLabel(m)}
                  </span>
                </div>
              `,
            )}
          </div>
        `}

    <h2>${t.actions.title}</h2>
    ${o.actions.length === 0
      ? html`<div class="empty">${t.actions.empty}</div>`
      : html`
          <div class="rows">
            ${o.actions.map(
              (a) => html`
                <div class="row">
                  <span class="grow ${a.status === "done" || a.status === "dropped" ? "done" : ""}">
                    ${a.title}
                    ${a.due_on ? html`<span class="small muted"> · ${formatDate(a.due_on, o.locale)}</span>` : ""}
                    ${a.visibility === "private"
                      ? html` <span class="badge private">${t.templates.visibilityPrivate}</span>`
                      : ""}
                  </span>
                  ${a.status === "open" || a.status === "in_progress"
                    ? html`
                        <form method="post" action="/actions/${a.id}/status">
                          <input type="hidden" name="status" value="done" />
                          <input type="hidden" name="return_to" value="/people/${p.id}" />
                          <button class="link" type="submit">${t.actions.markDone}</button>
                        </form>
                      `
                    : html`<span class="small muted">${
                        a.status === "done" ? t.actions.statusDone : t.actions.statusDropped
                      }</span>`}
                </div>
              `,
            )}
          </div>
        `}

    ${p.notes
      ? html`
          <h2>${t.people.notes}</h2>
          <div class="card private">
            <p class="small muted">${t.people.notesHint}</p>
            <div class="a" style="white-space: pre-wrap">${p.notes}</div>
          </div>
        `
      : ""}
  `;

  return layout({
    locale: o.locale, title: p.full_name, nav: "people", path: `/people/${p.id}`, body,
  });
}
