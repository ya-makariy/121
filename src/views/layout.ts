import { html, raw, type Raw } from "./html.ts";
import { dict } from "../i18n/index.ts";
import type { Locale } from "../db/types.ts";
import { nextTheme, type Theme } from "../lib/theme.ts";

/**
 * The switch shows the surface currently in force, not the one a click would bring —
 * a control that displayed its own destination would read as if the theme were already
 * that. The glyphs are iconography, not copy, so they stay here while the accessible
 * name comes from the dictionary (rule 1).
 */
const THEME_GLYPH: Record<Theme, string> = { auto: "\u25d0", light: "\u2600", dark: "\u263e" };

export interface LayoutOptions {
  locale: Locale;
  /** Required rather than defaulted: a page that forgot it would quietly ignore the
      manager's choice and fall back to the system surface, and only that one page. */
  theme: Theme;
  title: string;
  /** The active navigation item. */
  nav?: "dashboard" | "people" | "compare" | "teams" | "templates" | "metrics" | "actions" | "settings";
  /** Path used by the language switch so it returns to the current page. */
  path?: string;
  body: Raw;
}

export function layout(o: LayoutOptions): string {
  const t = dict(o.locale);
  const other: Locale = o.locale === "ru" ? "en" : "ru";
  const themeNext = nextTheme(o.theme);
  const themeTitle = `${t.theme.label}: ${t.theme[o.theme]}`;
  // Built from a closed union, never from request data.
  const themeAttr = o.theme === "auto" ? "" : ` data-theme="${o.theme}"`;
  const items = [
    ["dashboard", "/", t.nav.dashboard],
    ["people", "/people", t.nav.people],
    ["teams", "/teams", t.nav.teams],
    ["compare", "/compare", t.nav.compare],
    ["actions", "/actions", t.nav.actions],
    ["templates", "/templates", t.nav.templates],
    ["metrics", "/metrics", t.nav.metrics],
    ["settings", "/settings", t.nav.settings],
  ] as const;

  const page = html`
    <header class="top">
      <!--
        The brand and the two chrome switches are wrapped together because on a narrow
        screen they share the header's first line while the navigation drops to a strip of
        its own below them. Grouping them in the markup is what keeps the tab order equal to
        the reading order there; on a wide screen the wrapper is display:contents, so the
        header is still the same single row of three items it always was.
      -->
      <div class="bar">
        <a class="brand" href="/">${t.appName}</a>
        <div class="switches">
          <form method="post" action="/settings/theme" class="theme">
            <input type="hidden" name="theme" value="${themeNext}" />
            <input type="hidden" name="return_to" value="${o.path ?? "/"}" />
            <button type="submit" title="${themeTitle}" aria-label="${themeTitle}"
            >${THEME_GLYPH[o.theme]}</button>
          </form>
          <form method="post" action="/settings/locale" class="lang">
            <input type="hidden" name="locale" value="${other}" />
            <input type="hidden" name="return_to" value="${o.path ?? "/"}" />
            <button type="submit" title="${other.toUpperCase()}">${other.toUpperCase()}</button>
          </form>
        </div>
      </div>
      <nav>
        ${items.map(
          ([key, href, label]) => html`
            <a href="${href}" class="${o.nav === key ? "active" : ""}">${label}</a>
          `,
        )}
      </nav>
    </header>
    <main>${o.body}</main>
  `;

  return `<!doctype html>
<html lang="${o.locale}"${themeAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${o.title} · ${t.appName}</title>
<link rel="stylesheet" href="/app.css" />
<script src="/vendor/htmx.min.js" defer></script>
</head>
<body>
${page.value}
</body>
</html>`;
}

/**
 * The mentee-facing summary page: no navigation, no htmx and deliberately no `data-theme`.
 * The surface here follows the reader's own `prefers-color-scheme`; the manager's choice
 * of theme is a preference on the manager's device, not a property of what was shared.
 */
export function publicLayout(o: { locale: Locale; title: string; body: Raw }): string {
  return `<!doctype html>
<html lang="${o.locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${o.title}</title>
<link rel="stylesheet" href="/app.css" />
</head>
<body class="public">
<main>${o.body.value}</main>
</body>
</html>`;
}

export { raw };
