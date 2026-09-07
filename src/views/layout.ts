import { html, raw, type Raw } from "./html.ts";
import { dict } from "../i18n/index.ts";
import type { Locale } from "../db/types.ts";

export interface LayoutOptions {
  locale: Locale;
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
        The brand and the language switch are wrapped together because on a narrow screen
        they share the header's first line while the navigation drops to a strip of its
        own below them. Grouping them in the markup is what keeps the tab order equal to
        the reading order there; on a wide screen the wrapper is display:contents, so the
        header is still the same single row of three items it always was.
      -->
      <div class="bar">
        <a class="brand" href="/">${t.appName}</a>
        <form method="post" action="/settings/locale" class="lang">
          <input type="hidden" name="locale" value="${other}" />
          <input type="hidden" name="return_to" value="${o.path ?? "/"}" />
          <button type="submit" title="${other.toUpperCase()}">${other.toUpperCase()}</button>
        </form>
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
<html lang="${o.locale}">
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

/** The mentee-facing summary page: no navigation and no htmx. */
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
