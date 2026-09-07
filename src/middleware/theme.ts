import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { DEFAULT_THEME, isTheme, type Theme } from "../lib/theme.ts";

/**
 * Precedence: the cookie, then `auto`.
 *
 * Deliberately no `?theme=` counterpart to the locale's `?lang=`: a locale is worth
 * putting in a link you send someone, a surface is not.
 */
export function theme(): MiddlewareHandler {
  return async (c, next) => {
    const fromCookie = getCookie(c, "theme");
    c.set("theme", fromCookie !== undefined && isTheme(fromCookie) ? fromCookie : DEFAULT_THEME);
    await next();
  };
}

export function thm(c: Context): Theme {
  return (c.get("theme") as Theme) ?? DEFAULT_THEME;
}
