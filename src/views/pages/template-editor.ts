import { html, type Raw } from "../html.ts";
import { layout } from "../layout.ts";
import { dict, plural, problemMessage } from "../../i18n/index.ts";
import type {
  FieldType, FieldWithOptions, Locale, MetricRow, SectionWithFields, TemplateRow,
  TemplateVersionRow,
} from "../../db/types.ts";
import type { TemplateProblem } from "../../domain/template-editor.ts";
import { formatDate } from "../../i18n/dates.ts";

type Dict = ReturnType<typeof dict>;

export function typeLabel(t: Dict, type: FieldType): string {
  switch (type) {
    case "scale": return t.editor.typeScale;
    case "text": return t.editor.typeText;
    case "short_text": return t.editor.typeShortText;
    case "checkbox": return t.editor.typeCheckbox;
    case "single_select": return t.editor.typeSingleSelect;
    case "multi_select": return t.editor.typeMultiSelect;
    case "date": return t.editor.typeDate;
  }
}

const ALL_TYPES: FieldType[] = [
  "scale", "text", "short_text", "checkbox", "single_select", "multi_select", "date",
];
const SELECT_TYPES: FieldType[] = ["single_select", "multi_select"];

export interface EditorState {
  locale: Locale;
  template: TemplateRow;
  version: TemplateVersionRow;
  sections: SectionWithFields[];
  metrics: MetricRow[];
  problems: TemplateProblem[];
  answerCounts: Map<string, number>;
  meetingsOnVersion: number;
  /** Which form is expanded: it comes from the URL, so the state is in the link, not JS. */
  editField: string | null;
  editSection: string | null;
  addFieldTo: string | null;
  forked: boolean;
  error: string | null;
}

/** A summary of what the field will look like during a meeting. */
function fieldPreview(field: FieldWithOptions): Raw {
  if (field.type === "scale") {
    return html`
      <span class="preview-line">
        ${field.scale_min}–${field.scale_max}
        ${field.scale_min_label || field.scale_max_label
          ? html` <span class="muted">(${field.scale_min_label ?? ""} … ${field.scale_max_label ?? ""})</span>`
          : ""}
      </span>
    `;
  }
  if (SELECT_TYPES.includes(field.type)) {
    return html`
      <span class="preview-line">
        ${field.options.map(
          (o) => html`<span class="chip">${o.label}${
            o.score === null ? "" : html` <span class="muted">${o.score}</span>`
          }</span>`,
        )}
      </span>
    `;
  }
  return html``;
}

function metricSelect(t: Dict, metrics: MetricRow[], selected: number | null): Raw {
  return html`
    <select name="metric_id">
      <option value="">${t.editor.noMetric}</option>
      ${metrics.map(
        (m) => html`
          <option value="${m.id}" ${m.id === selected ? "selected" : ""}>
            ${m.label} (${m.key})${m.direction === -1 ? " ↓" : ""}
          </option>
        `,
      )}
    </select>
  `;
}

