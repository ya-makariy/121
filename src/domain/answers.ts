import type { Database } from "bun:sqlite";
import type { AnswerRow, FieldWithOptions } from "../db/types.ts";
import { nowIso, parseDateInput } from "../lib/dates.ts";
import { AnswerValidationError } from "../lib/errors.ts";

/**
 * The ONLY place that decides which column a field's value goes into.
 * See CLAUDE.md rule 3. The rules:
 *
 *   scale              -> num_value
 *   text, short_text   -> text_value
 *   checkbox           -> bool_value
 *   date               -> date_value
 *   single_select      -> num_value = chosen option's score, plus exactly one option row
 *   multi_select       -> option rows, 0..n
 *
 * Writing the option score into num_value for single_select is the one denormalization in
 * the values table: it lets v_metric_point stay a flat join. The same function that
 * resolves the option writes it, so the two cannot drift apart.
 */

export interface RawAnswer {
  /** scale/date/text/short_text take a form string; checkbox takes presence. */
  value?: string | null;
  /** single_select takes one key; multi_select takes a set. */
  optionKeys?: string[];
}

export interface AnswerValues {
  num_value: number | null;
  text_value: string | null;
  date_value: string | null;
  bool_value: 0 | 1 | null;
  optionIds: number[];
  optionKeys: string[];
}

/** An empty answer erases rather than fails: a meeting is filled in as it goes. */
export function isBlank(field: FieldWithOptions, raw: RawAnswer): boolean {
  if (field.type === "checkbox") return false; // a checkbox always has a value
  if (field.type === "single_select" || field.type === "multi_select") {
    return (raw.optionKeys ?? []).filter((k) => k !== "").length === 0;
  }
  return raw.value === undefined || raw.value === null || raw.value.trim() === "";
}

export function normalizeAnswer(field: FieldWithOptions, raw: RawAnswer): AnswerValues {
  const empty: AnswerValues = {
    num_value: null, text_value: null, date_value: null, bool_value: null,
    optionIds: [], optionKeys: [],
  };

  switch (field.type) {
    case "scale": {
      const n = Number.parseFloat((raw.value ?? "").trim());
      if (!Number.isFinite(n)) {
        throw new AnswerValidationError("ANSWER_NOT_A_NUMBER", { label: field.label });
      }
      const min = field.scale_min ?? 1;
      const max = field.scale_max ?? 5;
      if (n < min || n > max) {
        throw new AnswerValidationError("ANSWER_OUT_OF_SCALE", { label: field.label, min, max });
      }
      return { ...empty, num_value: n };
    }

    case "text":
    case "short_text":
      return { ...empty, text_value: (raw.value ?? "").trim() };

    case "checkbox": {
      const on = raw.value === "on" || raw.value === "1" || raw.value === "true";
      return { ...empty, bool_value: on ? 1 : 0 };
    }

    case "date": {
      // The field posts day-month-year (views/components/date-field.ts); the column keeps
      // YYYY-MM-DD, as rule 4 requires. parseDateInput accepts either and is the only
      // place that reading is undone.
      const v = parseDateInput(raw.value ?? "");
      if (v === null) {
        throw new AnswerValidationError("ANSWER_BAD_DATE", { label: field.label });
      }
      return { ...empty, date_value: v };
    }

    case "single_select": {
      const keys = (raw.optionKeys ?? []).filter((k) => k !== "");
      if (keys.length !== 1) {
        throw new AnswerValidationError("ANSWER_NEED_ONE_OPTION", { label: field.label });
      }
      const opt = field.options.find((o) => o.option_key === keys[0]);
      if (!opt) {
        throw new AnswerValidationError("ANSWER_UNKNOWN_OPTION", { label: field.label });
      }
      if (field.metric_id !== null && opt.score === null) {
        throw new AnswerValidationError("ANSWER_OPTION_NEEDS_SCORE", {
          label: field.label, option: opt.label,
        });
      }
      return { ...empty, num_value: opt.score, optionIds: [opt.id], optionKeys: [opt.option_key] };
    }

    case "multi_select": {
      const keys = [...new Set((raw.optionKeys ?? []).filter((k) => k !== ""))];
      const opts = keys.map((k) => {
        const o = field.options.find((x) => x.option_key === k);
        if (!o) throw new AnswerValidationError("ANSWER_UNKNOWN_OPTION", { label: field.label });
        return o;
      });
      return {
        ...empty,
        optionIds: opts.map((o) => o.id),
        optionKeys: opts.map((o) => o.option_key),
      };
    }
  }
}

/** Writes or erases an answer. Returns the row, or null if it was erased. */
export function saveAnswer(
  db: Database,
  meetingId: number,
  field: FieldWithOptions,
  raw: RawAnswer,
): AnswerRow | null {
  if (isBlank(field, raw)) {
    db.query("DELETE FROM meeting_answer WHERE meeting_id = ? AND field_id = ?")
      .run(meetingId, field.id);
    return null;
  }

  const v = normalizeAnswer(field, raw);
  const now = nowIso();

  const row = db
    .query<AnswerRow, any[]>(
      `INSERT INTO meeting_answer
         (meeting_id, field_id, field_key, num_value, text_value, date_value, bool_value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (meeting_id, field_id) DO UPDATE SET
         num_value = excluded.num_value,
         text_value = excluded.text_value,
         date_value = excluded.date_value,
         bool_value = excluded.bool_value,
         updated_at = excluded.updated_at
       RETURNING *`,
    )
    .get(
      meetingId, field.id, field.field_key,
      v.num_value, v.text_value, v.date_value, v.bool_value, now,
    )!;

  db.query("DELETE FROM meeting_answer_option WHERE answer_id = ?").run(row.id);
  if (v.optionIds.length > 0) {
    const ins = db.query(
      "INSERT INTO meeting_answer_option (answer_id, option_id, option_key) VALUES (?, ?, ?)",
    );
    v.optionIds.forEach((optionId, i) => ins.run(row.id, optionId, v.optionKeys[i]!));
  }

  db.query("UPDATE meeting SET updated_at = ? WHERE id = ?").run(now, meetingId);
  return row;
}

export { AnswerValidationError };
