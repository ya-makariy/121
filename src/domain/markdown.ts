import type { SharePayload, SnapshotItem } from "./snapshot.ts";
import { formatDate } from "../i18n/dates.ts";
import { dict } from "../i18n/index.ts";

/**
 * The Markdown summary for the mentee. Rendered FROM THE SAME snapshot as the HTML page,
 * so two rendering paths cannot disagree about what is visible and what is not.
 *
 * In v1 this is the main way to share: while the app runs on localhost the mentee cannot
 * open the link, so the file is copied into a messenger.
 */

type Dict = ReturnType<typeof dict>;

function itemToMarkdown(item: SnapshotItem, t: Dict): string | null {
  if (item.scale) {
    const edge = item.scale.value === item.scale.min
      ? item.scale.minLabel
      : item.scale.value === item.scale.max
        ? item.scale.maxLabel
        : null;
    const suffix = edge ? ` (${edge})` : "";
    return `- **${item.label}:** ${item.scale.value} ${t.common.of} ${item.scale.max}${suffix}`;
  }
  if (item.options) return `- **${item.label}:** ${item.options}`;
  if (item.checked !== null) {
    return `- **${item.label}:** ${item.checked ? t.common.yes : t.common.no}`;
  }
  if (item.date) return `- **${item.label}:** ${item.date}`;
  if (item.text && item.text.trim() !== "") {
    // Multi-line text becomes a paragraph: it is the substance of the meeting.
    return item.text.includes("\n")
      ? `**${item.label}**\n\n${item.text.trim()}`
      : `- **${item.label}:** ${item.text.trim()}`;
  }
  return null;
}

export function renderMarkdown(payload: SharePayload): string {
  const t = dict(payload.locale);
  const out: string[] = [];

  out.push(
    `# ${t.md.meetingWith} ${payload.personName} — ${formatDate(payload.heldOn, payload.locale)}`,
  );
  if (payload.title) out.push(`_${payload.title}_`);

  for (const section of payload.sections) {
    const lines = section.items
      .map((i) => itemToMarkdown(i, t))
      .filter((l): l is string => l !== null);
    if (lines.length === 0) continue;
    out.push(`## ${section.title}`);
    out.push(lines.join("\n"));
  }

  if (payload.actions.length > 0) {
    out.push(`## ${t.md.agreements}`);
    out.push(
      payload.actions
        .map((a) => {
          const who =
            a.assignee === "manager" ? t.md.assigneeManager
            : a.assignee === "person" ? t.md.assigneePerson
            : t.md.assigneeBoth;
          const meta = [who];
          if (a.dueOn) meta.push(`${t.md.due} ${a.dueOn}`);
          if (a.status === "done") meta.push(t.md.done);
          if (a.status === "dropped") meta.push(t.md.dropped);
          const box = a.status === "done" ? "x" : " ";
          const details = a.details ? `\n  ${a.details.replace(/\n/g, "\n  ")}` : "";
          return `- [${box}] ${a.title} — ${meta.join(", ")}${details}`;
        })
        .join("\n"),
    );
  }

  out.push(`---\n${t.md.generated}: ${payload.generatedAt.slice(0, 10)}`);
  return out.join("\n\n") + "\n";
}
