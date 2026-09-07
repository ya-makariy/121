import type { Locale } from "../db/types.ts";
import { ru, type Dict } from "./ru.ts";
import { en } from "./en.ts";
import { CodedError } from "../lib/errors.ts";

/**
 * Only the application chrome is translated. User-authored content — template names,
 * question wording, metric labels — is stored in a single `label` column in one language:
 * making the manager write every question twice is a tax with no payoff for a single-user
 * tool. See PLAN.md.
 */
const DICTS: Record<Locale, Dict> = { ru, en };

export function dict(locale: Locale): Dict {
  return DICTS[locale] ?? ru;
}

export const LOCALES: Locale[] = ["ru", "en"];

export function isLocale(v: string): v is Locale {
  return v === "ru" || v === "en";
}

/** Fills `{name}` placeholders in a dictionary string. */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole);
}

type MessageTable = Record<string, string>;

/**
 * Renders a domain error for a person. The domain throws a code; the wording and its
 * translation live here (CLAUDE.md rule 1).
 */
export function errorMessage(locale: Locale, err: unknown): string {
  const t = dict(locale);
  if (err instanceof CodedError) {
    const table = t.errors as unknown as MessageTable;
    const template = table[err.code];
    if (template !== undefined) return format(template, err.params);
  }
  return t.errors.unknown;
}

/** Renders a template-check problem. Same split as errors: code in the domain, words here. */
export function problemMessage(
  locale: Locale, code: string, params: Record<string, string | number> = {},
): string {
  const table = dict(locale).problems as unknown as MessageTable;
  const template = table[code];
  return template === undefined ? code : format(template, params);
}

/**
 * Pluralization. Russian needs three forms where English needs two; without this the
 * interface says "1 точек" and looks unfinished.
 */
export function plural(locale: Locale, n: number, forms: readonly string[]): string {
  return `${n} ${pluralForm(locale, n, forms)}`;
}

/**
 * The agreeing form on its own, without the number in front of it. The dashboard headline
 * sets the digits in their own element so they can be emphasized, and still must not
 * reimplement the three-form rule to do it.
 */
export function pluralForm(locale: Locale, n: number, forms: readonly string[]): string {
  if (locale === "en") return forms[n === 1 ? 0 : 1] ?? "";
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  const form =
    mod100 >= 11 && mod100 <= 14 ? 2
    : mod10 === 1 ? 0
    : mod10 >= 2 && mod10 <= 4 ? 1
    : 2;
  return forms[form] ?? "";
}
