import { html } from "../html.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, MetricRow, TemplateRow } from "../../db/types.ts";
import type { OpenActionRow } from "../../db/queries/actions.ts";
import { formatDate } from "../../i18n/dates.ts";
import { LOCALES } from "../../i18n/index.ts";

export function actionsPage(o: { locale: Locale; actions: OpenActionRow[] }): string {
  const t = dict(o.locale);
  const body = html`
    <h1>${t.actions.title}</h1>
    <p class="sub">${o.actions.length}</p>
    ${o.actions.length === 0
      ? html`<div class="empty">${t.actions.empty}</div>`
      : html`
          <div class="rows">
            ${o.actions.map(
              (a) => html`
                <div class="row">
                  ${a.is_late === 1 ? html`<span class="badge overdue">${t.actions.late}</span>` : ""}
                  <span class="grow">
                    ${a.title}
                    <span class="small muted">
                      · <a href="/people/${a.person_id}">${a.full_name}</a>
                      ${a.due_on ? html` · ${t.meeting.dueOn} ${formatDate(a.due_on, o.locale)}` : ""}
                      ${a.age_days !== null ? html` · ${a.age_days} ${t.dashboard.days}` : ""}
                    </span>
                    ${a.visibility === "private"
                      ? html` <span class="badge private">${t.templates.visibilityPrivate}</span>`
                      : ""}
                  </span>
                  <form method="post" action="/actions/${a.id}/status">
                    <input type="hidden" name="status" value="done" />
                    <input type="hidden" name="return_to" value="/actions" />
                    <button class="link" type="submit">${t.actions.markDone}</button>
                  </form>
                  <form method="post" action="/actions/${a.id}/status">
                    <input type="hidden" name="status" value="dropped" />
                    <input type="hidden" name="return_to" value="/actions" />
                    <button class="link" type="submit">${t.actions.markDropped}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `}
  `;
  return layout({ locale: o.locale, title: t.actions.title, nav: "actions", path: "/actions", body });
}

export interface TemplateSummary extends TemplateRow {
  version_no: number | null;
  frozen_at: string | null;
  section_count: number;
  field_count: number;
}

export function templatesPage(o: {
  locale: Locale; templates: TemplateSummary[]; metrics: MetricRow[];
}): string {
  const t = dict(o.locale);
  const body = html`
    <h1>${t.templates.title}</h1>
    <p class="sub">
      ${t.editor.versionsHint}
      · <a href="/metrics">${t.metrics.title} (${o.metrics.length})</a>
    </p>

    <div class="rows">
      ${o.templates.map(
        (tpl) => html`
          <div class="row">
            <span class="grow">
              <a class="name" href="/templates/${tpl.id}">${tpl.name}</a>
              ${tpl.is_default === 1
                ? html` <span class="badge shared">${t.templates.defaultBadge}</span>`
                : ""}
              <span class="small muted">
                · ${t.templates.version} ${tpl.version_no ?? "—"}
                · ${tpl.section_count} ${t.templates.sections}
                · ${tpl.field_count} ${t.templates.fields}
                · ${tpl.frozen_at ? t.templates.frozen : t.templates.draft}
              </span>
              ${tpl.description ? html`<div class="small muted">${tpl.description}</div>` : ""}
            </span>
            <a class="btn small-btn" href="/templates/${tpl.id}">${t.common.edit}</a>
          </div>
        `,
      )}
    </div>

    <h2>${t.editor.newTemplate}</h2>
    <form method="post" action="/templates" class="card">
      <div class="field">
        <label>${t.editor.templateName}</label>
        <input type="text" name="name" required placeholder="${t.editor.newTemplate}" />
      </div>
      <button class="primary" type="submit">${t.common.add}</button>
    </form>
  `;
  return layout({
    locale: o.locale, title: t.templates.title, nav: "templates", path: "/templates", body,
  });
}

export function settingsPage(o: { locale: Locale }): string {
  const t = dict(o.locale);
  const body = html`
    <h1>${t.settings.title}</h1>

    <h2>${t.settings.language}</h2>
    <form method="post" action="/settings/locale" class="card">
      <div class="field">
        <select name="locale">
          ${LOCALES.map(
            (l) => html`<option value="${l}" ${l === o.locale ? "selected" : ""}>${
              t.settings.languageNames[l]
            }</option>`,
          )}
        </select>
      </div>
      <input type="hidden" name="return_to" value="/settings" />
      <button class="primary" type="submit">${t.common.save}</button>
    </form>

    <h2>${t.settings.backup}</h2>
    <form method="post" action="/settings/backup" class="card">
      <p class="small muted">${t.settings.backupHint}</p>
      <button class="primary" type="submit">${t.common.download}</button>
    </form>

    <h2>${t.settings.exportJson}</h2>
    <div class="card">
      <p class="small muted">${t.settings.exportHint}</p>
      <div class="actions-bar">
        <a class="btn" href="/settings/export.json">${t.settings.exportJson}</a>
        <a class="btn" href="/settings/export.md">${t.settings.exportMd}</a>
      </div>
    </div>
  `;
  return layout({
    locale: o.locale, title: t.settings.title, nav: "settings", path: "/settings", body,
  });
}
