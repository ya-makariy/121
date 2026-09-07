import type { Database } from "bun:sqlite";
import type { TeamRow } from "../types.ts";

/**
 * Reading teams and their rosters. Writes live in `domain/teams.ts`, the same split as
 * `metrics.ts` / `metrics-editor.ts`: a write to a team has rules behind it (one primary
 * team per person, departure instead of deletion) and those rules carry error codes.
 *
 * "How many people" always means the current roster — members whose `left_on` is still
 * NULL — because that is what a filter on /compare is about. History is not lost by that
 * count: departed members are still returned by listTeamMembers().
 */

export interface TeamWithMembers extends TeamRow {
  /** Members who have not left. */
  member_count: number;
}

export function listTeams(db: Database, ownerId = 1, includeArchived = false): TeamWithMembers[] {
  return db
    .query<TeamWithMembers, [number]>(
      `SELECT t.*,
              (SELECT COUNT(*) FROM team_member tm
               WHERE tm.team_id = t.id AND tm.left_on IS NULL) AS member_count
       FROM team t
       WHERE t.owner_id = ?${includeArchived ? "" : " AND t.archived_at IS NULL"}
       ORDER BY t.name`,
    )
    .all(ownerId);
}

export function getTeam(db: Database, id: number, ownerId = 1): TeamRow | null {
  return (
    db
      .query<TeamRow, [number, number]>("SELECT * FROM team WHERE id = ? AND owner_id = ?")
      .get(id, ownerId) ?? null
  );
}

export function getTeamByName(db: Database, name: string, ownerId = 1): TeamRow | null {
  return (
    db
      .query<TeamRow, [string, number]>("SELECT * FROM team WHERE name = ? AND owner_id = ?")
      .get(name, ownerId) ?? null
  );
}

export interface TeamMemberRow {
  team_id: number;
  person_id: number;
  full_name: string;
  role_title: string | null;
  is_primary: 0 | 1;
  joined_on: string | null;
  /** The date the person left the team. Not a deletion marker: history keeps the row. */
  left_on: string | null;
}

/** The whole roster, past members included: a departure is a date, not a disappearance. */
export function listTeamMembers(db: Database, teamId: number): TeamMemberRow[] {
  return db
    .query<TeamMemberRow, [number]>(
      `SELECT tm.team_id, tm.person_id, p.full_name, p.role_title,
              tm.is_primary, tm.joined_on, tm.left_on
       FROM team_member tm
       JOIN person p ON p.id = tm.person_id
       WHERE tm.team_id = ?
       ORDER BY tm.left_on IS NOT NULL, tm.is_primary DESC, p.full_name`,
    )
    .all(teamId);
}

export interface PersonTeamRow {
  team_id: number;
  name: string;
  archived_at: string | null;
  is_primary: 0 | 1;
  joined_on: string | null;
  left_on: string | null;
}

/** Every team this person has ever been in, current ones first. */
export function teamsForPerson(db: Database, personId: number): PersonTeamRow[] {
  return db
    .query<PersonTeamRow, [number]>(
      `SELECT t.id AS team_id, t.name, t.archived_at,
              tm.is_primary, tm.joined_on, tm.left_on
       FROM team_member tm
       JOIN team t ON t.id = tm.team_id
       WHERE tm.person_id = ?
       ORDER BY tm.left_on IS NOT NULL, tm.is_primary DESC, t.name`,
    )
    .all(personId);
}

export function getMembership(
  db: Database, teamId: number, personId: number,
): TeamMemberRow | null {
  return (
    db
      .query<TeamMemberRow, [number, number]>(
        `SELECT tm.team_id, tm.person_id, p.full_name, p.role_title,
                tm.is_primary, tm.joined_on, tm.left_on
         FROM team_member tm
         JOIN person p ON p.id = tm.person_id
         WHERE tm.team_id = ? AND tm.person_id = ?`,
      )
      .get(teamId, personId) ?? null
  );
}

/**
 * The person's current primary team, if any. Mirrors the partial unique index
 * `ux_person_primary_team` exactly, so the check in the domain and the constraint in the
 * schema cannot disagree.
 */
export function primaryTeamForPerson(
  db: Database, personId: number, exceptTeamId: number | null = null,
): { team_id: number; name: string } | null {
  return (
    db
      .query<{ team_id: number; name: string }, [number, number]>(
        `SELECT t.id AS team_id, t.name
         FROM team_member tm
         JOIN team t ON t.id = tm.team_id
         WHERE tm.person_id = ? AND tm.is_primary = 1 AND tm.left_on IS NULL
           AND t.id <> ?
         LIMIT 1`,
      )
      // -1 is not a real id, so "no exception" simply excludes nothing.
      .get(personId, exceptTeamId ?? -1) ?? null
  );
}
