import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { useDb } from "../src/db/index.ts";
import { mountRoutes } from "../src/routes/index.ts";
import { onError, onNotFound } from "../src/middleware/errors.ts";
import {
  actionsCreatedIn, createAction, deleteMeetingAction, openActions, recordActionReview,
} from "../src/db/queries/actions.ts";
import { completeMeeting, makeMeeting, makePerson, testDb } from "./helpers.ts";

/**
 * The agreements you make while the meeting is open.
 *
 * Two things were wrong. They were invisible — the form posted, the browser followed a 303
 * to the top of the page and the list of what had just been agreed existed nowhere. And
 * they counted as outstanding from the instant they were typed, while the meeting they
 * belonged to was still being held.
 *
 * So: a running list on the page, droppable while the meeting is a draft, and entered into
 * the open list when the meeting is completed.
 */

const TODAY = "2026-09-08";

function raise(db: Database, personId: number, meetingId: number | null, title: string) {
  return createAction(db, {
    person_id: personId, created_meeting_id: meetingId, title, details: null,
    assignee: "person", visibility: "shared", due_on: null,
  });
}

describe("an agreement is entered when the meeting is completed", () => {
  test("a draft meeting's agreements are not outstanding yet", () => {
    const db = testDb();
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, null, TODAY);
    raise(db, personId, meetingId, "Write the migration note");

    // On the page you are on: present, and in the order it was agreed.
    expect(actionsCreatedIn(db, meetingId).map((a) => a.title)).toEqual([
      "Write the migration note",
    ]);
    // Everywhere else: not yet. The dashboard, /actions and the next meeting's carry-over
    // all read this one query.
    expect(openActions(db, TODAY, personId)).toEqual([]);
    expect(openActions(db, TODAY)).toEqual([]);
  });

  test("completing the meeting enters it", () => {
    const db = testDb();
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, null, TODAY);
    raise(db, personId, meetingId, "Write the migration note");

    completeMeeting(db, meetingId);

    expect(openActions(db, TODAY, personId).map((a) => a.title)).toEqual([
      "Write the migration note",
    ]);
  });

  test("an agreement belonging to no meeting is outstanding immediately", () => {
    // Added from the agreements page rather than inside a 1:1: there is no meeting whose
    // completion could enter it, so the gate must not swallow it.
    const db = testDb();
    const personId = makePerson(db);
    raise(db, personId, null, "Ask about the on-call rota");

    expect(openActions(db, TODAY, personId).map((a) => a.title)).toEqual([
      "Ask about the on-call rota",
    ]);
  });
});

describe("dropping an agreement", () => {
  test("one raised here and never carried anywhere can be dropped", () => {
    const db = testDb();
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, null, TODAY);
    const action = raise(db, personId, meetingId, "Mis-typed line");

    expect(deleteMeetingAction(db, action.id, meetingId)).toBe(true);
    expect(actionsCreatedIn(db, meetingId)).toEqual([]);
  });

  test("another meeting's agreement is never touched", () => {
    // The id is in the URL, so the guard has to be the row's own created_meeting_id.
    const db = testDb();
    const personId = makePerson(db);
    const mine = makeMeeting(db, personId, null, TODAY);
    const theirs = makeMeeting(db, personId, null, "2026-08-08");
    const action = raise(db, personId, theirs, "Agreed last time");

    expect(deleteMeetingAction(db, action.id, mine)).toBe(false);
    expect(actionsCreatedIn(db, theirs)).toHaveLength(1);
  });

  test("one that has been reviewed has a history, and history is not deleted", () => {
    // CLAUDE.md rule 5. Once a later meeting has looked at it, the row is evidence.
    const db = testDb();
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, null, TODAY);
    const later = makeMeeting(db, personId, null, "2026-09-22");
    const action = raise(db, personId, meetingId, "Carried forward");
    recordActionReview(db, later, [{ id: action.id, status: "open" }]);

    expect(deleteMeetingAction(db, action.id, meetingId)).toBe(false);
    expect(actionsCreatedIn(db, meetingId)).toHaveLength(1);
  });

  test("a closed agreement is not deleted either", () => {
    const db = testDb();
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, null, TODAY);
    const action = raise(db, personId, meetingId, "Done already");
    db.query("UPDATE action_item SET status = 'done', closed_at = ? WHERE id = ?")
      .run("2026-09-09T10:00:00.000Z", action.id);

    expect(deleteMeetingAction(db, action.id, meetingId)).toBe(false);
  });
});