/** The question form. The same for creating and editing; only the action differs. */
function fieldForm(
  s: EditorState, t: Dict, sectionKey: string, field: FieldWithOptions | null,
): Raw {
  const action = field
    ? `/templates/${s.template.id}/fields/${encodeURIComponent(field.field_key)}`
    : `/templates/${s.template.id}/sections/${encodeURIComponent(sectionKey)}/fields`;
  const type = field?.type ?? "scale";

  return html`
    <form method="post" action="${action}" class="card field-form">
      <div class="field">
        <label>${t.editor.fieldLabel}</label>
        <input type="text" name="label" value="${field?.label ?? ""}" required autofocus />
      </div>
      <div class="field">
        <label>${t.editor.fieldHelp}</label>
        <input type="text" name="help_text" value="${field?.help_text ?? ""}" />
      </div>
      <div class="grid2">
        <div class="field">
          <label>${t.editor.fieldType}</label>
          <select name="type">
            ${ALL_TYPES.map(
              (x) => html`<option value="${x}" ${x === type ? "selected" : ""}>${typeLabel(t, x)}</option>`,
            )}
          </select>
        </div>
        <div class="field">
          <label>${t.editor.fieldVisibility}</label>
          <select name="visibility">
            <option value="shared" ${field?.visibility === "shared" ? "selected" : ""}>
              ${t.meeting.visibilityShared}
            </option>
            <option value="private" ${field === null || field.visibility === "private" ? "selected" : ""}>
              ${t.meeting.visibilityPrivate}
            </option>
          </select>
        </div>
      </div>
      <div class="field metric-only"
           ${["scale", "single_select", "multi_select", "checkbox"].includes(type) ? "" : "hidden"}>
        <label>
          ${t.editor.fieldMetric}
          <span class="hint">${t.editor.metricOnlyFor}</span>
        </label>
        ${metricSelect(t, s.metrics, field?.metric_id ?? null)}
      </div>
      <!-- Shown for a scale only: other types do not use these columns. -->
      <div class="scale-only" ${type === "scale" ? "" : "hidden"}>
        <div class="grid2">
          <div class="field">
            <label>${t.editor.scaleFrom}</label>
            <input type="number" name="scale_min" value="${field?.scale_min ?? 1}" min="0" max="100" />
          </div>
          <div class="field">
            <label>${t.editor.scaleTo}</label>
            <input type="number" name="scale_max" value="${field?.scale_max ?? 5}" min="1" max="100" />
          </div>
        </div>
        <div class="grid2">
          <div class="field">
            <label>${t.editor.scaleMinLabel}</label>
            <input type="text" name="scale_min_label" value="${field?.scale_min_label ?? ""}" />
          </div>
          <div class="field">
            <label>${t.editor.scaleMaxLabel}</label>
            <input type="text" name="scale_max_label" value="${field?.scale_max_label ?? ""}" />
          </div>
        </div>
      </div>
      <div class="field">
        <label class="inline">
          <input type="checkbox" name="is_required" value="1" ${field?.is_required === 1 ? "checked" : ""} />
          ${t.editor.fieldRequired}
        </label>
      </div>
      ${field
        ? html`
            <div class="field new-question">
              <label class="inline">
                <input type="checkbox" name="new_question" value="1" />
                ${t.editor.newQuestion}
              </label>
              <span class="hint">${t.editor.newQuestionHint}</span>
            </div>
          `
        : ""}
      <div class="actions-bar">
        <button class="primary" type="submit">${t.common.save}</button>
        <a class="btn" href="/templates/${s.template.id}">${t.common.cancel}</a>
      </div>
    </form>
  `;
}

function optionsEditor(s: EditorState, t: Dict, field: FieldWithOptions): Raw {
  const base = `/templates/${s.template.id}/fields/${encodeURIComponent(field.field_key)}/options`;
  return html`
    <div class="card options-editor">
      <h3>${t.editor.options}</h3>
      <p class="small muted">${t.editor.optionScoreHint}</p>
      ${field.options.map(
        (o) => html`
          <form method="post" action="${base}/${encodeURIComponent(o.option_key)}" class="option-row">
            <input type="text" name="label" value="${o.label}" aria-label="${t.editor.optionLabel}" />
            <input type="number" name="score" value="${o.score ?? ""}" step="0.1" min="0" max="1"
                   placeholder="${t.editor.optionScore}" aria-label="${t.editor.optionScore}" />
            <button type="submit">${t.common.save}</button>
            <button type="submit" formaction="${base}/${encodeURIComponent(o.option_key)}/delete"
                    class="danger">×</button>
          </form>
        `,
      )}
      <form method="post" action="${base}" class="option-row">
        <input type="text" name="label" placeholder="${t.editor.optionLabel}" required />
        <input type="number" name="score" step="0.1" min="0" max="1" placeholder="${t.editor.optionScore}" />
        <button type="submit">${t.editor.addOption}</button>
      </form>
    </div>
  `;
}

