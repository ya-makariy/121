import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { useDb } from "../src/db/index.ts";
import { mountRoutes } from "../src/routes/index.ts";
import { onError, onNotFound } from "../src/middleware/errors.ts";
import { DEFAULT_THEME, isTheme, nextTheme, THEMES, type Theme } from "../src/lib/theme.ts";
import { testDb } from "./helpers.ts";

/**
 * The appearance switch, and the stylesheet invariant that makes it safe.
 *
 * Two selectors can mean "dark" — the system preference and an explicit choice — and they
 * apply one set of values through `--dark-*` aliases rather than repeating the palette.
 * That is only safe while the two lists stay identical, so the drift is checked here
 * rather than left to whoever edits the file next.
 */
const CSS = readFileSync(join(import.meta.dir, "..", "public", "app.css"), "utf8");

/** The declarations of one rule, given a selector that appears exactly once. */
function blockOf(selector: string): string {
  const at = CSS.indexOf(selector);
  expect(at).toBeGreaterThan(-1);
  expect(CSS.indexOf(selector, at + 1)).toBe(-1);
  const open = CSS.indexOf("{", at);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

function declaredIn(block: string): string[] {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!).sort();
}

describe("theme: the cycle", () => {
  test("the switch reaches every surface and returns to where it started", () => {
    let seen: Theme[] = [DEFAULT_THEME];
    for (let i = 0; i < THEMES.length - 1; i++) seen.push(nextTheme(seen[seen.length - 1]!));
    expect(new Set(seen).size).toBe(THEMES.length);
    expect(nextTheme(seen[seen.length - 1]!)).toBe(DEFAULT_THEME);
  });

  test("auto is the default, so following the system is nobody's opt-in", () => {
    expect(DEFAULT_THEME).toBe("auto");
  });

  test("only the three surfaces are accepted", () => {
    for (const t of THEMES) expect(isTheme(t)).toBe(true);
    for (const junk of ["", "Dark", "sepia", "light ", "auto;"]) expect(isTheme(junk)).toBe(false);
  });
});

describe("theme: the stylesheet", () => {
  test("the two blocks that apply the dark surface declare exactly the same tokens", () => {
    const viaSystem = declaredIn(blockOf(':root:not([data-theme="light"])'));
    const viaChoice = declaredIn(blockOf(':root[data-theme="dark"]'));
    expect(viaSystem.length).toBeGreaterThan(0);
    expect(viaChoice).toEqual(viaSystem);
  });

  test("every dark value is applied, and applied only through those two blocks", () => {
    const defined = declaredIn(blockOf(":root {")).filter((t) => t.startsWith("--dark-"));
    expect(defined.length).toBe(27);

    const applied = declaredIn(blockOf(':root[data-theme="dark"]'));
    for (const token of defined) {
      // Each --dark-x is aliased by the semantic name it stands for, and by nothing else.
      const semantic = "--" + token.slice("--dark-".length);
      expect(applied).toContain(semantic);
      expect(CSS).toContain(`${semantic}: var(${token})`);
    }

    // Nothing outside the two apply blocks reads a --dark-* token: the rest of the
    // stylesheet only ever names the semantic token, which is what makes it theme-blind.
    const strippedOfApplyBlocks = CSS.replace(/:root(?::not\(\[data-theme="light"\]\)|\[data-theme="dark"\])\s*\{[^}]*\}/g, "");
    expect(strippedOfApplyBlocks).not.toMatch(/var\(--dark-/);
  });

  test("no colour is defined only on one surface", () => {
    const bare = declaredIn(blockOf(":root {"));
    for (const token of declaredIn(blockOf(':root[data-theme="dark"]'))) {
      // The semantic name must already have a light value, or the light surface is short
      // a colour and nothing else in the file would say so (CLAUDE.md rule 8).
      expect(bare).toContain(token);
    }
  });

  test("the system preference steps aside for an explicit light choice", () => {
    // Without the :not(), a manager who picked light on a dark machine would still get
    // dark, and the switch would look broken in exactly one direction.
    expect(CSS).toContain(':root:not([data-theme="light"])');
  });

  test("eight series slots per surface and never a ninth", () => {
    expect(declaredIn(blockOf(":root {")).filter((t) => /^--series-\d+$/.test(t)).length).toBe(8);
    expect(declaredIn(blockOf(":root {")).filter((t) => /^--dark-series-\d+$/.test(t)).length).toBe(8);
    expect(CSS).not.toMatch(/--(dark-)?series-9\b/);
  });
});

describe("theme: through the request", () => {
  let db: Database;
  let app: Hono;

  beforeAll(() => {
    db = testDb();
    useDb(db);
    app = new Hono();
    app.onError(onError);
    app.notFound(onNotFound);
    mountRoutes(app);
  });

  afterAll(() => {
    useDb(undefined);
    db.close();
  });

  async function dashboard(cookie?: string): Promise<string> {
    return await (
      await app.request("/", cookie === undefined ? {} : { headers: { cookie } })
    ).text();
  }

  test("auto asserts nothing, so prefers-color-scheme stays in charge", async () => {
    const body = await dashboard();
    expect(body).toContain("<html lang=");
    expect(body).not.toContain("data-theme");
  });

  test("an explicit choice reaches the html element", async () => {
    expect(await dashboard("theme=dark")).toContain('data-theme="dark"');
    expect(await dashboard("theme=light")).toContain('data-theme="light"');
  });

  test("an unrecognised cookie falls back to auto rather than to a broken attribute", async () => {
    const body = await dashboard("theme=sepia");
    expect(body).not.toContain("data-theme");
  });

  test("the form stores the surface and returns to the page it was used on", async () => {
    const res = await app.request("/settings/theme", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ theme: "dark", return_to: "/people" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/people");
    expect(res.headers.get("set-cookie")).toContain("theme=dark");
  });

  test("a junk value is ignored and sets no cookie", async () => {
    const res = await app.request("/settings/theme", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ theme: "sepia" }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("theme=");
  });

  test("the switch offers the next surface, not the current one", async () => {
    // The button shows the surface in force and posts the one after it, so a manager on
    // `auto` is one click from `light` and three from `auto` again.
    const body = await dashboard("theme=light");
    expect(body).toContain('action="/settings/theme"');
    expect(body).toContain(`name="theme" value="${nextTheme("light")}"`);
  });

  test("the mentee's page carries no surface of the manager's", async () => {
    // publicLayout renders no data-theme on purpose: the reader's own system preference
    // decides, because the manager's choice is a preference on the manager's device.
    const body = await (await app.request("/s/nonexistent-token")).text();
    expect(body).not.toContain("data-theme");
  });
});
