import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, defaultVersionId } from "./helpers.ts";
import { answeredFieldIds, getMeeting } from "../src/db/queries/meetings.ts";
import { getTemplate, getVersion, loadVersionStructure } from "../src/db/queries/templates.ts";
import { listMetrics } from "../src/db/queries/metrics.ts";
import { getPerson } from "../src/db/queries/people.ts";
import { meetingPage } from "../src/views/pages/meeting.ts";
import { personPage } from "../src/views/pages/person.ts";
import { templateEditorPage } from "../src/views/pages/template-editor.ts";
import { nowIso } from "../src/lib/dates.ts";

/**
 * Privacy is an invariant, so it gets one visual carrier of its own — a label above the
 * card — and it must not share that carrier with anything else. `.notice` is a yellow edge
 * plus a yellow fill; while `.card.private` was a lilac edge plus a lilac fill the two
 * read as the same kind of statement, and a manager who has learned that the lilac frame
 * means "the report will not see this" would one day read a yellow one the same way.
 *
 * These are presentation assertions only. That private content never leaves the instance
 * is settled in tests/snapshot-privacy.test.ts, which this change does not touch.
 */
describe("the privacy label", () => {
  test("a private meeting section wears the label, and the card returns to the surface", () => {
    const db = testDb();
    const personId = makePerson(db);
    const versionId = defaultVersionId(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");
    const meeting = getMeeting(db, meetingId)!;
    const sections = loadVersionStructure(db, versionId);

    const privateSection = sections.find(
      (s) => s.fields.length > 0 && s.fields.every((f) => f.visibility === "private"),
    );
    expect(privateSection).toBeDefined();

    const page = meetingPage({
      locale: "en", theme: "auto", meeting, person: getPerson(db, personId, 1)!, sections,
      answers: new Map(), answered: answeredFieldIds(db, meetingId),
      carryOver: [], shares: [], today: "2026-09-07",
    });

    expect(page).toContain('class="private-head"');
    expect(page).toContain('class="card private attached"');
    // The section heading no longer carries the badge: the label above the card says it.
    const head = page.slice(page.indexOf(`id="section-${privateSection!.id}"`));
    expect(head.slice(0, head.indexOf("</div>"))).not.toContain("badge private");
    // The private notes form gets the same label rather than a tinted card of its own.
    expect(page).toContain("private-notes");
    expect(page).not.toContain('class="card private"');
  });

  test("person notes wear the label", () => {
    const db = testDb();
    const personId = makePerson(db);
    db.query("UPDATE person SET notes = ?, updated_at = ? WHERE id = ?")
      .run("Worth a conversation about scope next quarter.", nowIso(), personId);

    const page = personPage({
      locale: "en", theme: "auto", person: getPerson(db, personId, 1)!, cadence: null,
      meetings: [], actions: [], metrics: [],
    });

    expect(page).toContain('class="private-head"');
    expect(page).toContain('class="card private attached"');
  });

  test("a fully private section in the builder wears the label too", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const template = getTemplate(db, 1)!;

    const page = templateEditorPage({
      locale: "en", theme: "auto", template, version: getVersion(db, versionId)!,
      sections: loadVersionStructure(db, versionId), metrics: listMetrics(db),
      problems: [], answerCounts: new Map(), meetingsOnVersion: 0,
      editField: null, editSection: null, addFieldTo: null, forked: false, error: null,
    });

    expect(page).toContain('class="private-head"');
    expect(page).toContain("section-card private");
    // The addressing keys are untouched by the label (rule 5).
    for (const s of loadVersionStructure(db, versionId)) {
      expect(page).toContain(`data-key="${s.section_key}"`);
      for (const f of s.fields) expect(page).toContain(`data-key="${f.field_key}"`);
    }
  });
});
