import {
  assertDateOnly, birthdayInYear, daysBetween, type Birthday,
} from "../lib/dates.ts";
import { config } from "../config.ts";

/**
 * Where a birthday stands relative to today. Computed on read, like cadence: there is no
 * cron, and `today` arrives from the caller (domain/cadence.ts:today), never from the
 * clock in here (CLAUDE.md rule 4).
 */
export interface BirthdayState {
  /** The next occurrence on or after today, as YYYY-MM-DD. */
  on: string;
  /** 0 on the day itself. */
  daysUntil: number;
  /** The age the person turns on that day, or null when the year was not given. */
  turning: number | null;
}

export function classifyBirthday(b: Birthday, todayDate: string): BirthdayState {
  assertDateOnly(todayDate, "today");
  const thisYear = Number.parseInt(todayDate.slice(0, 4), 10);

  // This year's occurrence, unless it has already passed; then next year's.
  let on = birthdayInYear(b, thisYear);
  let year = thisYear;
  if (on < todayDate) {
    year = thisYear + 1;
    on = birthdayInYear(b, year);
  }

  return {
    on,
    daysUntil: daysBetween(todayDate, on),
    turning: b.year === null ? null : year - b.year,
  };
}

/**
 * True when the birthday is close enough for the dashboard to mention it: today, or within
 * `windowDays` days ahead. A birthday yesterday is not upcoming; the reminder's job is to
 * leave time to act, not to apologise.
 */
export function isUpcoming(state: BirthdayState, windowDays: number = config.birthdayWindowDays): boolean {
  return state.daysUntil >= 0 && state.daysUntil <= windowDays;
}
