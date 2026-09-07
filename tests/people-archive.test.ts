import { describe, expect, test } from "bun:test";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId,
} from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";
import {
  archivePerson, getPerson, listArchivedPeople, listPeople, restorePerson,
} from "../src/db/queries/people.ts";
import { listMeetingsForPerson } from "../src/db/queries/meetings.ts";
import { getMetricByKey, personTimeline } from "../src/db/queries/metrics.ts";

/**
 * CLAUDE.md rule 5 forbids a hard delete so that longitudinal history survives. An archive
 * with no list and no way back is that same delete, just without the warning — so the
 * round trip has to be a test, not a hope.
 */
describe("the person archive", () => {
  test("archive then restore leaves the meetings, answers and chart points untouched", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const fieldId = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
      )
      .get(versionId)!.id;
    const metric = getMetricByKey(db, "job_satisfaction")!;

    const personId = makePerson(db, "Someone Archived");
    for (const [heldOn, value] of [["2026-05-20", "4"], ["2026-06-24", "5"]] as const) {
      const meeting = makeMeeting(db, personId, versionId, heldOn);
      saveAnswer(db, meeting, getFieldWithOptions(db, fieldId)!, { value });
      completeMeeting(db, meeting);
    }

    const meetingsBefore = listMeetingsForPerson(db, personId);
    const pointsBefore = personTimeline(db, personId, metric.id);
    expect(meetingsBefore).toHaveLength(2);
    expect(pointsBefore).toHaveLength(2);

    archivePerson(db, personId);

    // Out of the live list, into the archive list — visible, not vanished.
    expect(listPeople(db).map((p) => p.id)).not.toContain(personId);
    expect(listArchivedPeople(db).map((p) => p.id)).toEqual([personId]);
    expect(getPerson(db, personId)!.archived_at).not.toBeNull();

    // Archiving writes archived_at and nothing else: the history is still all there.
    expect(listMeetingsForPerson(db, personId)).toHaveLength(2);
    expect(
      db.query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM meeting_answer a
         JOIN meeting m ON m.id = a.meeting_id WHERE m.person_id = ?`,
      ).get(personId)!.n,
    ).toBe(2);

    restorePerson(db, personId);

    expect(getPerson(db, personId)!.archived_at).toBeNull();
    expect(listArchivedPeople(db)).toHaveLength(0);
    expect(listPeople(db).map((p) => p.id)).toEqual([personId]);
    expect(listMeetingsForPerson(db, personId)).toEqual(meetingsBefore);
    expect(personTimeline(db, personId, metric.id)).toEqual(pointsBefore);
  });

  test("archiving one person does not touch another", () => {
    const db = testDb();
    const kept = makePerson(db, "Someone Kept");
    const archived = makePerson(db, "Someone Archived");

    archivePerson(db, archived);
    expect(listPeople(db).map((p) => p.id)).toEqual([kept]);
    expect(listArchivedPeople(db).map((p) => p.id)).toEqual([archived]);

    restorePerson(db, archived);
    expect(listPeople(db)).toHaveLength(2);
  });
});
