import { html, type Raw } from "../html.ts";
import { dict } from "../../i18n/index.ts";
import { formatDate } from "../../i18n/dates.ts";
import { dateField } from "./date-field.ts";
import type { ActionItemRow, Assignee, Locale } from "../../db/types.ts";

/**
 * The agreements made in the meeting you are in.
 *
 * They used to be invisible. The form posted, the browser followed a 303 back to the top
 * of a 1600px page, and what you had just agreed appeared nowhere — the carry-over block
 * above deliberately shows only *other* meetings' agreements, so the one thing you could
 * not see on this page was the thing you had written on it.
 *
 * So the list lives here, right above the form, and it fills in place: the form posts with
 * htmx and only the list is replaced, which is also what stops the page jumping. The form
 * itself is outside the swapped region — it keeps its place on screen, resets itself, and
 * the cursor never has to be put back.
 *
 * While the meeting is a draft each line can be dropped, because a line written down two
 * minutes ago has no history to protect; completing the meeting is what enters them (see
 * queries/actions.ts:deleteMeetingAction and the gate in openActions).
 */

/** The id of the swapped region; the form and the drop buttons both aim at it. */
export const AGREEMENT_LIST_ID = "agreement-list";

function assigneeLabel(assignee: Assignee, t: ReturnType<typeof dict>): string {
  if (assignee === "manager") return t.meeting.assigneeManager;
  if (assignee === "both") return t.meeting.assigneeBoth;
  return t.meeting.assigneePerson;
}

/** Just the list — this is what the POST and DELETE routes return to htmx. */
export function agreementList(o: {
  locale: Locale; meetingId: number; actions: ActionItemRow[]; editable: boolean;
}): Raw {
  const t = dict(o.locale);
  if (o.actions.length === 0) {
    return html`<div class="empty small">${t.meeting.agreedHereEmpty}</div>`;
  }

  return html`
    <div class="rows">
      ${o.actions.map(
        (a) => html`
          <div class="row agreement">
            <span class="grow">
              <span class="name">${a.title}</span>
              ${a.details ? html`<span class="preview-line">${a.details}</span>` : ""}
            </span>
            <span class="badge neutral">${assigneeLabel(a.assignee, t)}</span>
            ${a.due_on
              ? html`<span class="small muted">${t.meeting.dueOn} ${formatDate(a.due_on, o.locale)}</span>`
              : ""}
            <span class="badge ${a.visibility === "private" ? "private" : "shared"}">
              ${a.visibility === "private" ? t.meeting.visibilityPrivate : t.meeting.visibilityShared}
            </span>
            ${o.editable
              ? html`
                  <button class="link danger" type="button"
                          hx-post="/meetings/${o.meetingId}/actions/${a.id}/delete"
                          hx-target="#${AGREEMENT_LIST_ID}" hx-swap="innerHTML">
                    ${t.meeting.removeAction}
                  </button>
                `
              : ""}
          </div>
        `,
      )}
    </div>
  `;
}

/** The whole block: heading, the list, and — while the meeting is open — the form. */
export function agreementsSection(o: {
  locale: Locale; meetingId: number; actions: ActionItemRow[]; editable: boolean;
  today: string;
}): Raw {
  const t = dict(o.locale);

  return html`
    <h2>${t.meeting.agreedHere}</h2>
    ${o.editable ? html`<p class="section-desc">${t.meeting.agreedHereHint}</p>` : ""}
    <div id="${AGREEMENT_LIST_ID}" class="agreements">
      ${agreementList(o)}
    </div>

    ${o.editable
      ? html`
          <!--
            hx-post rather than a plain submit: a 303 back to /meetings/:id reloaded the
            page and put you at the top of it. Only the list above is replaced, so the page
            does not move at all, and the form resets itself once the server has answered.
          -->
          <form class="card agreement-new" hx-post="/meetings/${o.meetingId}/actions"
                hx-target="#${AGREEMENT_LIST_ID}" hx-swap="innerHTML"
                hx-on::after-request="if (event.detail.successful) this.reset()">
            <div class="field">
              <label for="title">${t.meeting.actionTitle}</label>
              <input type="text" id="title" name="title" autocomplete="off" required />
            </div>
            <div class="grid2">
              <div class="field">
                <label for="assignee">${t.meeting.assignee}</label>
                <select id="assignee" name="assignee">
                  <option value="person">${t.meeting.assigneePerson}</option>
                  <option value="manager">${t.meeting.assigneeManager}</option>
                  <option value="both">${t.meeting.assigneeBoth}</option>
                </select>
              </div>
              <div class="field">
                <label for="due_on">${t.meeting.dueOn}</label>
                ${dateField({
                  locale: o.locale, id: "due_on", name: "due_on", value: null, today: o.today,
                })}
              </div>
            </div>
            <div class="field">
              <label for="visibility">${t.meeting.actionVisibility}</label>
              <select id="visibility" name="visibility">
                <option value="shared">${t.meeting.visibilityShared}</option>
                <option value="private">${t.meeting.visibilityPrivate}</option>
              </select>
            </div>
            <button class="primary" type="submit">${t.meeting.newAction}</button>
          </form>
        `
      : ""}
  `;
}
