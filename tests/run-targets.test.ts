import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The run targets, checked because the separation between them is a data-safety
 * property rather than a convenience.
 *
 * `bun run dev` and `bun run demo` pin DB_PATH to a database of their own, so the
 * invented people in scripts/demo-data.ts cannot land among real 1:1 records. That only
 * holds while the pin is actually there, and a stray edit to package.json would remove it
 * silently — nothing would fail, the demo would simply start writing into the real file.
 * An inline assignment beats a .env file (verified: Bun does not overwrite variables that
 * are already in the environment), which is what makes the pin trustworthy.
 */
const ROOT = join(import.meta.dir, "..");

const scripts: Record<string, string> =
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;

/** The DB_PATH a target pins itself to, or null when it inherits the environment's. */
function pinnedDb(script: string): string | null {
  const m = /(?:^|\s)DB_PATH=(\S+)/.exec(script);
  return m === null ? null : m[1]!;
}

function envExampleDb(): string {
  const line = readFileSync(join(ROOT, ".env.example"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("DB_PATH="));
  expect(line).toBeDefined();
  return line!.slice("DB_PATH=".length).trim();
}

describe("run targets", () => {
  test("the targets a manager needs all exist", () => {
    for (const name of ["dev", "demo", "start", "migrate", "backup", "export", "test"]) {
      expect(scripts[name]).toBeString();
    }
  });

  test("dev and demo pin a database of their own", () => {
    const dev = pinnedDb(scripts["dev"]!);
    const demo = pinnedDb(scripts["demo"]!);
    expect(dev).not.toBeNull();
    expect(demo).not.toBeNull();
    // The same one, or `bun run demo` would fill a database `bun run dev` never serves.
    expect(demo).toBe(dev);
  });

  test("that database is not the real one", () => {
    // .env.example documents the real path; the dev pin must differ from it, whatever
    // either of them is later renamed to.
    expect(pinnedDb(scripts["dev"]!)).not.toBe(envExampleDb());
  });

  test("start pins nothing, so a self-hoster can put the real database anywhere", () => {
    expect(pinnedDb(scripts["start"]!)).toBeNull();
    expect(scripts["start"]).not.toContain("--watch");
  });

  test("dev watches and start does not", () => {
    expect(scripts["dev"]).toContain("--watch");
  });

  test("the maintenance targets follow the real database", () => {
    // Backup and export are what a manager runs to keep or move their own records, so
    // they must never be pinned to the throwaway database.
    for (const name of ["migrate", "backup", "export"]) {
      expect(pinnedDb(scripts[name]!)).toBeNull();
    }
  });
});
