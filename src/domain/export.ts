import type { Database } from "bun:sqlite";
import type { Locale } from "../db/types.ts";
import { nowIso } from "../lib/dates.ts";
import { dict } from "../i18n/index.ts";

/**
 * EXPORT IS A BACKUP, NOT A SUMMARY. It includes private content: the manager's notes,
 * private fields, attrition-risk assessments. The opposite contract to
 * buildSharedSnapshot(). See CLAUDE.md rule 2 — which is why these are separate functions
 * with separate names, and why the choice between them is never a query parameter.
 */

const TABLES = [
  "app_user", "app_setting", "metric",
  "template", "template_version", "template_section", "template_field", "template_field_option",
  "person", "team", "team_member",
  "meeting", "meeting_answer", "meeting_answer_option",
  "action_item", "meeting_action_review",
  "share_link",
  "_migration_log",
] as const;

export function exportFullJson(db: Database): string {
  const data: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    data[table] = db.query(`SELECT * FROM ${table}`).all();
  }
  return JSON.stringify(
    {
      format: "121-full-export",
      formatVersion: 1,
      containsPrivateData: true,
      exportedAt: nowIso(),
      schemaVersion:
        db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0,
      data,
    },
    null,
    2,
  );
}

interface ExportMeetingRow {
  meeting_id: number;
  held_on: string | null;
  status: string;
  title: string | null;
  private_notes: string | null;
}

export function exportFullMarkdown(db: Database, locale: Locale = "ru"): string {
  const t = dict(locale);
  const out: string[] = [`# ${t.exportDoc.title}`, "", `> ${t.exportDoc.warning}`, ""];

  const people = db
    .query<{ id: number; full_name: string; role_title: string | null; notes: string | null }, []>(
      "SELECT id, full_name, role_title, notes FROM person ORDER BY full_name",
    )
    .all();

  for (const p of people) {
    out.push(`## ${p.full_name}${p.role_title ? ` — ${p.role_title}` : ""}`, "");
    if (p.notes) out.push(`_${t.exportDoc.privateNotes}:_ ${p.notes}`, "");

    const meetings = db
      .query<ExportMeetingRow, [number]>(
        `SELECT m.id AS meeting_id, m.held_on, m.status, m.title, m.private_notes
         FROM meeting m
         WHERE m.person_id = ?
         ORDER BY m.held_on`,
      )
      .all(p.id);

    for (const m of meetings) {
      out.push(
        `### ${m.held_on ?? t.exportDoc.noDate} (${m.status})${m.title ? ` — ${m.title}` : ""}`,
        "",
      );

      const answers = db
        .query<
          { label: string; visibility: string; type: string; num_value: number | null;
            text_value: string | null; date_value: string | null; bool_value: number | null;
            opts: string | null },
          [number]
        >(
          `SELECT f.label, f.visibility, f.type, a.num_value, a.text_value, a.date_value,
                  a.bool_value,
                  (SELECT group_concat(o.label, ', ') FROM meeting_answer_option ao
                   JOIN template_field_option o ON o.id = ao.option_id
                   WHERE ao.answer_id = a.id) AS opts
           FROM meeting_answer a
           JOIN template_field f ON f.id = a.field_id
           JOIN template_section s ON s.id = f.section_id
           WHERE a.meeting_id = ?
           ORDER BY s.position, f.position`,
        )
        .all(m.meeting_id);

      for (const a of answers) {
        const boolText = a.bool_value === null
          ? null
          : a.bool_value === 1 ? t.common.yes : t.common.no;
        const value = a.opts ?? a.num_value ?? a.text_value ?? a.date_value ?? boolText;
        // A padlock marks what must never appear in a mentee-facing summary.
        const mark = a.visibility === "private" ? " 🔒" : "";
        out.push(`- **${a.label}${mark}:** ${value ?? t.common.none}`);
      }
      if (m.private_notes) {
        out.push("", `_${t.exportDoc.privateAboutMeeting}:_ ${m.private_notes}`);
      }
      out.push("");
    }

    const actions = db
      .query<
        { title: string; status: string; assignee: string; due_on: string | null; visibility: string },
        [number]
      >(
        "SELECT title, status, assignee, due_on, visibility FROM action_item WHERE person_id = ? ORDER BY id",
      )
      .all(p.id);

    if (actions.length > 0) {
      out.push(`#### ${t.exportDoc.agreements}`, "");
      for (const a of actions) {
        const due = a.due_on ? `, ${t.exportDoc.due} ${a.due_on}` : "";
        const mark = a.visibility === "private" ? " 🔒" : "";
        out.push(`- [${a.status === "done" ? "x" : " "}] ${a.title} (${a.assignee}${due})${mark}`);
      }
      out.push("");
    }
  }

  return out.join("\n");
}
