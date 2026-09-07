/**
 * Даты в 121: момент времени — ISO-8601 UTC, дата — YYYY-MM-DD.
 * См. CLAUDE.md §3: date('now') в SQLite это UTC, и вечером в Москве он уже врёт.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

/** Сегодняшняя дата в указанном часовом поясе, в формате YYYY-MM-DD. */
export function todayInTz(timezone: string, at: Date = new Date()): string {
  // en-CA даёт ровно YYYY-MM-DD.
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
    throw new Error(`${what} должно быть датой YYYY-MM-DD, получено: ${value}`);
  }
  return value;
}

/** Сдвиг даты на дни, без часовых поясов: считаем в UTC-полдне, чтобы не поймать DST. */
export function addDays(date: string, days: number): string {
  assertDateOnly(date, "дата");
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  assertDateOnly(from, "дата от");
  assertDateOnly(to, "дата до");
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatDate(date: string, locale: "ru" | "en"): string {
  if (!DATE_RE.test(date)) return date;
  const [y, m, d] = date.split("-").map((x) => Number.parseInt(x, 10)) as [number, number, number];
  if (locale === "ru") return `${d} ${RU_MONTHS[m - 1]} ${y}`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

const RU_MONTHS_NOM = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** «2026-05» -> «май 2026» / «May 2026». Ось X сравнения группируется по месяцам. */
export function formatMonth(period: string, locale: "ru" | "en"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const year = m[1]!;
  const month = Number.parseInt(m[2]!, 10);
  if (locale === "ru") return `${RU_MONTHS_NOM[month - 1]} ${year}`;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })
    .format(new Date(Date.UTC(Number.parseInt(year, 10), month - 1, 15)));
}
