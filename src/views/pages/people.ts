import { html } from "../html.ts";
import type { Theme } from "../../lib/theme.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import { formatDate } from "../../i18n/dates.ts";
import type { Locale, PersonRow, TemplateRow } from "../../db/types.ts";
import type { PersonTeamRow, TeamWithMembers } from "../../db/queries/teams.ts";
import { joinLink } from "../components/join-link.ts";
import { dateField } from "../components/date-field.ts";

export function peopleListPage(o: {
  locale: Locale; theme: Theme; people: PersonRow[]; archived: PersonRow[];
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

    ${o.archived.length > 0
      ? html`
          <h2>${t.people.archived}</h2>
          <p class="sub small">${t.people.archivedHint}</p>
          <div class="rows">
            ${o.archived.map(
              (p) => html`
                <div class="row">
                  <span class="grow">
                    <a class="name muted" href="/people/${p.id}">${p.full_name}</a>
                    ${p.role_title ? html`<span class="small muted"> · ${p.role_title}</span>` : ""}
                  </span>
                  <form method="post" action="/people/${p.id}/restore">
                    <button class="link" type="submit">${t.people.restore}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `
      : ""}
  `;
  return layout({ locale: o.locale, theme: o.theme, title: t.people.title, nav: "people", path: "/people", body });
}

export function personFormPage(o: {
  locale: Locale; theme: Theme;
  person: PersonRow | null;
  /** What to put in the inputs when a save failed: the submitted values, not the stored ones. */
  draft?: PersonRow;
  templates: TemplateRow[];
  /** Teams available to join: the live ones. */
  teams: TeamWithMembers[];
  /** Every team the person has been in, current spells first. */
  memberships?: PersonTeamRow[];
  /** The team pre-selected in the picker, and whether the primary box is ticked. */
  teamDraft?: { teamId: number | null; isPrimary: boolean };
  /** Today in the manager's timezone: the cadence anchor's calendar opens on it (rule 4). */
  today: string;
  error?: string;
}): string {
  const t = dict(o.locale);
  const p = o.draft ?? o.person;
  const action = o.person ? `/people/${o.person.id}` : "/people";

  const current = (o.memberships ?? []).filter((m) => m.left_on === null);
  const past = (o.memberships ?? []).filter((m) => m.left_on !== null);
  const selectedTeam = o.teamDraft
    ? o.teamDraft.teamId
    : current.find((m) => m.is_primary === 1)?.team_id ?? current[0]?.team_id ?? null;
  const primaryChecked = o.teamDraft
    ? o.teamDraft.isPrimary
    : current.some((m) => m.is_primary === 1 && m.team_id === selectedTeam);

  /**
   * The picker adds the person to a team; it never takes them out. Leaving a team is a
   * date (`left_on`) recorded on the teams page, because a person who left in March is
   * still part of that team's March in every aggregate (CLAUDE.md rule 5).
   */
  const teamPicker = html`
    <div class="field">
      <label for="team_id">
        ${t.people.team}
        <span class="hint">${t.people.teamHint}</span>
      </label>
      ${o.teams.length === 0
        ? html`<p class="small muted">${t.people.noTeams}</p>`
        : html`
            <select id="team_id" name="team_id">
              <option value="">${t.common.none}</option>
              ${o.teams.map(
                (team) => html`
                  <option value="${team.id}" ${team.id === selectedTeam ? "selected" : ""}>
                    ${team.name}
                  </option>
                `,
              )}
            </select>
            <label class="small">
              <input type="checkbox" name="is_primary" value="1" ${primaryChecked ? "checked" : ""} />
              ${t.people.primaryTeam}
            </label>
            <span class="hint">${t.people.primaryTeamHint}</span>
          `}
      ${current.length > 0 || past.length > 0
        ? html`
            <div class="small muted">
              ${current.map(
                (m) => html`
                  <span class="chip">${m.name}${m.is_primary === 1 ? ` · ${t.teams.primary}` : ""}</span>
                `,
              )}
              ${past.map(
                (m) => html`
                  <span class="chip">${m.name} · ${t.teams.leftOn} ${
                    formatDate(m.left_on!, o.locale)
                  }</span>
                `,
              )}
            </div>
          `
        : ""}
    </div>
  `;

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
          ${dateField({
            locale: o.locale, id: "cadence_anchor_on", name: "cadence_anchor_on",
            value: p?.cadence_anchor_on, today: o.today,
          })}
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
      ${teamPicker}
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
          <h2>${t.people.archived}</h2>
          <div class="card">
            <p class="small muted">${t.people.archivedHint}</p>
            <form method="post" action="/people/${o.person.id}/archive" class="actions-bar"
                  onsubmit="return confirm('${t.people.archiveConfirm}')">
              <button class="danger" type="submit">${t.common.archive}</button>
            </form>
          </div>
        `
      : ""}
  `;

  return layout({
    locale: o.locale,
    theme: o.theme,
    title: o.person ? t.people.editTitle : t.people.addTitle,
    nav: "people",
    path: o.person ? `/people/${o.person.id}/edit` : "/people/new",
    body,
  });
}
