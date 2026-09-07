/**
 * ЕДИНСТВЕННОЕ место, где реализовано экранирование HTML. См. CLAUDE.md §5.
 *
 * `html` экранирует всё интерполированное. Чтобы вставить готовую разметку, её нужно
 * явно обернуть в raw() — то есть утечка XSS требует осознанного действия, а не забывчивости.
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

/** Значение для атрибута — экранируется так же, отдельная функция только для читаемости. */
export function attr(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : escapeHtml(String(value));
}

/** Безопасная вставка данных в <script type="application/json">. */
export function jsonScript(data: unknown): Raw {
  return raw(JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e"));
}

export function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
