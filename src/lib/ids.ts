import { slugify } from "../i18n/translit.ts";

/**
 * Keys that stay stable when a template version is forked. Their shape does not matter —
 * what matters is that a key is generated once and copied thereafter. A readable Latin
 * prefix helps when debugging exports and charts, and keeps builder URLs clean.
 */
export function mintKey(prefix: string, label?: string): string {
  const slug = slugify(label ?? "", 24);
  const rand = crypto.randomUUID().slice(0, 8);
  return slug === "" ? `${prefix}_${rand}` : `${prefix}_${slug}_${rand}`;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
