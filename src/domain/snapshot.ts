import type { Database } from "bun:sqlite";
import type { Locale } from "../db/types.ts";
import {
  privateFieldIds, shareHeader, sharedActionsForMeeting, sharedAnswers,
} from "../db/queries/shares.ts";
import { nowIso } from "../lib/dates.ts";

/**
 * ЕДИНСТВЕННЫЙ сборщик снапшота для подопечного. См. CLAUDE.md §1.
 *
 * Снапшот неизменяем: собирается один раз на момент шаринга и сохраняется в
 * share_link.snapshot_json. Подопечный не увидит правок, сделанных после — пока не
 * поделишься заново. Это осознанно: отправленное саммари не должно меняться за спиной.
 */

export const SNAPSHOT_VERSION = 1;

export interface SnapshotItem {
  fieldKey: string;
  label: string;
  helpText: string | null;
  type: string;
  /** Готовое к показу значение. */
  text: string | null;
  scale: { value: number; min: number; max: number; minLabel: string | null; maxLabel: string | null } | null;
  checked: boolean | null;
  date: string | null;
  options: string | null;
}

export interface SnapshotSection {
  title: string;
  items: SnapshotItem[];
}

export interface SnapshotAction {
  title: string;
  details: string | null;
  assignee: string;
  status: string;
  dueOn: string | null;
}

export interface SharePayload {
  snapshotVersion: number;
  generatedAt: string;
  locale: Locale;
  personName: string;
  heldOn: string;
  title: string | null;
  templateName: string | null;
  sections: SnapshotSection[];
  actions: SnapshotAction[];
}

export class PrivacyLeakError extends Error {}
export class SnapshotError extends Error {}

export function buildSharedSnapshot(
  db: Database, meetingId: number, locale: Locale, ownerId = 1,
): SharePayload {
  const header = shareHeader(db, meetingId, ownerId);
  if (!header) throw new SnapshotError(`Встреча ${meetingId} не найдена`);
  if (!header.held_on) throw new SnapshotError("У встречи не указана дата — нечего отправлять");

  const rows = sharedAnswers(db, meetingId);

  // Страховка: ни одно приватное поле не могло попасть в выборку. Представление уже
  // фильтрует, но проверка стоит один запрос и ловит будущую правку представления.
  if (header.template_version_id !== null) {
    const forbidden = new Set(privateFieldIds(db, header.template_version_id));
    const leaked = rows.filter((r) => forbidden.has(r.field_id));
    if (leaked.length > 0) {
      throw new PrivacyLeakError(
        `Приватные поля попали в снапшот встречи ${meetingId}: ` +
          leaked.map((r) => `${r.field_key} (#${r.field_id})`).join(", "),
      );
    }
  }

  const sections: SnapshotSection[] = [];
  for (const r of rows) {
    const item: SnapshotItem = {
      fieldKey: r.field_key,
      label: r.label,
      helpText: r.help_text,
      type: r.type,
      text: r.text_value,
      scale:
        r.type === "scale" && r.num_value !== null
          ? {
              value: r.num_value,
              min: r.scale_min ?? 1,
              max: r.scale_max ?? 5,
              minLabel: r.scale_min_label,
              maxLabel: r.scale_max_label,
            }
          : null,
      checked: r.type === "checkbox" ? r.bool_value === 1 : null,
      date: r.date_value,
      options: r.option_labels,
    };

    const last = sections.at(-1);
    if (last && last.title === r.section_title) last.items.push(item);
    else sections.push({ title: r.section_title, items: [item] });
  }

  const actions = sharedActionsForMeeting(db, meetingId, personIdOf(db, meetingId));

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedAt: nowIso(),
    locale,
    personName: header.person_name,
    heldOn: header.held_on,
    title: header.title,
    templateName: header.template_name,
    sections,
    actions: actions.map((a) => ({
      title: a.title,
      details: a.details,
      assignee: a.assignee,
      status: a.status,
      dueOn: a.due_on,
    })),
  };
}

function personIdOf(db: Database, meetingId: number): number {
  const row = db
    .query<{ person_id: number }, [number]>("SELECT person_id FROM meeting WHERE id = ?")
    .get(meetingId);
  if (!row) throw new SnapshotError(`Встреча ${meetingId} не найдена`);
  return row.person_id;
}

export function hashPayload(payload: SharePayload): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(payload)).digest("hex");
}
