/**
 * The surface the interface is drawn on.
 *
 * `auto` is not a third palette. It means nothing is asserted onto the document and
 * `prefers-color-scheme` decides — the behaviour the app had before there was a switch.
 * Only `light` and `dark` become a `data-theme` attribute, so "follow the system" stays
 * the default rather than becoming a setting the tool has to keep in step with the OS.
 *
 * The choice is stored in a cookie, not in `app_user`: the operating system's appearance
 * setting is per device, so an override of it belongs on the same device. It is also
 * nothing a query will ever filter, join or aggregate, which is the test rule 3 applies
 * when deciding what earns a column.
 */
export const THEMES = ["auto", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "auto";

export function isTheme(v: string): v is Theme {
  return (THEMES as readonly string[]).includes(v);
}

/**
 * The switch is a single button, so it cycles rather than toggles: system -> light ->
 * dark -> system. Three states need three stops, and a button that showed only two would
 * make "follow the system" unreachable once it had been left.
 */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.indexOf(current);
  return THEMES[(i + 1) % THEMES.length]!;
}
