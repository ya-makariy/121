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
