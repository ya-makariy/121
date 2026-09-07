import type { Context, MiddlewareHandler } from "hono";
import { db } from "../db/index.ts";
import type { AppUserRow } from "../db/types.ts";

/**
 * v1: авторизации нет, приложение слушает только петлю, любой пришедший — хозяин.
 *
 * Смысл этой заглушки в том, что все запросы уже принимают owner_id, и переход к v2
 * (пароль, сессии, облако) меняет ровно этот файл, а не каждый запрос в проекте.
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
    if (!row) throw new Error("В базе нет пользователя id=1 — миграция не применялась?");
    c.set("user", { id: row.id, timezone: row.timezone, displayName: row.display_name });
    await next();
  };
}

export function user(c: Context): CurrentUser {
  return c.get("user") as CurrentUser;
}