export function templateEditorPage(s: EditorState): string {
  const t = dict(s.locale);
  const tpl = s.template;
  const base = `/templates/${tpl.id}`;

  const body = html`
    <h1>${tpl.name}</h1>
    <p class="sub">
      ${tpl.is_default === 1 ? html`<span class="badge shared">${t.editor.isDefault}</span> · ` : ""}
      ${t.templates.version} ${s.version.version_no} ·
      ${s.version.frozen_at === null
        ? html`<span class="badge neutral">${t.editor.draftVersion}</span>`
        : html`<span class="badge ok">${t.editor.frozenSince} ${formatDate(s.version.frozen_at.slice(0, 10), s.locale)}</span>`}
      ${s.meetingsOnVersion > 0
        ? html` · ${s.meetingsOnVersion} ${t.editor.meetingsOnVersion}`
        : ""}
      · <a href="${base}/versions">${t.editor.versions}</a>
      · <a href="/templates">${t.templates.title}</a>
    </p>
    <p class="sub small">${t.editor.versionsHint}</p>

    ${s.error ? html`<div class="notice error">${s.error}</div>` : ""}
    ${s.forked ? html`<div class="notice">${t.editor.editorForkedNotice}</div>` : ""}

    ${s.problems.length > 0
      ? html`
          <h2>${t.editor.problems}</h2>
          <div class="rows">
            ${s.problems.map(
              (p) => html`
                <div class="row problem ${p.level}">
                  <span class="badge ${p.level === "error" ? "overdue" : p.level === "warning" ? "due_soon" : "neutral"}">
                    ${p.level === "error" ? "!" : p.level === "warning" ? "?" : "i"}
                  </span>
                  <span class="grow">${problemMessage(s.locale, p.code, p.params)}</span>
                </div>
              `,
            )}
          </div>
        `
      : ""}

    <h2>${t.editor.sectionsHeading}</h2>
    <p class="small muted">${t.editor.dragHint}</p>

    <div class="sections" data-reorder="sections" data-url="${base}/reorder-sections">
      ${s.sections.map((section) => {
        // A section every question of which is private is a section that never leaves the
        // instance, and the author should see that while writing it — with the same label
        // the meeting page uses, not a shade the yellow notices also wear.
        const isPrivateSection = section.fields.length > 0
          && section.fields.every((f) => f.visibility === "private");
        return html`
          <section class="section-card ${isPrivateSection ? "private" : ""}"
                   draggable="true" data-key="${section.section_key}">
            <!--
              The label sits inside the card here, bled to its edges, so that dragging the
              section carries it: reorder.js moves .section-card nodes, and a label left
              behind would briefly caption the wrong section.
            -->
            ${isPrivateSection
              ? html`
                  <div class="private-head">
                    <span>${t.meeting.privateSection}</span>
                    <span class="muted small">${t.meeting.notInSummary}</span>
                  </div>
                `
              : ""}
            <div class="section-bar">
              <span class="handle" title="${t.editor.dragHint}">⠿</span>
              <span class="grow"><strong>${section.title}</strong></span>
              <span class="controls">
                <form method="post" action="${base}/sections/${encodeURIComponent(section.section_key)}/move">
                  <input type="hidden" name="direction" value="up" />
                  <button class="link" type="submit" title="${t.editor.up}">↑</button>
                </form>
                <form method="post" action="${base}/sections/${encodeURIComponent(section.section_key)}/move">
                  <input type="hidden" name="direction" value="down" />
                  <button class="link" type="submit" title="${t.editor.down}">↓</button>
                </form>
                <a class="btn small-btn" href="${base}?edit_section=${encodeURIComponent(section.section_key)}">
                  ${t.common.edit}
                </a>
                <form method="post" action="${base}/sections/${encodeURIComponent(section.section_key)}/delete"
                      onsubmit="return confirm('${t.editor.deleteSectionConfirm}')">
                  <button class="link danger" type="submit"
                          title="${t.editor.deleteSection}">×</button>
                </form>
              </span>
            </div>
            ${section.description ? html`<p class="section-desc">${section.description}</p>` : ""}

            ${s.editSection === section.section_key
              ? html`
                  <form method="post" action="${base}/sections/${encodeURIComponent(section.section_key)}"
                        class="card">
                    <div class="field">
                      <label>${t.editor.sectionTitle}</label>
                      <input type="text" name="title" value="${section.title}" required autofocus />
                    </div>
                    <div class="field">
                      <label>${t.editor.sectionDescription}</label>
                      <input type="text" name="description" value="${section.description ?? ""}" />
                    </div>
                    <div class="actions-bar">
                      <button class="primary" type="submit">${t.common.save}</button>
                      <a class="btn" href="${base}">${t.common.cancel}</a>
                    </div>
                  </form>
                `
              : ""}

            <div class="fields" data-reorder="fields" data-section="${section.section_key}"
                 data-url="${base}/reorder-fields">
              ${section.fields.length === 0
                ? html`<p class="empty small">${t.editor.emptySection}</p>`
                : section.fields.map((field) => {
                    const answers = s.answerCounts.get(field.field_key) ?? 0;
                    const expanded = s.editField === field.field_key;
                    return html`
                      <div class="field-row ${expanded ? "expanded" : ""}"
                           draggable="true" data-key="${field.field_key}">
                        <div class="field-bar">
                          <span class="handle">⠿</span>
                          <span class="grow">
                            <strong>${field.label}</strong>
                            ${field.is_required === 1 ? html`<span class="req">*</span>` : ""}
                            <span class="small muted">
                              · ${typeLabel(t, field.type)}
                              ${field.metric_id !== null
                                ? html` · <span class="metric-tag">${
                                    s.metrics.find((m) => m.id === field.metric_id)?.label
                                      ?? t.templates.metric
                                  }</span>`
                                : ""}
                              ${answers > 0
                                ? html` · ${plural(s.locale, answers, t.editor.answerForms)} ${t.editor.hasAnswers}`
                                : ""}
                            </span>
                            ${fieldPreview(field)}
                          </span>
                          <span class="controls">
                            <span class="badge ${field.visibility === "private" ? "private" : "shared"}">
                              ${field.visibility === "private"
                                ? t.templates.visibilityPrivate
                                : t.templates.visibilityShared}
                            </span>
                            <form method="post" action="${base}/fields/${encodeURIComponent(field.field_key)}/move">
                              <input type="hidden" name="direction" value="up" />
                              <button class="link" type="submit" title="${t.editor.up}">↑</button>
                            </form>
                            <form method="post" action="${base}/fields/${encodeURIComponent(field.field_key)}/move">
                              <input type="hidden" name="direction" value="down" />
                              <button class="link" type="submit" title="${t.editor.down}">↓</button>
                            </form>
                            <a class="btn small-btn" href="${base}?edit=${encodeURIComponent(field.field_key)}">
                              ${t.common.edit}
                            </a>
                            <form method="post" action="${base}/fields/${encodeURIComponent(field.field_key)}/delete"
                                  onsubmit="return confirm('${t.editor.deleteFieldConfirm}')">
                              <button class="link danger" type="submit"
                                      title="${t.editor.deleteField}">×</button>
                            </form>
                          </span>
                        </div>
                        ${expanded
                          ? html`
                              ${answers > 0
                                ? html`<p class="small muted">${plural(s.locale, answers, t.editor.answerForms)} ${t.editor.hasAnswers}. ${t.editor.hasAnswersHint}</p>`
                                : ""}
                              ${fieldForm(s, t, section.section_key, field)}
                              ${SELECT_TYPES.includes(field.type) ? optionsEditor(s, t, field) : ""}
                            `
                          : ""}
                      </div>
                    `;
                  })}
            </div>

            ${s.addFieldTo === section.section_key
              ? fieldForm(s, t, section.section_key, null)
              : html`
                  <p class="actions-bar">
                    <a class="btn" href="${base}?add_field=${encodeURIComponent(section.section_key)}">
                      ${t.editor.addField}
                    </a>
                  </p>
                `}
          </section>
        `;
      })}
    </div>

    <form method="post" action="${base}/sections" class="card">
      <div class="field">
        <label>${t.editor.addSection}</label>
        <input type="text" name="title" placeholder="${t.editor.sectionTitle}" required />
      </div>
      <div class="field">
        <input type="text" name="description" placeholder="${t.editor.sectionDescription}" />
      </div>
      <button class="primary" type="submit">${t.editor.addSection}</button>
    </form>

    <h2>${t.common.edit}</h2>
    <form method="post" action="${base}" class="card">
      <div class="field">
        <label>${t.editor.templateName}</label>
        <input type="text" name="name" value="${tpl.name}" required />
      </div>
      <div class="field">
        <label>${t.editor.templateDescription}</label>
        <input type="text" name="description" value="${tpl.description ?? ""}" />
      </div>
      <div class="actions-bar">
        <button class="primary" type="submit">${t.common.save}</button>
      </div>
    </form>

    <div class="actions-bar">
      <form method="post" action="${base}/duplicate">
        <button type="submit">${t.editor.duplicate}</button>
      </form>
      ${tpl.is_default === 1
        ? ""
        : html`
            <form method="post" action="${base}/default">
              <button type="submit">${t.editor.setDefault}</button>
            </form>
            <form method="post" action="${base}/archive">
              <button class="danger" type="submit">${t.editor.archive}</button>
            </form>
          `}
    </div>

    <script src="/reorder.js"></script>
    <script src="/field-form.js"></script>
  `;

  return layout({
    locale: s.locale, title: `${tpl.name} · ${t.editor.title}`, nav: "templates",
    path: base, body,
  });
}
