import { html } from "../html.ts";
import type { Theme } from "../../lib/theme.ts";
import { layout } from "../layout.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale, MetricRow } from "../../db/types.ts";
import type { MetricUsage } from "../../domain/metrics-editor.ts";

export function metricsPage(o: {
  locale: Locale; theme: Theme;
  metrics: MetricUsage[];
  archived: MetricUsage[];
  editing: MetricRow | null;
  editingReferenced: boolean;
  nextOrder: number;
  error: string | null;
}): string {
  const t = dict(o.locale);
  const editing = o.editing;

  const form = html`
    <form method="post" action="${editing ? `/metrics/${editing.id}` : "/metrics"}" class="card">
      <div class="grid2">
        <div class="field">
          <label>${t.metrics.label}</label>
          <input type="text" name="label" value="${editing?.label ?? ""}" required
                 placeholder="${editing ? "" : t.metrics.labelPlaceholder}" />
        </div>
        <div class="field">
          <label>
            ${t.metrics.key}
            <span class="hint">${
              editing && o.editingReferenced ? t.metrics.keyLocked : t.metrics.keyHint
            }</span>
          </label>
          <input type="text" name="key" value="${editing?.key ?? ""}"
                 pattern="[a-z][a-z0-9_]{1,48}"
                 ${editing && o.editingReferenced ? "readonly" : ""}
                 placeholder="${editing ? "" : t.metrics.keyPlaceholder}" />
        </div>
      </div>
      <div class="field">
        <label>${t.metrics.description}</label>
        <input type="text" name="description" value="${editing?.description ?? ""}" />
      </div>
      <div class="grid2">
        <div class="field">
          <label>
            ${t.metrics.kind}
            <span class="hint">${t.metrics.kindHint}</span>
          </label>
          ${editing
            ? html`
                <input type="text" readonly
                       value="${editing.kind === "scalar" ? t.metrics.kindScalar : t.metrics.kindCategorical}" />
              `
            : html`
                <select name="kind">
                  <option value="scalar">${t.metrics.kindScalar}</option>
                  <option value="categorical">${t.metrics.kindCategorical}</option>
                </select>
              `}
        </div>
        <div class="field">
          <label>
            ${t.metrics.direction}
            <span class="hint">${t.metrics.directionHint}</span>
          </label>
          <select name="direction">
            <option value="1" ${editing?.direction === 1 || editing === null ? "selected" : ""}>
              ${t.metrics.directionUp}
            </option>
            <option value="-1" ${editing?.direction === -1 ? "selected" : ""}>
              ${t.metrics.directionDown}
            </option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>${t.metrics.displayOrder}</label>
        <input type="number" name="display_order" min="1" max="99"
               value="${editing?.display_order ?? o.nextOrder}" />
      </div>
      <div class="actions-bar">
        <button class="primary" type="submit">${editing ? t.common.save : t.metrics.add}</button>
        ${editing ? html`<a class="btn" href="/metrics">${t.common.cancel}</a>` : ""}
      </div>
    </form>
  `;

  const usageLine = (m: MetricUsage) =>
    m.referenced
      ? html`
          <span class="small muted">
            ${t.metrics.usedIn} ${m.field_count} ${t.metrics.fields},
            ${m.template_count} ${t.metrics.templates} · ${m.point_count} ${t.metrics.points}
          </span>
        `
      : html`<span class="small muted">${t.metrics.unused}</span>`;

  const body = html`
    <h1>${t.metrics.title}</h1>
    <p class="sub">${t.metrics.subtitle}</p>

    ${o.error ? html`<div class="notice error">${o.error}</div>` : ""}

    <h2>${editing ? t.metrics.edit : t.metrics.add}</h2>
    ${form}

    <h2>${t.metrics.title}</h2>
    ${o.metrics.length === 0
      ? html`<div class="empty">${t.metrics.empty}</div>`
      : html`
          <div class="rows">
            ${o.metrics.map(
              (m) => html`
                <div class="row">
                  <span class="badge ${m.direction === 1 ? "ok" : "due_soon"}">
                    ${m.direction === 1 ? "↑" : "↓"}
                  </span>
                  <div class="grow">
                    <strong>${m.label}</strong>
                    <span class="small muted"> · <code>${m.key}</code> · ${
                      m.kind === "scalar" ? t.metrics.kindScalar : t.metrics.kindCategorical
                    }</span>
                    ${m.description ? html`<div class="small muted">${m.description}</div>` : ""}
                    <div>${usageLine(m)}</div>
                  </div>
                  <a class="btn small-btn" href="/metrics?edit=${m.id}">${t.common.edit}</a>
                  <form method="post" action="/metrics/${m.id}/remove"
                        onsubmit="return confirm('${
                          m.referenced ? t.metrics.archiveUsedConfirm : t.metrics.removeUnusedConfirm
                        }')">
                    <button class="link danger" type="submit">${t.metrics.remove}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `}

    ${o.archived.length > 0
      ? html`
          <h2>${t.metrics.archived}</h2>
          <div class="rows">
            ${o.archived.map(
              (m) => html`
                <div class="row">
                  <div class="grow">
                    <strong class="muted">${m.label}</strong>
                    <span class="small muted"> · <code>${m.key}</code></span>
                    <div>${usageLine(m)}</div>
                  </div>
                  <form method="post" action="/metrics/${m.id}/restore">
                    <button class="link" type="submit">${t.metrics.restore}</button>
                  </form>
                </div>
              `,
            )}
          </div>
        `
      : ""}
  `;

  return layout({
    locale: o.locale, theme: o.theme, title: t.metrics.title, nav: "metrics", path: "/metrics", body,
  });
}
