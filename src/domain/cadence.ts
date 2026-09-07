import { addDays, daysBetween, todayInTz } from "../lib/dates.ts";
import { config } from "../config.ts";

export type CadenceStatus = "overdue" | "due_soon" | "ok" | "no_cadence";

export interface CadenceInput {
  cadenceDays: number | null;
  /** held_on of the last completed meeting that counts as a 1:1. */
  lastHeldOn: string | null;
  /** Anchor used before the first meeting: cadence_anchor_on, or the person's created date. */
  anchorOn: string | null;
}

export interface CadenceState {
  status: CadenceStatus;
  dueOn: string | null;
  /** Negative means overdue by that many days. */
  daysUntilDue: number | null;
  lastHeldOn: string | null;
  daysSinceLast: number | null;
}

export function today(timezone: string = config.timezone): string {
  return todayInTz(timezone);
}

/**
 * Cadence is computed on read; there is no cron.
 *
 * Deliberate: a scheduled future meeting does NOT clear an overdue state — a meeting
 * booked three weeks out does not mean the cadence is being kept. "Scheduled" is shown as
 * a separate flag rather than replacing the status.
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
