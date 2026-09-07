import { html, raw, type Raw } from "../html.ts";
import type { FieldWithOptions, Locale } from "../../db/types.ts";
import { dict } from "../../i18n/index.ts";
import { formatDate } from "../../lib/dates.ts";

/**
 * Одна функция рендерит и редактируемую, и read-only форму каждого типа поля.
 * Два режима вместо двух функций — чтобы страница правки и саммари не могли разойтись
 * в трактовке значения. См. CLAUDE.md §5.
 */

export interface AnswerValue {
  num: number | null;
  text: string | null;
  date: string | null;
  bool: 0 | 1 | null;
  optionKeys: string[];
}

export const EMPTY_ANSWER: AnswerValue = {
  num: null, text: null, date: null, bool: null, optionKeys: [],
};

function scaleSteps(field: FieldWithOptions): number[] {
  const min = field.scale_min ?? 1;
  const max = field.scale_max ?? 5;
  const step = field.scale_step > 0 ? field.scale_step : 1;
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  return out;
}

/** Редактируемое поле. Автосохранение по изменению — HTMX шлёт PATCH и получает партиал. */
export function fieldInput(
  field: FieldWithOptions, value: AnswerValue, meetingId: number, locale: Locale,
): Raw {
  const t = dict(locale);
  const url = `/meetings/${meetingId}/answers/${field.id}`;
  // text/short_text сохраняются по уходу фокуса, остальное — сразу по change.
  const trigger = field.type === "text" || field.type === "short_text"
    ? "change, keyup changed delay:800ms"
    : "change";
  // Для наборов вариантов нужно послать весь набор: одиночный чекбокс сам по себе
  // не описывает multi_select, а снятая галочка не описывается вообще ничем.
  const include =
    field.type === "single_select" || field.type === "multi_select"
      ? ` hx-include="closest .field"`
      : "";
  const hx = html`hx-patch="${url}" hx-trigger="${trigger}" hx-target="#f${field.id}-state" hx-swap="innerHTML"${raw(include)}`;

  let control: Raw;
  switch (field.type) {
    case "scale":
      control = html`
        <div class="scale">
          ${scaleSteps(field).map(
            (n) => html`
              <label class="scale-opt">
                <input type="radio" name="value" value="${n}" ${value.num === n ? "checked" : ""}
                       ${hx} />
                <span>${n}</span>
              </label>
            `,
          )}
        </div>
        <div class="scale-ends">
          <span>${field.scale_min_label ?? ""}</span>
          <span>${field.scale_max_label ?? ""}</span>
        </div>
      `;
      break;

    case "text":
      control = html`<textarea name="value" ${hx}>${value.text ?? ""}</textarea>`;
      break;

    case "short_text":
      control = html`<input type="text" name="value" value="${value.text ?? ""}" ${hx} />`;
      break;

    case "checkbox":
      control = html`
        <label class="opts">
          <input type="checkbox" name="value" value="on" ${value.bool === 1 ? "checked" : ""} ${hx} />
        </label>
      `;
      break;

    case "date":
      control = html`<input type="date" name="value" value="${value.date ?? ""}" ${hx} />`;
      break;

    case "single_select":
      control = html`
        <div class="opts">
          ${field.options.map(
            (o) => html`
              <label>
                <input type="radio" name="option" value="${o.option_key}"
                       ${value.optionKeys.includes(o.option_key) ? "checked" : ""} ${hx} />
                ${o.label}
              </label>
            `,
          )}
        </div>
      `;
      break;

    case "multi_select":
      control = html`
        <div class="opts">
          ${field.options.map(
            (o) => html`
              <label>
                <input type="checkbox" name="option" value="${o.option_key}"
                       ${value.optionKeys.includes(o.option_key) ? "checked" : ""} ${hx} />
                ${o.label}
              </label>
            `,
          )}
        </div>
      `;
      break;
  }

  return html`
    <div class="field" id="f${field.id}">
      <label>
        ${field.label}
        ${field.visibility === "private"
          ? html` <span class="badge private">${t.templates.visibilityPrivate}</span>`
          : ""}
        ${field.help_text ? html`<span class="hint">${field.help_text}</span>` : ""}
      </label>
      ${control}
      <span class="saved-flag" id="f${field.id}-state"></span>
    </div>
  `;
}

/** Read-only значение — используется в саммари и в просмотре завершённой встречи. */
export function fieldReadout(
  field: { label: string; type: string; scale_min?: number | null; scale_max?: number | null;
           scale_min_label?: string | null; scale_max_label?: string | null },
  value: AnswerValue & { optionLabels?: string | null },
  locale: Locale,
): Raw | null {
  const t = dict(locale);

  const body = (() => {
    switch (field.type) {
      case "scale": {
        if (value.num === null) return null;
        const max = field.scale_max ?? 5;
        const min = field.scale_min ?? 1;
        const edge = value.num === min ? field.scale_min_label
          : value.num === max ? field.scale_max_label : null;
        return html`<span class="scale-readout">${value.num} ${t.common.of} ${max}</span>${
          edge ? html` <span class="muted">(${edge})</span>` : ""
        }`;
      }
      case "text":
      case "short_text":
        return value.text && value.text.trim() !== "" ? html`${value.text}` : null;
      case "checkbox":
        return value.bool === null ? null : html`${value.bool === 1 ? t.common.yes : t.common.no}`;
      case "date":
        return value.date ? html`${formatDate(value.date, locale)}` : null;
      case "single_select":
      case "multi_select":
        return value.optionLabels ? html`${value.optionLabels}` : null;
      default:
        return null;
    }
  })();

  if (body === null) return null;
  return html`
    <div class="snapshot-item">
      <div class="q">${field.label}</div>
      <div class="a">${body}</div>
    </div>
  `;
}
