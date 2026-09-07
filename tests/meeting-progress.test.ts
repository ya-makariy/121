import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, defaultVersionId, addField } from "./helpers.ts";
import { answeredFieldIds, getMeeting } from "../src/db/queries/meetings.ts";
import { loadVersionStructure, getFieldWithOptions } from "../src/db/queries/templates.ts";
import { getPerson } from "../src/db/queries/people.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { meetingPage } from "../src/views/pages/meeting.ts";
import type { Database } from "bun:sqlite";

function answerRowCount(db: Database, meetingId: number): number {
  return db
    .query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM meeting_answer WHERE meeting_id = ?",
    )
    .get(meetingId)!.n;
}

function render(db: Database, meetingId: number): string {
  const meeting = getMeeting(db, meetingId)!;
  const person = getPerson(db, meeting.person_id, 1)!;
  return meetingPage({
    locale: "en",
    meeting,
    person,
    sections: loadVersionStructure(db, meeting.template_version_id!),
    answers: new Map(),
    answered: answeredFieldIds(db, meetingId),
    carryOver: [],
    shares: [],
    today: "2026-09-07",
  });
}

describe("meeting progress", () => {
  /**
   * The counter on the page is the number of rows in meeting_answer for the meeting, and
   * nothing else. A blank answer is a deleted row (domain/answers.ts), so the two cannot
   * drift: if this ever disagrees, the progress bar is lying about work that was done.
   */
  test("the filled counter equals the number of meeting_answer rows", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    expect(answeredFieldIds(db, meetingId).size).toBe(0);
    expect(answerRowCount(db, meetingId)).toBe(0);

    const fields = loadVersionStructure(db, versionId)
      .flatMap((s) => s.fields)
      .filter((f) => f.type === "scale");
    expect(fields.length).toBeGreaterThan(2);

    for (const f of fields.slice(0, 3)) {
      saveAnswer(db, meetingId, getFieldWithOptions(db, f.id)!, { value: "3" });
      expect(answeredFieldIds(db, meetingId).size).toBe(answerRowCount(db, meetingId));
    }
    expect(answeredFieldIds(db, meetingId).size).toBe(3);

    // Clearing an answer erases the row, so the counter goes back down with it.
    saveAnswer(db, meetingId, getFieldWithOptions(db, fields[0]!.id)!, { value: "" });
    expect(answerRowCount(db, meetingId)).toBe(2);
    expect(answeredFieldIds(db, meetingId).size).toBe(2);
  });

  test("the counter is per meeting, never shared between two of them", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const first = makeMeeting(db, personId, versionId, "2026-08-20");
    const second = makeMeeting(db, personId, versionId, "2026-09-07");

    const field = getFieldWithOptions(
      db,
      loadVersionStructure(db, versionId).flatMap((s) => s.fields)
        .find((f) => f.type === "scale")!.id,
    )!;
    saveAnswer(db, first, field, { value: "4" });

    expect(answeredFieldIds(db, first).size).toBe(answerRowCount(db, first));
    expect(answeredFieldIds(db, second).size).toBe(0);
  });

  /** The page states the same numbers the query produced, computed on the server. */
  test("the page reports the server-side count and one rail entry per section", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    const sections = loadVersionStructure(db, versionId);
    const total = sections.reduce((n, s) => n + s.fields.length, 0);

    expect(render(db, meetingId)).toContain(`0 of ${total} filled`);

    const field = getFieldWithOptions(
      db, sections.flatMap((s) => s.fields).find((f) => f.type === "scale")!.id,
    )!;
    saveAnswer(db, meetingId, field, { value: "5" });

    const page = render(db, meetingId);
    expect(page).toContain(`1 of ${total} filled`);
    for (const s of sections) expect(page).toContain(`href="#section-${s.id}"`);
    // The panel carries the completion action and the cadence flag, in one place.
    expect(page).toContain('class="commit-bar"');
    expect(page).toContain(`/meetings/${meetingId}/counts-for-cadence`);
    expect(page).toContain(`/meetings/${meetingId}/complete`);
  });

  /**
   * Rule 2. Marking that a private section exists is fine — the manager needs to know the
   * page has one. A word of what is written inside it is not, and the rail is the newest
   * place where such a word could leak.
   */
  test("the rail names a private section but carries none of its content", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const secret = "sole trust in the quiet of the north wing";
    const fieldId = addField(db, versionId, {
      sectionKey: "sec_only_you", fieldKey: "attrition_guess",
      label: "Attrition risk as I read it", type: "text", visibility: "private",
    });
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");
    saveAnswer(db, meetingId, getFieldWithOptions(db, fieldId)!, { value: secret });

    const page = render(db, meetingId);
    // The page navigation carries a </nav> of its own, so measure from the rail forwards.
    const start = page.indexOf('<nav class="rail"');
    expect(start).toBeGreaterThan(-1);
    const rail = page.slice(start, page.indexOf("</nav>", start));

    expect(rail).toContain("private-item");
    expect(rail).not.toContain(secret);
    // Counted, not quoted: the rail says one of one is filled and stops there.
    expect(rail).toContain("1/1");
    expect(answeredFieldIds(db, meetingId).size).toBe(answerRowCount(db, meetingId));
  });
});
