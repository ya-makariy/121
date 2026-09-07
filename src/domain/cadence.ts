import { addDays, daysBetween, todayInTz } from "../lib/dates.ts";
import { config } from "../config.ts";

export type CadenceStatus = "overdue" | "due_soon" | "ok" | "no_cadence";

export interface CadenceInput {
  cadenceDays: number | null;
  /** held_on последней завершённой встречи, считающейся за 1:1. */
  lastHeldOn: string | null;
  /** Опора до первой встречи: cadence_anchor_on или дата создания человека. */
  anchorOn: string | null;
}

export interface CadenceState {
  status: CadenceStatus;
  dueOn: string | null;
  /** Отрицательное — просрочено на столько дней. */
  daysUntilDue: number | null;
  lastHeldOn: string | null;
  daysSinceLast: number | null;
}

export function today(timezone: string = config.timezone): string {
  return todayInTz(timezone);
}

/**
 * Каденс считается на чтении, крона нет.
 *
 * Намеренно: запланированная будущая встреча НЕ снимает просрочку — встреча через три
 * недели не значит, что каденс соблюдён. «Запланировано» показывается отдельным флагом,
 * а не подменяет статус.
 */
export function classifyCadence(
  input: CadenceInput,
  todayDate: string,
  dueSoonDays: number = config.dueSoonDays,
): CadenceState {
  const base = input.lastHeldOn ?? input.anchorOn;
  const daysSinceLast = input.lastHeldOn ? daysBetween(input.lastHeldOn, todayDate) : null;

  if (input.cadenceDays === null || base === null) {
    return {
      status: "no_cadence",
      dueOn: null,
      daysUntilDue: null,
      lastHeldOn: input.lastHeldOn,
      daysSinceLast,
    };
  }

  const dueOn = addDays(base, input.cadenceDays);
  const daysUntilDue = daysBetween(todayDate, dueOn);
  const status: CadenceStatus =
    daysUntilDue < 0 ? "overdue" : daysUntilDue <= dueSoonDays ? "due_soon" : "ok";

  return { status, dueOn, daysUntilDue, lastHeldOn: input.lastHeldOn, daysSinceLast };
}
