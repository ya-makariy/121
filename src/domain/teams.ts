import type { Database } from "bun:sqlite";
import type { TeamRow } from "../db/types.ts";
import { nowIso } from "../lib/dates.ts";
import { TeamEditError } from "../lib/errors.ts";
import { getMembership, getTeam, getTeamByName, primaryTeamForPerson } from "../db/queries/teams.ts";

/**
 * Team operations. Two rules do the work here.
 *
 * A person has at most one primary team. The schema enforces it with the partial unique
 * index `ux_person_primary_team`, but an index failure is a 500 with a SQLite sentence in
 * it. The manager gets a coded domain error instead, naming the team that already holds
 * the flag (CLAUDE.md rule 1).
 *
 * Leaving a team is `left_on`, a date — not a deleted row. A person who left in March is
 * still part of the team's March, and dropping the row would rewrite that history
 * (CLAUDE.md rule 5). The same reason teams themselves are archived, never deleted.
 */

export interface TeamInput {
  name: string;
  description: string | null;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new TeamEditError("TEAM_NAME_REQUIRED");
  return trimmed;
}

export function createTeam(db: Database, input: TeamInput, ownerId = 1): TeamRow {
  const name = cleanName(input.name);
  if (getTeamByName(db, name, ownerId) !== null) {
    throw new TeamEditError("TEAM_NAME_TAKEN", { name });
  }

  const now = nowIso();
  return db
    .query<TeamRow, [number, string, string | null, string, string]>(
      `INSERT INTO team (owner_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(ownerId, name, input.description, now, now)!;
}

/** Renaming is safe: `team.id` is the identity, the name is only a label. */
export function updateTeam(
  db: Database, teamId: number, input: TeamInput, ownerId = 1,
): TeamRow {
  const existing = getTeam(db, teamId, ownerId);
  if (existing === null) throw new TeamEditError("TEAM_NOT_FOUND");

  const name = cleanName(input.name);
  const clash = getTeamByName(db, name, ownerId);
  if (clash !== null && clash.id !== teamId) {
    throw new TeamEditError("TEAM_NAME_TAKEN", { name });
  }

  return db
    .query<TeamRow, [string, string | null, string, number, number]>(
      `UPDATE team SET name = ?, description = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? RETURNING *`,
    )
    .get(name, input.description, nowIso(), teamId, ownerId)!;
}

/** Archive, never delete: the roster and every aggregate built on it stay readable. */
export function archiveTeam(db: Database, teamId: number, ownerId = 1): void {
  const now = nowIso();
  db.query("UPDATE team SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(now, now, teamId, ownerId);
}

export function restoreTeam(db: Database, teamId: number, ownerId = 1): void {
  db.query("UPDATE team SET archived_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(nowIso(), teamId, ownerId);
}

/**
 * Everything that has to hold before a person is put into a team, checked before any row
 * is written so a rejected assignment leaves nothing half-done.
 */
export function assertAssignable(
  db: Database, teamId: number, personId: number | null, isPrimary: boolean, ownerId = 1,
): TeamRow {
  const team = getTeam(db, teamId, ownerId);
  if (team === null || team.archived_at !== null) throw new TeamEditError("TEAM_NOT_FOUND");
  if (isPrimary && personId !== null) {
    const held = primaryTeamForPerson(db, personId, teamId);
    if (held !== null) throw new TeamEditError("PERSON_PRIMARY_TEAM_TAKEN", { team: held.name });
  }
  return team;
}

/**
 * Puts a person in a team, or updates the primary flag if they are already in it.
 *
 * `onDate` is the join date and comes from the caller — `date('now')` is UTC and by
 * evening in Moscow it is already tomorrow (CLAUDE.md rule 4).
 *
 * Rejoining a team the person had left moves `joined_on` forward and clears `left_on`:
 * `team_member` is keyed by (team_id, person_id), so one pair holds one spell. That is a
 * schema limit, not a choice — a second spell would need a new primary key.
 */
export function addTeamMember(
  db: Database,
  args: { teamId: number; personId: number; isPrimary: boolean; onDate: string },
  ownerId = 1,
): void {
  assertAssignable(db, args.teamId, args.personId, args.isPrimary, ownerId);
  const existing = getMembership(db, args.teamId, args.personId);
  const primary = args.isPrimary ? 1 : 0;

  if (existing === null) {
    db.query(
      `INSERT INTO team_member (team_id, person_id, is_primary, joined_on)
       VALUES (?, ?, ?, ?)`,
    ).run(args.teamId, args.personId, primary, args.onDate);
    return;
  }

  if (existing.left_on !== null) {
    db.query(
      "UPDATE team_member SET is_primary = ?, joined_on = ?, left_on = NULL WHERE team_id = ? AND person_id = ?",
    ).run(primary, args.onDate, args.teamId, args.personId);
    return;
  }

  db.query("UPDATE team_member SET is_primary = ? WHERE team_id = ? AND person_id = ?")
    .run(primary, args.teamId, args.personId);
}

export function setMemberPrimary(
  db: Database, teamId: number, personId: number, isPrimary: boolean, ownerId = 1,
): void {
  assertAssignable(db, teamId, personId, isPrimary, ownerId);
  db.query("UPDATE team_member SET is_primary = ? WHERE team_id = ? AND person_id = ?")
    .run(isPrimary ? 1 : 0, teamId, personId);
}

/**
 * Records that someone left. The row stays, so the team's past periods still include them
 * and only the current roster shrinks.
 */
export function recordDeparture(
  db: Database, teamId: number, personId: number, onDate: string, ownerId = 1,
): void {
  if (getTeam(db, teamId, ownerId) === null) throw new TeamEditError("TEAM_NOT_FOUND");
  db.query("UPDATE team_member SET left_on = ? WHERE team_id = ? AND person_id = ?")
    .run(onDate, teamId, personId);
}

export { TeamEditError };
