import { html, raw, type Raw } from "../html.ts";
import { dict } from "../../i18n/index.ts";
import { monthNames, weekdayNames } from "../../i18n/dates.ts";
import { formatDateInput, parseDateInput } from "../../lib/dates.ts";
import type { Locale } from "../../db/types.ts";

/**
 * The app's date field: one text input in day-month-year order, plus a calendar.
 *
 * A native date input was doing two things wrong at once. Its format is the browser's,
 * not the page's, so a Russian page showed 09/08/2026 on an American machine and nothing
 * could override it — the attribute that would say so does not exist. And its calendar is
 * the browser's too: a 220px popover behind a 16px glyph, which is the whole of the
 * complaint that it is too small to use.
 *
 * So the control is ours. The input is an ordinary text input carrying the real name, and
 * it works with the calendar closed, with the calendar removed, and with JavaScript off —
 * a typed 8.9.2026 parses exactly like a picked one, because both go through
 * lib/dates.ts:parseDateInput on the server. The calendar is an enhancement over a field
 * that already worked, not the only way in.
 *
 * Everything the picker says is rendered here from the dictionary and handed over in
 * data- attributes; public/date-picker.js contains no user-facing string (rule 6).
 */
export function dateField(o: {
  locale: Locale;
  /** DOM id of the input, so a <label for> outside this component still binds. */
  id: string;
  name: string;
  /**
   * Canonical YYYY-MM-DD. A value that is not one is echoed back as typed rather than
   * blanked, so a form redisplayed after a validation error still holds what was entered.
   */
  value: string | null | undefined;
  required?: boolean;
  /** Extra attributes for the input — the htmx wiring on an answer field. */
  attrs?: Raw;
  /** Bounds the calendar's own "today" marker; the server owns today (rule 4). */
  today: string;
}): Raw {
  const t = dict(o.locale);
  // A pipe cannot occur in a month or weekday name, and the attribute is escaped like
  // every other interpolation, so the join is safe to split on in the browser.
  const months = monthNames(o.locale).join("|");
  const weekdays = weekdayNames(o.locale).join("|");
  const stored = parseDateInput(o.value ?? "");
  const shown = stored === null ? (o.value ?? "") : formatDateInput(stored);

  return html`
    <div class="datepick"
         data-months="${months}" data-weekdays="${weekdays}" data-today-on="${o.today}"
         data-today="${t.dates.today}" data-clear="${t.dates.clear}"
         data-prev="${t.dates.prevMonth}" data-next="${t.dates.nextMonth}"
         data-close="${t.dates.close}" data-dialog="${t.dates.chooseDate}">
      <input type="text" id="${o.id}" name="${o.name}" class="datepick-input"
             value="${shown}" placeholder="${t.dates.format}"
             inputmode="numeric" autocomplete="off" spellcheck="false"
             ${o.required ? raw("required") : ""} ${o.attrs ?? ""} />
      <button type="button" class="datepick-open" tabindex="-1"
              aria-label="${t.dates.openCalendar}" title="${t.dates.openCalendar}">
        <span aria-hidden="true">\u{1F5D3}</span>
      </button>
    </div>
  `;
}
