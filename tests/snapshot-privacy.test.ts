import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId, addField } from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions, loadVersionStructure } from "../src/db/queries/templates.ts";
import { buildSharedSnapshot, hashPayload } from "../src/domain/snapshot.ts";
import { renderMarkdown } from "../src/domain/markdown.ts";
import { publicSharePage } from "../src/views/pages/share.ts";
import { createAction } from "../src/db/queries/actions.ts";
import { personTimeline } from "../src/db/queries/metrics.ts";
import { getMetricByKey } from "../src/db/queries/metrics.ts";
import { nowIso } from "../src/lib/dates.ts";

/**
 * THIS TEST IS NEVER DELETED OR WEAKENED. See CLAUDE.md rule 2.
 *
 * A privacy leak is the one failure that damages a relationship rather than data. The test
 * fills every field type with a private sentinel and hunts for it across every surface a
 * snapshot could seep through.
 */
const SENTINEL = "SENTINEL_PRIVATE_MUST_STAY_INSIDE";

describe("snapshot privacy", () => {
  test("the sentinel reaches none of the sharing surfaces", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);

    // One private field of every type that can hold a sentinel or a distinguishable value.
    const privateFields = [
      addField(db, versionId, { fieldKey: "p_text", label: `${SENTINEL} label`, type: "text", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_short", label: "private line", type: "short_text", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_scale", label: "private scale", type: "scale", visibility: "private", scaleMin: 1, scaleMax: 5 }),
      addField(db, versionId, { fieldKey: "p_check", label: "private checkbox", type: "checkbox", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_date", label: "private date", type: "date", visibility: "private" }),
    ];
    const sharedField = addField(db, versionId, {
      fieldKey: "s_text", label: "visible to the mentee", type: "text", visibility: "shared",
    });

    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    for (const id of privateFields) {
      const field = getFieldWithOptions(db, id)!;
      const raw =
        field.type === "scale" ? { value: "3" }
        : field.type === "checkbox" ? { value: "on" }
        : field.type === "date" ? { value: "2026-09-09" }
        : { value: `${SENTINEL} content` };
      saveAnswer(db, meetingId, field, raw);
    }
    saveAnswer(db, meetingId, getFieldWithOptions(db, sharedField)!, {
      value: "this one may be shown",
    });

    // The private field from the seed: a single_select bound to a metric.
    const seedPrivate = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'attrition_risk'",
      )
      .get(versionId)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, seedPrivate.id)!, { optionKeys: ["high"] });

    // Private notes about the meeting, and a private agreement.
    db.query("UPDATE meeting SET private_notes = ? WHERE id = ?")
      .run(`${SENTINEL} note about the meeting`, meetingId);
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId,
      title: `${SENTINEL} private agreement`, details: null,
      assignee: "manager", visibility: "private", due_on: null,
    });
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId,
      title: "an open agreement", details: null,
      assignee: "person", visibility: "shared", due_on: "2026-09-20",
    });

    completeMeeting(db, meetingId);

    const payload = buildSharedSnapshot(db, meetingId, "ru");

    // 1. The snapshot JSON: what goes into the database and is later rendered.
    const json = JSON.stringify(payload);
    expect(json).not.toContain(SENTINEL);

    // 2. Markdown: the main way to share in v1.
    const md = renderMarkdown(payload);
    expect(md).not.toContain(SENTINEL);

    // 3. The public HTML page.
    const publicHtml = publicSharePage(payload);
    expect(publicHtml).not.toContain(SENTINEL);

    // 4. The hash is taken from the same payload and must not depend on private content.
    expect(hashPayload(payload)).toHaveLength(64);

    // Positive check: the shared content is there, otherwise the test passes vacuously.
    expect(md).toContain("this one may be shown");
    expect(md).toContain("an open agreement");
    expect(publicHtml).toContain("this one may be shown");
  });

  test("a private agreement stays out of the snapshot while an open one gets in", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    createAction(db, {
      person_id: personId, created_meeting_id: meetingId, title: "a private item",
      details: null, assignee: "manager", visibility: "private", due_on: null,
    });
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId, title: "a shared item",
      details: null, assignee: "person", visibility: "shared", due_on: null,
    });
    completeMeeting(db, meetingId);

    const titles = buildSharedSnapshot(db, meetingId, "ru").actions.map((a) => a.title);
    expect(titles).toContain("a shared item");
    expect(titles).not.toContain("a private item");
  });

  test("a private metric feeds the charts but never reaches the mentee", () => {
    // Attrition risk is a private field bound to a metric: the manager needs its trend,
    // and the mentee never sees it.
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'attrition_risk'",
      )
      .get(versionId)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { optionKeys: ["medium"] });
    completeMeeting(db, meetingId);

    const metric = getMetricByKey(db, "attrition_risk")!;
    const points = personTimeline(db, personId, metric.id);
    expect(points).toHaveLength(1);
    expect(points[0]!.norm_value).toBe(0.5);

    const payload = buildSharedSnapshot(db, meetingId, "ru");
    const labels = payload.sections.flatMap((s) => s.items.map((i) => i.fieldKey));
    expect(labels).not.toContain("attrition_risk");
  });

  test("the v_shared_answer view does not return private fields", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    const priv = addField(db, versionId, {
      fieldKey: "leak_check", label: "private", type: "text", visibility: "private",
    });
    saveAnswer(db, meetingId, getFieldWithOptions(db, priv)!, { value: SENTINEL });

    const rows = db
      .query<{ text_value: string | null }, [number]>(
        "SELECT text_value FROM v_shared_answer WHERE meeting_id = ?",
      )
      .all(meetingId);
    expect(rows.every((r) => r.text_value !== SENTINEL)).toBe(true);
  });

  test("the database default for visibility is private (fail closed)", () => {
    // A bug that forgets to pass visibility must hide, not reveal.
    const db = testDb();
    const versionId = defaultVersionId(db);
    const section = db
      .query<{ id: number }, [number]>("SELECT id FROM template_section WHERE version_id = ? LIMIT 1")
      .get(versionId)!;

    const row = db
      .query<{ visibility: string }, any[]>(
        `INSERT INTO template_field (version_id, section_id, field_key, label, type, position)
         VALUES (?, ?, 'no_visibility_given', 'no visibility given', 'text', 90)
         RETURNING visibility`,
      )
      .get(versionId, section.id)!;
    expect(row.visibility).toBe("private");
  });

  test("the section structure loads in display order", () => {
    const db = testDb();
    const sections = loadVersionStructure(db, defaultVersionId(db));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.map((s) => s.position)).toEqual([...sections.map((s) => s.position)].sort((a, b) => a - b));
    expect(nowIso()).toContain("T");
  });
});
