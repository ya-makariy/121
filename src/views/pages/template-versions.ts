import { html } from "../html.ts";
import type { Theme } from "../../lib/theme.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, TemplateRow, TemplateVersionRow } from "../../db/types.ts";
import type { ChangeKind, VersionDiff } from "../../domain/template-version.ts";
import { formatDate } from "../../i18n/dates.ts";

type Dict = ReturnType<typeof dict>;

function changeLabel(t: Dict, kind: ChangeKind): string {
  switch (kind) {
    case "added": return t.editor.changeAdded;
    case "removed": return t.editor.changeRemoved;
    case "relabelled": return t.editor.changeRelabelled;
    case "retyped": return t.editor.changeRetyped;
    case "rescaled": return t.editor.changeRescaled;
    case "rebound": return t.editor.changeRebound;
    case "unbound": return t.editor.changeUnbound;
    case "visibility": return t.editor.changeVisibility;
    case "moved": return t.editor.changeMoved;
  }
}

/**
 * change_note is deliberately not shown here. It is an English audit string stored with
 * the version; what the manager needs is the diff below, which says the same thing in
 * their own language.
 */
export interface VersionRow extends TemplateVersionRow {
  meetings: number;
  fields: number;
  is_current: boolean;
}

export function templateVersionsPage(o: {
  locale: Locale; theme: Theme;
  template: TemplateRow;
  versions: VersionRow[];
  diff: VersionDiff | null;
}): string {
  const t = dict(o.locale);
  const base = `/templates/${o.template.id}`;

  const body = html`
    <h1>${t.editor.versions}</h1>
    <p class="sub">
      ${o.template.name} · <a href="${base}">${t.editor.title}</a>
    </p>
    <p class="sub small">${t.editor.versionsHint}</p>

    <div class="rows">
      ${o.versions.map(
        (v) => html`
          <div class="row">
            <span class="standing-value">v${v.version_no}</span>
            <span class="grow">
              ${v.frozen_at === null
                ? html`<span class="badge neutral">${t.editor.draftVersion}</span>`
                : html`<span class="badge ok">${t.editor.frozenSince} ${formatDate(v.frozen_at.slice(0, 10), o.locale)}</span>`}
              ${v.is_current ? html` <span class="badge shared">${t.editor.currentVersion}</span>` : ""}
              <span class="small muted">
                · ${v.fields} ${t.templates.fields}
                · ${v.meetings} ${t.editor.meetingsOnVersion}
              </span>
            </span>
            ${v.parent_version_id !== null
              ? html`<a class="btn small-btn" href="${base}/versions?diff=${v.id}">${t.editor.diffWithParent}</a>`
              : ""}
          </div>
        `,
      )}
    </div>

    ${o.diff
      ? html`
          <h2>
            ${t.editor.diffWithParent}: v${o.diff.from.version_no} → v${o.diff.to.version_no}
          </h2>
          ${o.diff.changes.length === 0 && o.diff.sectionChanges.length === 0
            ? html`<div class="empty">${t.editor.noChanges}</div>`
            : html`
                <div class="rows">
                  ${o.diff.sectionChanges.map(
                    (c) => html`
                      <div class="row">
                        <span class="badge neutral">${t.templates.sections}</span>
                        <div class="grow">
                          <strong>${c.label}</strong>
                          <span class="small muted"> · ${changeLabel(t, c.kind)}</span>
                          ${c.from !== undefined && c.to !== undefined
                            ? html`<div class="small muted">${c.from} → ${c.to}</div>`
                            : ""}
                        </div>
                      </div>
                    `,
                  )}
                  ${o.diff.changes.map(
                    (c) => html`
                      <div class="row">
                        <span class="badge ${c.kind === "visibility" ? "private" : "neutral"}">
                          ${changeLabel(t, c.kind)}
                        </span>
                        <div class="grow">
                          <strong>${c.label}</strong>
                          ${c.from !== undefined || c.to !== undefined
                            ? html`<div class="small muted">${c.from ?? t.common.none} → ${c.to ?? t.common.none}</div>`
                            : ""}
                          <div class="small muted"><code>${c.fieldKey}</code></div>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `}
        `
      : ""}
  `;

  return layout({
    locale: o.locale, theme: o.theme, title: t.editor.versions, nav: "templates",
    path: `${base}/versions`, body,
  });
}
