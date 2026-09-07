import type { Locale } from "../db/types.ts";
import { ru, type Dict } from "./ru.ts";
import { en } from "./en.ts";

/**
 * Переводится только «хром» интерфейса. Пользовательский контент — названия шаблонов,
 * формулировки полей, подписи метрик — хранится на одном языке в колонке label:
 * писать каждый вопрос дважды это налог без выгоды для инструмента одного человека.
 */
const DICTS: Record<Locale, Dict> = { ru, en };

export function dict(locale: Locale): Dict {
  return DICTS[locale] ?? ru;
}

export const LOCALES: Locale[] = ["ru", "en"];

export function isLocale(v: string): v is Locale {
  return v === "ru" || v === "en";
}

/**
 * Русский требует трёх форм там, где английскому хватает двух: «1 точка», «2 точки»,
 * «5 точек». Без этого интерфейс выдаёт «1 точек» и выглядит недоделанным.
 */
export function plural(locale: Locale, n: number, forms: readonly string[]): string {
  if (locale === "en") return `${n} ${forms[n === 1 ? 0 : 1]}`;
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  const form =
    mod100 >= 11 && mod100 <= 14 ? 2
    : mod10 === 1 ? 0
    : mod10 >= 2 && mod10 <= 4 ? 1
    : 2;
  return `${n} ${forms[form]}`;
}
