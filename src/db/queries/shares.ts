import type { Database } from "bun:sqlite";
import type { Locale, ShareLinkRow } from "../types.ts";
import { nowIso } from "../../lib/dates.ts";

/**
 * Путь шаринга. Этот модуль НЕ импортирует другие query-модули и читает ответы ТОЛЬКО
 * из представления v_shared_answer. См. CLAUDE.md §1.
 *
 * Колонки везде перечислены явно: `SELECT *` по meeting или person затянул бы
 * private_notes и notes.
 */

export interface ShareHeaderRow {
  meeting_id: number;
  person_name: string;
  held_on: string;
  title: string | null;
  status: string;
  template_version_id: number | null;
  template_name: string | null;
}

export function shareHeader(db: Database, meetingId: number, ownerId = 1): ShareHeaderRow | null {
  return (
    db
      .query<ShareHeaderRow, [number, number]>(
        `SELECT m.id AS meeting_id, p.full_name AS person_name, m.held_on, m.title, m.status,
                m.template_version_id, t.name AS template_name
         FROM meeting m
         JOIN person p ON p.id = m.person_id
         LEFT JOIN template_version tv ON tv.id = m.template_version_id
         LEFT JOIN template t ON t.id = tv.template_id
         WHERE m.id = ? AND m.owner_id = ?`,
      )
      .get(meetingId, ownerId) ?? null
  );
}

export interface SharedAnswerRow {
  answer_id: number;
  field_id: number;
  field_key: string;
  section_id: number;
  section_title: string;
  section_position: number;
  position: number;
  label: string;
  help_text: string | null;
  type: string;
  num_value: number | null;
  text_value: string | null;
  date_value: string | null;
  bool_value: 0 | 1 | null;
  scale_min: number | null;
  scale_max: number | null;
  scale_min_label: string | null;
  scale_max_label: string | null;
  option_labels: string | null;
}

/** Только shared-поля: фильтр живёт в самом представлении. */
export function sharedAnswers(db: Database, meetingId: number): SharedAnswerRow[] {
  return db
    .query<SharedAnswerRow, [number]>(
      `SELECT va.answer_id, va.field_id, va.field_key, va.section_id,
              s.title AS section_title, s.position AS section_position,
              va.position, va.label, va.help_text, va.type,
              va.num_value, va.text_value, va.date_value, va.bool_value,
              va.scale_min, va.scale_max, va.scale_min_label, va.scale_max_label,
              (SELECT group_concat(o.label, ', ')
               FROM meeting_answer_option ao
               JOIN template_field_option o ON o.id = ao.option_id
               WHERE ao.answer_id = va.answer_id) AS option_labels
       FROM v_shared_answer va
       JOIN template_section s ON s.id = va.section_id
       WHERE va.meeting_id = ?
       ORDER BY s.position, va.position, va.field_id`,
    )
    .all(meetingId);
}

export interface SharedActionRow {
  id: number;
  title: string;
  details: string | null;
  assignee: string;
  status: string;
  due_on: string | null;
}

/** Договорённости попадают в саммари только если сами помечены shared. */
export function sharedActionsForMeeting(
  db: Database, meetingId: number, personId: number,
): SharedActionRow[] {
  return db
    .query<SharedActionRow, [number, number, number]>(
      `SELECT DISTINCT ai.id, ai.title, ai.details, ai.assignee, ai.status, ai.due_on
       FROM action_item ai
       LEFT JOIN meeting_action_review r ON r.action_item_id = ai.id AND r.meeting_id = ?
       WHERE ai.visibility = 'shared'
         AND ai.person_id = ?
         AND (ai.created_meeting_id = ? OR r.meeting_id IS NOT NULL)
       ORDER BY (ai.status IN ('done','dropped')), ai.due_on, ai.id`,
    )
    .all(meetingId, personId, meetingId);
}

/**
 * Страховка от утечки: список id приватных полей этой версии шаблона.
 * buildSharedSnapshot сверяет с ним собранный payload и падает при пересечении.
 */
export function privateFieldIds(db: Database, versionId: number): number[] {
  return db
    .query<{ id: number }, [number]>(
      "SELECT id FROM template_field WHERE version_id = ? AND visibility = 'private'",
    )
    .all(versionId)
    .map((r) => r.id);
}

export function insertShareLink(
  db: Database,
  input: { meeting_id: number; token: string; snapshot_json: string; snapshot_hash: string;
           locale: Locale },
  ownerId = 1,
): ShareLinkRow {
  return db
    .query<ShareLinkRow, any[]>(
      `INSERT INTO share_link
         (owner_id, meeting_id, token, snapshot_json, snapshot_hash, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      ownerId, input.meeting_id, input.token, input.snapshot_json, input.snapshot_hash,
      input.locale, nowIso(),
    )!;
}

export function listShareLinks(db: Database, meetingId: number): ShareLinkRow[] {
  return db
    .query<ShareLinkRow, [number]>(
      "SELECT * FROM share_link WHERE meeting_id = ? ORDER BY created_at DESC",
    )
    .all(meetingId);
}

export function findActiveShare(db: Database, token: string): ShareLinkRow | null {
  return (
    db
      .query<ShareLinkRow, [string, string]>(
        `SELECT * FROM share_link
         WHERE token = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(token, nowIso()) ?? null
  );
}

export function revokeShare(db: Database, id: number, ownerId = 1): void {
  db.query("UPDATE share_link SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
    .run(nowIso(), id, ownerId);
}

export function countShareView(db: Database, id: number): void {
  db.query(
    "UPDATE share_link SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?",
  ).run(nowIso(), id);
}
