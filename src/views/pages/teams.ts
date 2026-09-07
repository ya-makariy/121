import { html } from "../html.ts";
import type { Theme } from "../../lib/theme.ts";
import { layout } from "../layout.ts";
import { dict, plural } from "../../i18n/index.ts";
import { formatDate } from "../../i18n/dates.ts";
import type { Locale, TeamRow } from "../../db/types.ts";
import type { TeamMemberRow, TeamWithMembers } from "../../db/queries/teams.ts";

export interface TeamWithRoster extends TeamWithMembers {
  members: TeamMemberRow[];
}

/**
 * Teams, built the same way the metrics page is: one form at the top that both creates and
 * edits, the live list under it, the archive as its own section at the bottom.
 *
 * The roster shows departed members too, greyed out with their departure date. That is the
 * point of `left_on`: someone who left in March is still part of the team's March, and
 * hiding them would make the aggregates look like they came from nowhere.
 */
export function teamsPage(o: {
  locale: Locale; theme: Theme;
  teams: TeamWithRoster[];
  archived: TeamWithMembers[];
  editing: TeamRow | null;
  error: string | null;
}): string {
  const t = dict(o.locale);
  const editing = o.editing;

  const form = html`
    <form method="post" action="${editing ? `/teams/${editing.id}` : "/teams"}" class="card">
      <div class="field">
        <label for="name">${t.teams.name}</label>
        <input type="text" id="name" name="name" required value="${editing?.name ?? ""}"
               placeholder="${editing ? "" : t.teams.namePlaceholder}" />
      </div>
      <div class="field">
        <label for="description">${t.teams.description}</label>
        <input type="text" id="description" name="description"
               value="${editing?.description ?? ""}" />
      </div>
      <div class="actions-bar">
        <button class="primary" type="submit">${editing ? t.common.save : t.teams.add}</button>
        ${editing ? html`<a class="btn" href="/teams">${t.common.cancel}</a>` : ""}
      </div>
    </form>
  `;

  const member = (team: TeamWithRoster, m: TeamMemberRow) => html`
    <div class="field-row">
      <div class="field-bar">
        <div class="grow">
          <a class="name ${m.left_on === null ? "" : "muted"}" href="/people/${m.person_id}">
            ${m.full_name}
          </a>
          ${m.role_title ? html`<span class="small muted"> · ${m.role_title}</span>` : ""}
          ${m.is_primary === 1 && m.left_on === null
            ? html`<span class="metric-tag">${t.teams.primary}</span>`
            : ""}
          ${m.joined_on === null && m.left_on === null
            ? ""
            : html`
                <div class="small muted">
                  ${m.joined_on
                    ? html`${t.teams.joinedOn} ${formatDate(m.joined_on, o.locale)}`
                    : ""}
                  ${m.left_on
                    ? html`${m.joined_on ? " · " : ""}${t.teams.leftOn} ${
                        formatDate(m.left_on, o.locale)
                      }`
                    : ""}
                </div>
              `}
        </div>
        ${m.left_on === null && m.is_primary === 0
          ? html`
              <form method="post" action="/teams/${team.id}/members/${m.person_id}/primary">
                <input type="hidden" name="is_primary" value="1" />
                <button class="link" type="submit">${t.teams.makePrimary}</button>
              </form>
            `
          : ""}
        ${m.left_on === null
          ? html`
              <form method="post" action="/teams/${team.id}/members/${m.person_id}/leave"
                    onsubmit="return confirm('${t.teams.departureConfirm}')">
                <button class="link danger" type="submit">${t.teams.recordDeparture}</button>
              </form>
            `
          : ""}
      </div>
    </div>
  `;

  const teamCard = (team: TeamWithRoster) => html`
    <div class="section-card">
      <div class="section-bar">
        <div class="grow">
          <strong>${team.name}</strong>
          <span class="small muted"> · ${plural(o.locale, team.member_count, t.teams.memberForms)}</span>
          ${team.description ? html`<div class="small muted">${team.description}</div>` : ""}
        </div>
        <a class="btn small-btn" href="/teams?edit=${team.id}">${t.common.edit}</a>
        <form method="post" action="/teams/${team.id}/archive"
              onsubmit="return confirm('${t.teams.archiveConfirm}')">
          <button class="link danger" type="submit">${t.common.archive}</button>
        </form>
      </div>
      ${team.members.length === 0
        ? html`<p class="small muted">${t.teams.noMembers}</p>`
        : team.members.map((m) => member(team, m))}
    </div>
  `;

  const body = html`
    <h1>${t.teams.title}</h1>
    <p class="sub">${t.teams.subtitle}</p>

    ${o.error ? html`<div class="notice error">${o.error}</div>` : ""}

    <h2>${editing ? t.teams.edit : t.teams.add}</h2>
    ${form}

    <h2>${t.teams.title}</h2>
    ${o.teams.length === 0
      ? html`<div class="empty">${t.teams.empty}</div>`
      : o.teams.map(teamCard)}

    ${o.archived.length > 0
      ? html`
          <h2>${t.teams.archived}</h2>
          <div class="rows">
            ${o.archived.map(
              (team) => html`
                <div class="row">
                  <span class="grow">
                    <strong class="muted">${team.name}</strong>
                    <span class="small muted"> · ${
                      plural(o.locale, team.member_count, t.teams.memberForms)
                    }</span>
                  </span>
                  <form method="post" action="/teams/${team.id}/restore">
                    <button class="link" type="submit">${t.teams.restore}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `
      : ""}
  `;

  return layout({
    locale: o.locale, theme: o.theme, title: t.teams.title, nav: "teams", path: "/teams", body,
  });
}
