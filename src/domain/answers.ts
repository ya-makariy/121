import type { Database } from "bun:sqlite";
import type { AnswerRow, FieldWithOptions } from "../db/types.ts";
import { isDateOnly } from "../lib/dates.ts";
import { nowIso } from "../lib/dates.ts";

/**
 * ЕДИНСТВЕННОЕ место, где решается, в какую колонку ложится значение поля.
 * См. CLAUDE.md §2. Таблица правил:
 *
 *   scale              -> num_value
 *   text, short_text   -> text_value
 *   checkbox           -> bool_value
 *   date               -> date_value
 *   single_select      -> num_value = score выбранной опции, ровно одна строка опции
 *   multi_select       -> строки опций, 0..n
 *
 * num_value для single_select — единственная денормализация в таблице значений: она
 * позволяет v_metric_point остаться плоским джойном. Пишет её эта же функция, которая
 * разрешает опцию, поэтому разъехаться они не могут.
 */

export interface RawAnswer {
  /** Для scale/date/text/short_text — строка из формы; для checkbox — наличие значения. */
  value?: string | null;
  /** Для single_select — один ключ; для multi_select — набор ключей. */
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

export class AnswerValidationError extends Error {}

function fail(message: string): never {
  throw new AnswerValidationError(message);
}

/** Пустой ответ — это стирание, а не ошибка: встречу заполняют по ходу разговора. */
export function isBlank(field: FieldWithOptions, raw: RawAnswer): boolean {
  if (field.type === "checkbox") return false; // чекбокс всегда имеет значение
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
      if (!Number.isFinite(n)) fail(`«${field.label}»: ожидается число`);
      const min = field.scale_min ?? 1;
      const max = field.scale_max ?? 5;
      if (n < min || n > max) fail(`«${field.label}»: значение вне шкалы ${min}-${max}`);
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
      const v = (raw.value ?? "").trim();
      if (!isDateOnly(v)) fail(`«${field.label}»: ожидается дата в формате ГГГГ-ММ-ДД`);
      return { ...empty, date_value: v };
    }

    case "single_select": {
      const keys = (raw.optionKeys ?? []).filter((k) => k !== "");
      if (keys.length !== 1) fail(`«${field.label}»: нужно выбрать ровно один вариант`);
      const opt = field.options.find((o) => o.option_key === keys[0]);
      if (!opt) fail(`«${field.label}»: неизвестный вариант ${keys[0]}`);
      if (field.metric_id !== null && opt.score === null) {
        fail(
          `«${field.label}»: вариант «${opt.label}» без score, а поле привязано к метрике. ` +
            `Проставьте score всем вариантам в редакторе шаблона.`,
        );
      }
      return {
        ...empty,
        num_value: opt.score,
        optionIds: [opt.id],
        optionKeys: [opt.option_key],
      };
    }

    case "multi_select": {
      const keys = [...new Set((raw.optionKeys ?? []).filter((k) => k !== ""))];
      const opts = keys.map((k) => {
        const o = field.options.find((x) => x.option_key === k);
        if (!o) fail(`«${field.label}»: неизвестный вариант ${k}`);
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

/** Записывает или стирает ответ. Возвращает строку ответа или null, если стёрли. */
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
    .query<AnswerRow, [number, number, string, number | null, string | null, string | null, number | null, string]>(
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
