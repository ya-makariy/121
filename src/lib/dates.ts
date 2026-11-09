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

/**
 * The date as a person types it: day, then month, then year.
 *
 * `<input type="date">` cannot be asked for that. A native date control takes its display
 * format from the browser's own locale, so the same Russian page rendered 08.09.2026 on
 * one machine and 09/08/2026 on the next, and nothing on the page could say which. The app
 * therefore carries its own date field (views/components/date-field.ts), and the order
 * becomes a property of the app rather than of the machine it is opened on.
 *
 * This is the boundary: everything behind it is YYYY-MM-DD, as rule 4 requires. The parser
 * is deliberately locale-free — it accepts one order and one order only, so there is no
 * reading of "03.04.2026" that depends on who is looking. The canonical form is accepted
 * too, because that is what a browser without JavaScript and every existing link still
 * send.
 */
const TYPED_DATE_RE = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/;

/**
 * The same acceptance as parseDateInput, as an HTML `pattern` for the date field: a typed
 * day-month-year with any of the three separators, or the canonical form. The browser
 * refuses to submit anything else, so "text in a date field" is caught before the server
 * silently stores no date. Whether the date *exists* (31.02.) is still the server's call.
 */
// Browsers compile `pattern` with the `v` flag, where `/` and `-` inside a class must be
// escaped; a pattern that fails to compile is silently ignored, so this is checked by a test.
export const DATE_INPUT_PATTERN = "\\s*(\\d{1,2}[.\\/\\-]\\d{1,2}[.\\/\\-]\\d{4}|\\d{4}-\\d{2}-\\d{2})\\s*";

/** True for a date that exists: 31.02.2026 parses and is still not a day. */
function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map((x) => Number.parseInt(x, 10)) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** "08.09.2026" or "2026-09-08" -> "2026-09-08". null when it is not a date at all. */
export function parseDateInput(value: string): string | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (DATE_RE.test(raw)) return isRealDate(raw) ? raw : null;

  const m = TYPED_DATE_RE.exec(raw);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}

/** "2026-09-08" -> "08.09.2026". The inverse of parseDateInput, for filling the field. */
export function formatDateInput(value: string | null | undefined): string {
  if (!value || !DATE_RE.test(value)) return "";
  const [y, m, d] = value.split("-") as [string, string, string];
  return `${d}.${m}.${y}`;
}

/**
 * A birthday: a day in the year, with the year itself optional.
 *
 * Not a date. A date names one day in history; a birthday recurs, and the year is a
 * separate fact that a person may prefer to keep to themselves. So it is its own type,
 * parsed by its own function, and stored in its own columns (migration 0006).
 */
export interface Birthday {
  month: number;
  day: number;
  year: number | null;
}

// Day and month, then optionally a year, in the same order and with the same separators as
// a typed date. The year-less ISO form (--MM-DD) is accepted for the same reason the
// canonical date is: it is what a script or an old link would send.
const TYPED_BIRTHDAY_RE = /^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{4}))?$/;
const ISO_BIRTHDAY_RE = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/;

/**
 * The HTML `pattern` for the birthday field: what parseBirthdayInput accepts, so the
 * browser refuses the rest before the server does. Same `v`-flag escaping as the date one.
 */
export const BIRTHDAY_INPUT_PATTERN =
  "\\s*(\\d{1,2}[.\\/\\-]\\d{1,2}([.\\/\\-]\\d{4})?|(\\d{4}|-)-\\d{2}-\\d{2})\\s*";

/**
 * "12.11", "12.11.1990", "1990-11-12" or "--11-12" -> {month, day, year}. null when it is
 * not a birthday at all. A day that does not exist is refused, not rolled over; without a
 * year the check is made in a leap year, so the 29th of February is a birthday one can
 * have.
 */
export function parseBirthdayInput(value: string): Birthday | null {
  const raw = value.trim();
  if (raw === "") return null;

  let day: number, month: number, year: number | null;
  const typed = TYPED_BIRTHDAY_RE.exec(raw);
  const iso = typed ? null : ISO_BIRTHDAY_RE.exec(raw);
  if (typed) {
    day = Number.parseInt(typed[1]!, 10);
    month = Number.parseInt(typed[2]!, 10);
    year = typed[3] === undefined ? null : Number.parseInt(typed[3], 10);
  } else if (iso) {
    year = iso[1] === undefined ? null : Number.parseInt(iso[1], 10);
    month = Number.parseInt(iso[2]!, 10);
    day = Number.parseInt(iso[3]!, 10);
  } else {
    return null;
  }

  // The same bounds as the CHECK constraints in migration 0006, so a value the parser
  // accepts is a value the database accepts.
  if (year !== null && (year < 1900 || year > 2100)) return null;
  const probeYear = year ?? 2000;
  const iso8601 = `${probeYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!DATE_RE.test(iso8601) || !isRealDate(iso8601)) return null;
  return { month, day, year };
}

/** The inverse of parseBirthdayInput, for filling the field: "12.11" or "12.11.1990". */
export function formatBirthdayInput(b: Birthday | null | undefined): string {
  if (!b) return "";
  const dayMonth = `${String(b.day).padStart(2, "0")}.${String(b.month).padStart(2, "0")}`;
  return b.year === null ? dayMonth : `${dayMonth}.${b.year}`;
}

/**
 * The day the birthday falls on in a given year, as YYYY-MM-DD. The 29th of February
 * lands on the 28th when the year has no 29th: the reminder is about the person, and a
 * person born on the 29th does not skip a year.
 */
export function birthdayInYear(b: Birthday, year: number): string {
  const yearStr = String(year).padStart(4, "0");
  const candidate = `${yearStr}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
  if (isRealDate(candidate)) return candidate;
  return `${yearStr}-02-28`;
}