describe("through the request", () => {
  let db: Database;
  let app: Hono;
  let meetingId: number;
  let personId: number;

  beforeAll(() => {
    db = testDb();
    useDb(db);
    app = new Hono();
    app.onError(onError);
    app.notFound(onNotFound);
    mountRoutes(app);
    personId = makePerson(db, "Placeholder Person");
    meetingId = makeMeeting(db, personId, null, TODAY);
  });

  afterAll(() => {
    useDb(undefined);
    db.close();
  });

  async function post(path: string, body: Record<string, string>, htmx: boolean) {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (htmx) headers["HX-Request"] = "true";
    return await app.request(path, {
      method: "POST", headers, body: new URLSearchParams(body).toString(),
    });
  }

  test("htmx gets the list back, so nothing navigates and the page cannot jump", async () => {
    const res = await post(
      `/meetings/${meetingId}/actions`,
      { title: "Draft the rota proposal", assignee: "person", visibility: "shared",
        due_on: "15.09.2026" },
      true,
    );
    expect(res.status).toBe(200);
    const fragment = await res.text();
    expect(fragment).toContain("Draft the rota proposal");
    // A fragment, not a page: no layout, no redirect.
    expect(fragment).not.toContain("<html");

    // The date arrived day-first and is stored canonically (rule 4).
    expect(actionsCreatedIn(db, meetingId)[0]!.due_on).toBe("2026-09-15");
  });

  test("without htmx the old redirect is still there", async () => {
    const res = await post(
      `/meetings/${meetingId}/actions`, { title: "Works without scripting" }, false,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/meetings/${meetingId}`);
  });

  test("the page shows what was agreed here, with a way to drop each line", async () => {
    const body = await (await app.request(`/meetings/${meetingId}`)).text();
    expect(body).toContain("Draft the rota proposal");
    expect(body).toContain('id="agreement-list"');
    // The form aims at the list rather than at the page.
    expect(body).toContain(`hx-post="/meetings/${meetingId}/actions"`);
    expect(body).toContain('hx-target="#agreement-list"');
    const dropped = actionsCreatedIn(db, meetingId)[0]!;
    expect(body).toContain(`/meetings/${meetingId}/actions/${dropped.id}/delete`);
  });

  test("dropping through the route answers with the shortened list", async () => {
    const before = actionsCreatedIn(db, meetingId);
    const res = await post(
      `/meetings/${meetingId}/actions/${before[0]!.id}/delete`, {}, true,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(before[0]!.title);
    expect(actionsCreatedIn(db, meetingId)).toHaveLength(before.length - 1);
  });

  test("a completed meeting keeps its agreements and offers no way to drop them", async () => {
    completeMeeting(db, meetingId);
    const remaining = actionsCreatedIn(db, meetingId);
    expect(remaining.length).toBeGreaterThan(0);

    const res = await post(
      `/meetings/${meetingId}/actions/${remaining[0]!.id}/delete`, {}, true,
    );
    expect(res.status).toBe(200);
    expect(actionsCreatedIn(db, meetingId)).toHaveLength(remaining.length);

    const body = await (await app.request(`/meetings/${meetingId}`)).text();
    expect(body).toContain(remaining[0]!.title);
    expect(body).not.toContain(`/actions/${remaining[0]!.id}/delete`);
  });
});
