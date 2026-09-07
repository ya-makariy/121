import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId } from "./helpers.ts";
import { parseExternalUrl, safeExternalUrl, urlHost } from "../src/lib/url.ts";
import { createPerson, getPerson, updatePerson } from "../src/db/queries/people.ts";
import { cadenceOverview } from "../src/db/queries/cadence.ts";
import { buildSharedSnapshot } from "../src/domain/snapshot.ts";
import { renderMarkdown } from "../src/domain/markdown.ts";
import { publicSharePage } from "../src/views/pages/share.ts";
import { joinLink } from "../src/views/components/join-link.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";

const ROOM = "https://example.com/standing-room";

/**
 * A link typed by a person ends up in an href, so the scheme has to be checked. Escaping
 * the attribute does not help: `javascript:alert(1)` survives escaping and runs on click.
 */
describe("meeting link safety", () => {
  test("http and https pass through, normalized", () => {
    expect(safeExternalUrl("https://meet.example.com/abc")).toBe("https://meet.example.com/abc");
    expect(safeExternalUrl("http://meet.example.com/abc")).toBe("http://meet.example.com/abc");
    // A scheme-less paste is the common case, so https is assumed rather than refused.
    expect(safeExternalUrl("meet.example.com/abc")).toBe("https://meet.example.com/abc");
    expect(safeExternalUrl("  https://example.com/room  ")).toBe("https://example.com/room");
  });

  test("every other scheme is refused, not sanitized", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "not a url at all",
      "",
      "   ",
    ]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  test("a rejected link renders nothing at all", () => {
    // The button must vanish rather than appear and do something surprising.
    expect(joinLink("javascript:alert(1)", "ru")).toBe("");
    expect(joinLink(null, "ru")).toBe("");

    const rendered = joinLink(ROOM, "ru");
    expect(typeof rendered).not.toBe("string");
    const markup = (rendered as { value: string }).value;
    expect(markup).toContain(ROOM);
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
  });

  test("the host is shown in a readable form", () => {
    expect(urlHost("https://www.zoom.us/j/123")).toBe("zoom.us");
    expect(urlHost("meet.google.com/abc")).toBe("meet.google.com");
    expect(urlHost("javascript:alert(1)")).toBeNull();
  });

  test("a query string and a fragment survive intact", () => {
    // Zoom and Teams links carry passcodes there; dropping them would break the link.
    const zoom = "https://example.zoom.us/j/123?pwd=secret#success";
    expect(safeExternalUrl(zoom)).toBe(zoom);
    expect(parseExternalUrl(zoom)!.searchParams.get("pwd")).toBe("secret");
  });
});

describe("meeting link storage", () => {
  test("it round-trips through create and update, and clears to null", () => {
    const db = testDb();
    const person = createPerson(db, {
      full_name: "Someone", email: null, role_title: null, cadence_days: 14,
      cadence_anchor_on: null, default_template_id: null, meeting_url: ROOM, notes: null,
    });
    expect(person.meeting_url).toBe(ROOM);

    const updated = updatePerson(db, person.id, {
      full_name: "Someone", email: null, role_title: null, cadence_days: 14,
      cadence_anchor_on: null, default_template_id: null, meeting_url: null, notes: null,
    })!;
    expect(updated.meeting_url).toBeNull();
    expect(getPerson(db, person.id)!.meeting_url).toBeNull();
  });

  test("the cadence dashboard carries the link so it can offer the button", () => {
    const db = testDb();
    const person = createPerson(db, {
      full_name: "Someone", email: null, role_title: null, cadence_days: 14,
      cadence_anchor_on: null, default_template_id: null, meeting_url: ROOM, notes: null,
    });
    const row = cadenceOverview(db, "2026-09-07").find((r) => r.id === person.id)!;
    expect(row.meeting_url).toBe(ROOM);
  });

  test("the link never reaches the mentee's summary", () => {
    // It is an internal convenience; the mentee already has the invite. Keeping it out
    // also means one less thing to think about when the snapshot rules change.
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    db.query("UPDATE person SET meeting_url = ? WHERE id = ?").run(ROOM, personId);

    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");
    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'summary'",
      )
      .get(versionId)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { value: "we talked" });
    completeMeeting(db, meetingId);

    const payload = buildSharedSnapshot(db, meetingId, "ru");
    expect(JSON.stringify(payload)).not.toContain("standing-room");
    expect(renderMarkdown(payload)).not.toContain("standing-room");
    expect(publicSharePage(payload)).not.toContain("standing-room");
  });
});
