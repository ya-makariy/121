import type { Locale } from "../db/types.ts";

/**
 * Date formatting for people. Lives in the localization layer, not in lib/, because it
 * carries locale data: Intl gives Russian month names in the nominative case ("сентябрь")
 * where a date needs the genitive ("7 сентября"), so the correct forms are spelled out.
 *
 * lib/dates.ts keeps the locale-free arithmetic.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const RU_MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export function formatDate(date: string, locale: Locale): string {
  if (!DATE_RE.test(date)) return date;
  const [y, m, d] = date.split("-").map((x) => Number.parseInt(x, 10)) as [number, number, number];
  if (locale === "ru") return `${d} ${RU_MONTHS_GENITIVE[m - 1]} ${y}`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "2026-05" -> "май 2026" / "May 2026". The comparison chart's x-axis is monthly. */
export function formatMonth(period: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const year = m[1]!;
  const month = Number.parseInt(m[2]!, 10);
  if (locale === "ru") return `${RU_MONTHS_NOMINATIVE[month - 1]} ${year}`;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })
    .format(new Date(Date.UTC(Number.parseInt(year, 10), month - 1, 15)));
}

/**
 * The calendar's own vocabulary.
 *
 * The picker's header names a month rather than dating one, so it takes the nominative
 * ("сентябрь"), not the genitive formatDate uses. Both arrays live here for the same
 * reason formatDate does: they are locale data, and rule 1 puts locale data in src/i18n/
 * and nowhere else. public/date-picker.js receives them through data- attributes, so no
 * user-facing text is hardcoded in JavaScript (rule 6).
 */
const RU_WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function monthNames(locale: Locale): string[] {
  if (locale === "ru") return [...RU_MONTHS_NOMINATIVE];
  const fmt = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2024, m, 15))));
}

/** Monday first: the week starts on Monday in both locales the app speaks. */
export function weekdayNames(locale: Locale): string[] {
  if (locale === "ru") return [...RU_WEEKDAYS_SHORT];
  // 2024-01-01 was a Monday, so seven consecutive days from it are Mon..Sun in order.
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}
