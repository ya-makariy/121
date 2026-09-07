import { Hono } from "hono";
import { thm } from "../middleware/theme.ts";
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
 * The manager-side sharing routes: build a snapshot, revoke it, view it.
 * The public /s/:token router is deliberately separate — see publicShareRoutes below.
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
      locale: loc(c), theme: thm(c),
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

  // A snapshot is immutable: rebuilding revokes the old link and issues a new one rather
  // than swapping the contents of something already sent.
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
 * The PUBLIC router. Mounted outside the auth middleware from the very start: in v2
 * /s/:token must stay unauthenticated, and had it sat inside the main tree in v1, that
 * would have been forgotten the moment auth was added. See CLAUDE.md rule 2.
 *
 * Rendered FROM THE SNAPSHOT, not from live data: there is simply nowhere here to get
 * private content from.
 */
export const publicShareRoutes = new Hono();

publicShareRoutes.get("/s/:token", (c) => {
  // One route for HTML and Markdown: the token is base64url and never contains a dot, so
  // the .md suffix is unambiguous without guessing how the framework parses paths.
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
