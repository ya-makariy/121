/**
 * The ONLY place HTML escaping is implemented. See CLAUDE.md rule 6.
 *
 * `html` escapes everything interpolated. Inserting ready-made markup requires wrapping it
 * in raw() explicitly, so an XSS hole takes a deliberate act rather than forgetfulness.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const RAW = Symbol("raw-html");

export interface Raw {
  [RAW]: true;
  value: string;
}

export function raw(value: string): Raw {
  return { [RAW]: true, value };
}

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && RAW in v;
}

export type Renderable =
  | string | number | boolean | null | undefined | Raw | Renderable[];

function render(value: Renderable): string {
  if (value === null || value === undefined || value === false) return "";
  if (value === true) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (isRaw(value)) return value.value;
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Renderable[]): Raw {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? "");
  }
  return raw(out);
}

/** An attribute value — escaped the same way; a separate function purely for clarity. */
export function attr(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : escapeHtml(String(value));
}

/** Safe embedding of data into <script type="application/json">. */
export function jsonScript(data: unknown): Raw {
  return raw(JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e"));
}

export function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
