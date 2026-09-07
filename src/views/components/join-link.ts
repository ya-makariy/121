import { html, type Raw } from "../html.ts";
import { dict } from "../../i18n/index.ts";
import type { Locale } from "../../db/types.ts";
import { safeExternalUrl, urlHost } from "../../lib/url.ts";

/**
 * The button that opens the call. One component for every place it appears, so the safety
 * check cannot be forgotten in one of them.
 *
 * The URL is re-validated here even though it was validated on the way in: rows can also
 * arrive from an import or from a hand-edited database, and a href is the wrong place to
 * find that out. `rel="noopener noreferrer"` keeps the opened tab from reaching back into
 * the app.
 */
export function joinLink(
  raw: string | null | undefined,
  locale: Locale,
  options: { short?: boolean; primary?: boolean } = {},
): Raw | string {
  const href = safeExternalUrl(raw);
  if (href === null) return "";

  const t = dict(locale);
  const label = options.short ? t.common.joinShort : t.common.join;
  const host = urlHost(href);

  return html`
    <a class="btn join${options.primary ? " primary" : ""}" href="${href}"
       target="_blank" rel="noopener noreferrer"
       title="${host ?? label}">↗ ${label}</a>
  `;
}
