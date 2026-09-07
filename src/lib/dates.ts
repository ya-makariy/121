/**
 * Dates in 121: an instant is ISO-8601 UTC, a date is YYYY-MM-DD.
 * See CLAUDE.md rule 4: date('now') in SQLite is UTC, and by evening in Moscow it lies.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date in the given timezone, as YYYY-MM-DD. */
export function todayInTz(timezone: string, at: Date = new Date()): string {
  // en-CA yields exactly YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_RE.test(value);
}

export function assertDateOnly(value: string, what: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`${what} must be a YYYY-MM-DD date, got: ${value}`);
  }
  return value;
}

/** Shifts a date by days. Computed at UTC noon so daylight-saving shifts cannot bite. */
export function addDays(date: string, days: number): string {
  assertDateOnly(date, "date");
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  assertDateOnly(from, "from date");
  assertDateOnly(to, "to date");
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
