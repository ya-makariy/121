import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Locale } from "../db/types.ts";
import { isLocale } from "../i18n/index.ts";
import { config } from "../config.ts";

/** Приоритет: cookie > ?lang= > Accept-Language > дефолт из конфига. */
export function locale(): MiddlewareHandler {
  return async (c, next) => {
    const fromQuery = c.req.query("lang");
    const fromCookie = getCookie(c, "lang");
    const fromHeader = c.req.header("accept-language")?.slice(0, 2).toLowerCase();

    const picked =
      (fromCookie && isLocale(fromCookie) && fromCookie) ||
      (fromQuery && isLocale(fromQuery) && fromQuery) ||
      (fromHeader && isLocale(fromHeader) && fromHeader) ||
      config.defaultLocale;

    c.set("locale", picked as Locale);
    await next();
  };
}

export function loc(c: Context): Locale {
  return (c.get("locale") as Locale) ?? config.defaultLocale;
}
