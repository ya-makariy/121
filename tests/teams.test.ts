import { describe, expect, test } from "bun:test";
import {
  testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId,
} from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions } from "../src/db/queries/templates.ts";
import { getMetricByKey, teamAggregate, teamsWithPeople } from "../src/db/queries/metrics.ts";
import {
  getMembership, listTeamMembers, listTeams, teamsForPerson,
} from "../src/db/queries/teams.ts";
import {
  addTeamMember, archiveTeam, createTeam, recordDeparture, restoreTeam, setMemberPrimary,
  TeamEditError, updateTeam,
} from "../src/domain/teams.ts";
import type { Database } from "bun:sqlite";

/** The starter template's job_satisfaction field, on the default version. */
function satisfactionField(db: Database): { versionId: number; fieldId: number } {
  const versionId = defaultVersionId(db);
  const fieldId = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'job_satisfaction'",
    )
    .get(versionId)!.id;
  return { versionId, fieldId };
}

describe("teams", () => {
  test("a team is created, renamed and archived, never deleted", () => {
    const db = testDb();
    const team = createTeam(db, { name: "Platform", description: null });

    expect(listTeams(db).map((t) => t.name)).toEqual(["Platform"]);
    expect(updateTeam(db, team.id, { name: "Platform and tools", description: "Two squads" }).name)
      .toBe("Platform and tools");

    archiveTeam(db, team.id);
    expect(listTeams(db)).toHaveLength(0);
    // Archived, not gone: the row is still there and can come back.
    expect(listTeams(db, 1, true)).toHaveLength(1);
    restoreTeam(db, team.id);
    expect(listTeams(db)).toHaveLength(1);
  });

  test("a team name is required and unique per owner", () => {
    const db = testDb();
    createTeam(db, { name: "Platform", description: null });

    expect(() => createTeam(db, { name: "   ", description: null }))
      .toThrow(new TeamEditError("TEAM_NAME_REQUIRED"));
    expect(() => createTeam(db, { name: "Platform", description: null }))
      .toThrow(new TeamEditError("TEAM_NAME_TAKEN", { name: "Platform" }));
  });

  /**
   * The rule the schema also enforces with ux_person_primary_team. The point of the test is
   * that the manager gets a coded domain error rather than a raw unique-index failure.
   */
  test("a second primary team is refused with an error code, not a unique-index crash", () => {
    const db = testDb();
    const platform = createTeam(db, { name: "Platform", description: null });
    const growth = createTeam(db, { name: "Growth", description: null });
    const personId = makePerson(db, "Someone Primary");

    addTeamMember(db, {
      teamId: platform.id, personId, isPrimary: true, onDate: "2026-01-15",
    });

    let thrown: unknown = null;
    try {
      addTeamMember(db, { teamId: growth.id, personId, isPrimary: true, onDate: "2026-02-01" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TeamEditError);
    expect((thrown as TeamEditError).code).toBe("PERSON_PRIMARY_TEAM_TAKEN");
    expect((thrown as TeamEditError).params).toEqual({ team: "Platform" });

    // Nothing was written: the refusal happens before the insert.
    expect(getMembership(db, growth.id, personId)).toBeNull();

    // The same refusal when flipping the flag on a membership that already exists.
    addTeamMember(db, { teamId: growth.id, personId, isPrimary: false, onDate: "2026-02-01" });
    expect(() => setMemberPrimary(db, growth.id, personId, true))
      .toThrow(new TeamEditError("PERSON_PRIMARY_TEAM_TAKEN", { team: "Platform" }));
    expect(getMembership(db, growth.id, personId)!.is_primary).toBe(0);

    // A second, non-primary team is fine: team_member is a real many-to-many.
    expect(teamsForPerson(db, personId)).toHaveLength(2);
  });

  test("a departure is a date, not a deleted row", () => {
    const db = testDb();
    const team = createTeam(db, { name: "Platform", description: null });
    const personId = makePerson(db, "Someone Leaving");
    addTeamMember(db, { teamId: team.id, personId, isPrimary: true, onDate: "2026-01-15" });

    recordDeparture(db, team.id, personId, "2026-06-30");

    const roster = listTeamMembers(db, team.id);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.left_on).toBe("2026-06-30");
    // The current roster shrinks, which is what the /compare filter counts.
    expect(listTeams(db)[0]!.member_count).toBe(0);
    // And the flag is free again, so another team can become primary.
    const growth = createTeam(db, { name: "Growth", description: null });
    expect(() =>
      addTeamMember(db, { teamId: growth.id, personId, isPrimary: true, onDate: "2026-07-01" })
    ).not.toThrow();
  });

  test("the /compare team filter is filled from real data", () => {
    const db = testDb();
    const team = createTeam(db, { name: "Platform", description: null });
    for (const name of ["Someone One", "Someone Two"]) {
      addTeamMember(db, {
        teamId: team.id, personId: makePerson(db, name), isPrimary: true, onDate: "2026-01-15",
      });
    }

    expect(teamsWithPeople(db)).toEqual([{ id: team.id, name: "Platform", people: 2 }]);
  });

  /**
   * left_on is a departure date, not a removal: whoever was in the team in May belongs to
   * the team's May. The "current" roster answers a different question and stays the default.
   */
  test("someone who left is still counted in an aggregate for a past period", () => {
    const db = testDb();
    const { versionId, fieldId } = satisfactionField(db);
    const metric = getMetricByKey(db, "job_satisfaction")!;
    const team = createTeam(db, { name: "Platform", description: null });

    const stayed = makePerson(db, "Someone Staying");
    const left = makePerson(db, "Someone Leaving");
    addTeamMember(db, {
      teamId: team.id, personId: stayed, isPrimary: true, onDate: "2026-05-01",
    });
    addTeamMember(db, {
      teamId: team.id, personId: left, isPrimary: false, onDate: "2026-05-01",
    });

    // Both answer 5 in May: normalized (5-1)/(5-1) = 1.
    for (const personId of [stayed, left]) {
      const meeting = makeMeeting(db, personId, versionId, "2026-05-20");
      saveAnswer(db, meeting, getFieldWithOptions(db, fieldId)!, { value: "5" });
      completeMeeting(db, meeting);
    }
    recordDeparture(db, team.id, left, "2026-06-30");

    const asItStands = teamAggregate(db, team.id, metric.id, "0000-01-01", 1, "current");
    expect(asItStands).toHaveLength(1);
    expect(asItStands[0]!.people).toBe(1);

    const atTheTime = teamAggregate(db, team.id, metric.id, "0000-01-01", 1, "at_the_time");
    expect(atTheTime).toHaveLength(1);
    expect(atTheTime[0]!.period).toBe("2026-05");
    expect(atTheTime[0]!.people).toBe(2);
    expect(atTheTime[0]!.avg_norm).toBeCloseTo(1, 5);

    // A meeting held after the departure is not attributed to the team.
    const after = makeMeeting(db, left, versionId, "2026-07-15");
    saveAnswer(db, after, getFieldWithOptions(db, fieldId)!, { value: "1" });
    completeMeeting(db, after);
    const july = teamAggregate(db, team.id, metric.id, "0000-01-01", 1, "at_the_time")
      .find((r) => r.period === "2026-07");
    expect(july).toBeUndefined();
  });
});
