import type { Context, MiddlewareHandler } from "hono";
import { db } from "../db/index.ts";
import type { AppUserRow } from "../db/types.ts";

/**
 * v1: there is no auth. The app listens on loopback only, so whoever arrives is the owner.
 *
 * The point of this stub is that every query already takes an owner_id, so moving to v2
 * (password, sessions, cloud) changes exactly this file and not every query in the project.
 */
export const OWNER_ID = 1;

export interface CurrentUser {
  id: number;
  timezone: string;
  displayName: string;
}

export function currentUser(): MiddlewareHandler {
  return async (c, next) => {
    const row = db()
      .query<AppUserRow, [number]>("SELECT * FROM app_user WHERE id = ?")
      .get(OWNER_ID);
    if (!row) throw new Error("No app_user id=1 in the database — were migrations applied?");
    c.set("user", { id: row.id, timezone: row.timezone, displayName: row.display_name });
    await next();
  };
}

export function user(c: Context): CurrentUser {
  return c.get("user") as CurrentUser;
}
