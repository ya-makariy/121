import { addDays, daysBetween, todayInTz } from "../lib/dates.ts";
import { config } from "../config.ts";
import { SettingsError } from "../lib/errors.ts";

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

let zoneCache: readonly string[] | undefined;

/**
 * The zones the runtime itself knows, straight from Intl.
 *
 * Deliberately not a table of our own: zone names, offsets and daylight-saving rules
 * change by legislation several times a year, and a hand-kept list would quietly disagree
 * with the very Intl call that todayInTz() uses to answer "what day is it".
 */
export function supportedTimezones(): readonly string[] {
  if (zoneCache === undefined) zoneCache = Intl.supportedValuesOf("timeZone");
  return zoneCache;
}

export function isSupportedTimezone(value: string): boolean {
  return supportedTimezones().includes(value);
}

/**
 * What the picker offers. The stored zone is prepended when Intl does not list it — TZ in
 * the environment may hold a legacy alias such as Asia/Calcutta, and a picker that cannot
 * show the zone in force would read as if a different one were selected.
 */
export function timezoneChoices(current: string): readonly string[] {
  const all = supportedTimezones();
  return all.includes(current) ? all : [current, ...all];
}

/**
 * The timezone is the single input to todayInTz(), so a value Intl does not know would
 * not degrade gracefully: every cadence read would throw, or worse, silently answer with
 * a different day. It is refused before it is stored, with a code the view translates
 * (CLAUDE.md rules 1 and 4).
 */
export function assertTimezone(value: string): string {
  if (!isSupportedTimezone(value)) {
    throw new SettingsError("TIMEZONE_INVALID", { timezone: value });
  }
  return value;
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
