import { Hono } from "hono";
import { db } from "../db/index.ts";
import { getMeeting } from "../db/queries/meetings.ts";
import { getPerson } from "../db/queries/people.ts";
import {
  countShareView, findActiveShare, insertShareLink, listShareLinks, revokeShare,
} from "../db/queries/shares.ts";
import { buildSharedSnapshot, hashPayload, type SharePayload } from "../domain/snapshot.ts";
import { renderMarkdown } from "../domain/markdown.ts";
import { publicSharePage, shareNotFoundPage, sharePage } from "../views/pages/share.ts";
import { loc } from "../middleware/locale.ts";
import { OWNER_ID } from "../middleware/current-user.ts";
import { randomToken } from "../lib/ids.ts";
import { config } from "../config.ts";

/**
 * Внутренние роуты шаринга: сборка снапшота, отзыв, просмотр.
 * Публичный роутер /s/:token намеренно отдельный — см. publicShareRoutes ниже.
 */
export const shareRoutes = new Hono();

shareRoutes.get("/meetings/:id/share", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();
  const person = getPerson(db(), meeting.person_id, OWNER_ID);
  if (!person) return c.notFound();

  const shares = listShareLinks(db(), id);
  const active = shares.find((s) => s.revoked_at === null);
  const payload: SharePayload | null = active
    ? (JSON.parse(active.snapshot_json) as SharePayload)
    : null;

  return c.html(
    sharePage({
      locale: loc(c),
      meeting,
      person,
      shares,
      preview: payload,
      markdown: payload ? renderMarkdown(payload) : null,
    }),
  );
});

shareRoutes.post("/meetings/:id/share", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const meeting = getMeeting(db(), id, OWNER_ID);
  if (!meeting) return c.notFound();

  // Снапшот неизменяем: пересборка отзывает прошлую ссылку и выдаёт новую,
  // а не подменяет содержимое уже отправленной.
  for (const s of listShareLinks(db(), id)) {
    if (s.revoked_at === null) revokeShare(db(), s.id, OWNER_ID);
  }

  const payload = buildSharedSnapshot(db(), id, loc(c), OWNER_ID);
  insertShareLink(
    db(),
    {
      meeting_id: id,
      token: randomToken(),
      snapshot_json: JSON.stringify(payload),
      snapshot_hash: hashPayload(payload),
      locale: payload.locale,
    },
    OWNER_ID,
  );

  return c.redirect(`/meetings/${id}/share`, 303);
});

shareRoutes.post("/shares/:id/revoke", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  revokeShare(db(), id, OWNER_ID);
  const back = typeof form["meeting_id"] === "string" ? `/meetings/${form["meeting_id"]}/share` : "/";
  return c.redirect(back, 303);
});

/**
 * ПУБЛИЧНЫЙ роутер. Монтируется вне auth-мидлвари с самого начала: в v2 /s/:token должен
 * остаться неаутентифицированным, и если бы в v1 он лежал внутри общего дерева, про это
 * забыли бы при добавлении авторизации. См. CLAUDE.md §1.
 *
 * Рендерится ИЗ СНАПШОТА, не из живых данных: приватное здесь взять просто негде.
 */
export const publicShareRoutes = new Hono();

publicShareRoutes.get("/s/:token", (c) => {
  // Один роут на HTML и на Markdown: токен — base64url, точек в нём не бывает,
  // поэтому суффикс .md различается однозначно и без догадок о парсинге путей.
  const raw = c.req.param("token");
  const wantsMarkdown = raw.endsWith(".md");
  const token = wantsMarkdown ? raw.slice(0, -3) : raw;

  const share = findActiveShare(db(), token);
  if (!share) {
    return wantsMarkdown
      ? c.text("404", 404)
      : c.html(shareNotFoundPage(config.defaultLocale), 404);
  }

  const payload = JSON.parse(share.snapshot_json) as SharePayload;

  if (!wantsMarkdown) {
    countShareView(db(), share.id);
    return c.html(publicSharePage(payload));
  }

  const filename = `1-1-${payload.personName.replace(/[^\p{L}\p{N}]+/gu, "-")}-${payload.heldOn}.md`;
  c.header("Content-Type", "text/markdown; charset=utf-8");
  if (c.req.query("download") !== undefined) {
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  return c.body(renderMarkdown(payload));
});
