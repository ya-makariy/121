# 121

*Читать по-русски: [README.ru.md](README.ru.md)*

A self-hosted tool for running regular 1:1 meetings: people and teams, meetings driven by a
custom agenda, metric trends over time, side-by-side comparison of people, and a summary for
the report that leaves out the private part.

Runs locally: Bun + SQLite, no build step, no external services, no CDN. Data about people
is sensitive and should not end up in someone else's SaaS.

## Running

```sh
bun install
cp .env.example .env      # optional: the defaults work
bun run start             # http://127.0.0.1:3121 — your real 1:1s
```

Migrations apply themselves on start. The real database is `data/121.sqlite`; the whole
`data/` directory is in `.gitignore`.

There are two databases, not one: demo data and real records about people must never mix,
not even by accident, so development gets its own.

| Command | Database | Purpose |
| --- | --- | --- |
| `bun run start` | `data/121.sqlite` | Real work. No watch. |
| `bun run dev` | `data/dev.sqlite` | Development: restart on change. |
| `bun run demo` | `data/dev.sqlite` | 4 invented people and 20 completed meetings, to look at charts and comparison on populated data. |

`start` does not set `DB_PATH` itself, so the database can be moved anywhere via `.env`.
`dev` and `demo`, on the contrary, are pinned to `data/dev.sqlite`: an inline assignment
beats `.env`, and that is what keeps `bun run demo` from one day appending invented people
to real ones. This is enforced by `tests/run-targets.test.ts`, not by convention.

If you need watch mode against the real database, run `bun --watch src/server.ts` directly
and deliberately.

## What works today

- **People** — CRUD, role, meeting cadence, the manager's private notes, a link to the
  standing call room: an "Open meeting" button on the dashboard, in the list, on the person
  card and in the meeting header. Archived people can be restored.
- **Teams** — create, rename, archive; a person is assigned to a team from their page with
  a "primary team" flag. Leaving a team is a date, not a deletion, so past team aggregates
  keep the person.
- **Meetings from a template** — sections and typed fields (scale, text, short text,
  checkbox, date, single and multiple choice), autosave per field, a section rail with
  progress, a sticky completion panel. An ad-hoc check-in can be excluded from the cadence
  count.
- **Template builder** — sections and questions, reordering by drag or arrows, binding to a
  metric, visibility flag, template validation, versions with a diff. Editing a template
  that already has meetings creates a new version: past meetings do not change.
- **Metrics** — create and edit, usage counter. A metric's key is fixed as soon as anything
  references it: the continuity of history depends on it.
- **Action items** — with an assignee, due date and visibility; open ones surface on their
  own in the next meeting's agenda.
- **Cadence** — a dashboard grouped by urgency (overdue / due soon / ok), no cron and no
  notifications.
- **Charts** — a metric's trend per person; comparison of people on one canvas (team
  average, spread band, individual lines) and a "who needs attention" list.
- **Summary for the report** — an immutable snapshot of the fields marked `shared`, a
  tokenized link and a Markdown download.
- **Export and backup** — full export to JSON and Markdown, a database copy via
  `VACUUM INTO`.
- **Settings** — interface language (Russian and English), timezone for cadence
  arithmetic, theme.
- **Light and dark theme** — follows the system by default, switchable in the header and in
  settings; the chart palette is validated separately against each surface.

The full plan, the reasoning behind each decision and the v2 outlook are in
[PLAN.md](PLAN.md). The rules that must not be broken when extending the tool are in
[CLAUDE.md](CLAUDE.md).
The visual specification and the redesign canvas are in [design/](design/README.md).

## Privacy

Every template field carries a `shared` / `private` flag. Private content never leaves the
instance: not in the summary, not in the Markdown, not in chart data. This is enforced by
`tests/snapshot-privacy.test.ts`, which fills every field type with a private sentinel and
searches for it across every sharing surface.

Export is the opposite: it includes private content, because it is a backup, not a summary.
That is why export and sharing are separate functions with separate routes.

## v1 limitations

There is no authentication: the app listens on `127.0.0.1`, and whoever connects is treated
as the owner. So the report cannot open a share link; the summary is sent as a file.
Authentication, cloud installation and access from several devices are v2; the data model
is ready for it (see the "v2" section in PLAN.md).

## Development

```sh
bun test          # 163 tests
bunx tsc --noEmit # types
bun run backup    # database copy into data/backups/
```

Migrations are numbered `.sql` files in `src/db/migrations/`, applied forward by
`PRAGMA user_version`. Checksums of applied migrations are verified on start: an already
applied file cannot be edited, a new migration is required.

Code, identifiers and comments are English; Cyrillic is allowed only in the localization
layer (`src/i18n/`). The starter template in the seed is English too: it is user content,
but everyone who installs the tool sees it, and it can be renamed in the builder. This is
enforced by a test, not by convention: `bun test tests/language.test.ts`. User-facing text is
never written in code; it lives in the dictionaries `src/i18n/ru.ts` and `src/i18n/en.ts`
and is looked up by key, and domain errors carry a code that the presentation layer
translates.
