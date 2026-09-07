import type { SharePayload, SnapshotItem } from "./snapshot.ts";
import { formatDate } from "../lib/dates.ts";

/**
 * Markdown саммари для подопечного. Рендерится ИЗ ТОГО ЖЕ снапшота, что и HTML-страница:
 * два разных пути рендеринга не могут разойтись в том, что видно, а что нет.
 *
 * В v1 это основной способ поделиться: пока приложение на localhost, ссылку подопечный
 * не откроет — файл копируется в мессенджер.
 */

const RU = {
  meetingWith: "1:1 с",
  agreements: "Договорённости",
  assigneeManager: "на мне",
  assigneePerson: "на тебе",
  assigneeBoth: "на нас обоих",
  due: "срок",
  done: "сделано",
  dropped: "снято",
  scaleOf: "из",
  yes: "да",
  no: "нет",
  generated: "Саммари собрано",
};

const EN = {
  meetingWith: "1:1 with",
  agreements: "Agreements",
  assigneeManager: "on me",
  assigneePerson: "on you",
  assigneeBoth: "on both of us",
  due: "due",
  done: "done",
  dropped: "dropped",
  scaleOf: "of",
  yes: "yes",
  no: "no",
  generated: "Summary generated",
};

function itemToMarkdown(item: SnapshotItem, t: typeof RU): string | null {
  if (item.scale) {
    const edge = item.scale.value === item.scale.min
      ? item.scale.minLabel
      : item.scale.value === item.scale.max
        ? item.scale.maxLabel
        : null;
    const suffix = edge ? ` (${edge})` : "";
    return `- **${item.label}:** ${item.scale.value} ${t.scaleOf} ${item.scale.max}${suffix}`;
  }
  if (item.options) return `- **${item.label}:** ${item.options}`;
  if (item.checked !== null) return `- **${item.label}:** ${item.checked ? t.yes : t.no}`;
  if (item.date) return `- **${item.label}:** ${item.date}`;
  if (item.text && item.text.trim() !== "") {
    // Многострочный текст выносим абзацем: он и есть содержание встречи.
    return item.text.includes("\n")
      ? `**${item.label}**\n\n${item.text.trim()}`
      : `- **${item.label}:** ${item.text.trim()}`;
  }
  return null;
}

export function renderMarkdown(payload: SharePayload): string {
  const t = payload.locale === "en" ? EN : RU;
  const out: string[] = [];

  out.push(`# ${t.meetingWith} ${payload.personName} — ${formatDate(payload.heldOn, payload.locale)}`);
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
    out.push(`## ${t.agreements}`);
    out.push(
      payload.actions
        .map((a) => {
          const who =
            a.assignee === "manager" ? t.assigneeManager
            : a.assignee === "person" ? t.assigneePerson
            : t.assigneeBoth;
          const meta = [who];
          if (a.dueOn) meta.push(`${t.due} ${a.dueOn}`);
          if (a.status === "done") meta.push(t.done);
          if (a.status === "dropped") meta.push(t.dropped);
          const box = a.status === "done" ? "x" : " ";
          const details = a.details ? `\n  ${a.details.replace(/\n/g, "\n  ")}` : "";
          return `- [${box}] ${a.title} — ${meta.join(", ")}${details}`;
        })
        .join("\n"),
    );
  }

  out.push(`---\n${t.generated}: ${payload.generatedAt.slice(0, 10)}`);
  return out.join("\n\n") + "\n";
}
