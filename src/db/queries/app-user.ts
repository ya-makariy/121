import type { Database } from "bun:sqlite";
import type { AppUserRow, Locale } from "../types.ts";

/**
 * The manager's own record: read on every request, written from /settings.
 *
 * The timezone lives in a column rather than in app_setting because it is not an opaque
 * preference — it is the input to todayInTz(), and every cadence query is handed the
 * ?today derived from it (CLAUDE.md rules 3 and 4).
 */
export function getAppUser(db: Database, ownerId = 1): AppUserRow | null {
  return (
    db.query<AppUserRow, [number]>("SELECT * FROM app_user WHERE id = ?").get(ownerId) ?? null
  );
}

/** The value must already have passed assertTimezone(): nothing here validates it. */
export function setTimezone(db: Database, timezone: string, ownerId = 1): void {
  db.query("UPDATE app_user SET timezone = ? WHERE id = ?").run(timezone, ownerId);
}

export function setLocale(db: Database, locale: Locale, ownerId = 1): void {
  db.query("UPDATE app_user SET locale = ? WHERE id = ?").run(locale, ownerId);
}
