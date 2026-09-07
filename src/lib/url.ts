/**
 * Validation for a link a person typed in, before it is ever put into an href.
 *
 * Escaping the attribute is not enough: `javascript:alert(1)` survives escaping intact and
 * runs when clicked. So only http and https are allowed through, and everything else is
 * rejected rather than sanitized — a link we cannot vouch for is not a link we render.
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

export function parseExternalUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // People paste "meet.google.com/abc-def" without a scheme; assume https rather than
  // refusing, but never assume anything for a value that already carries a scheme.
  const candidates = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? [trimmed]
    : [`https://${trimmed}`];

  for (const candidate of candidates) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) return null;
    if (url.hostname === "") return null;
    return url;
  }
  return null;
}

/** The normalized link, or null if it is not something safe to render. */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return parseExternalUrl(raw)?.href ?? null;
}

/** A short, readable form for a button label: "meet.google.com". */
export function urlHost(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const url = parseExternalUrl(raw);
  return url === null ? null : url.hostname.replace(/^www\./, "");
}
