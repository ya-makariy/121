# 121 — project rules

A tool for running 1:1 meetings. Self-hosted, local, single manager.
The full plan and the reasoning behind each decision live in `PLAN.md`. Below are the rules
that must not be broken, because each one closes a specific way to corrupt the data or
break the user's trust.

## 1. Language: English in code, Russian only in the localization layer

All code, identifiers, comments, commit messages and thrown developer-facing messages are
in **English**. No Cyrillic anywhere in source files.

User-facing text is not hardcoded — it lives in the localization layer and is looked up by
key. When you need a new string, add it to `src/i18n/ru.ts` and `src/i18n/en.ts` and
reference it through `dict(locale)`; never inline a Russian literal in a route, view or
domain module, and never branch on locale inside business logic.

Domain errors carry a stable **error code**, not a sentence. The route or view translates
the code through the dictionary. That keeps the domain free of presentation concerns and
free of Cyrillic at the same time.

Cyrillic is allowed in exactly one place, and `tests/language.test.ts` enforces it with no
exception list:

- **`src/i18n/`** — the localization layer as a whole: the dictionaries, the
  transliteration table used to build keys, and month names in the grammatical cases Intl
  does not provide. Locale-specific data belongs here and nowhere else, which is why
  `formatDate` lives in `src/i18n/dates.ts` while `lib/dates.ts` keeps only locale-free
  arithmetic.

The seed migrations are not an exception. A template's content is user content, not code,
and it is single-language by design (see "user content is single-language" in `PLAN.md`) —
but the starter template is the first thing every new instance shows, so it is authored in
English, and a manager who works in another language renames its sections and questions in
the builder.

Why this rule: the repository is public, the audience for the code is international, and
mixing scripts inside identifiers and grep patterns is a steady source of small errors.

## 2. Field privacy is an invariant, not a matter of care

Every template field has a `visibility` (`shared` | `private`). Private content never
leaves the instance: not on the share page, not in the snapshot Markdown, not in a chart
payload, not in an HTMX partial.

- The sharing path reads **only** the `v_shared_answer` view. Nothing else.
- `domain/snapshot.ts` is the only snapshot builder. `db/queries/shares.ts` imports no
  other query module.
- `buildSharedSnapshot()` checks its own result at the end and throws if a private field
  made it in.
- `meeting.private_notes` and `person.notes` never reach a snapshot under any condition.
- `tests/snapshot-privacy.test.ts` is never deleted or weakened. Ever.

The database default for `visibility` is `private`. A bug that forgets to pass visibility
must hide, not reveal.

Export and sharing have **opposite** privacy contracts: `exportFullJson()` /
`exportFullMarkdown()` include private content (they are a backup), `buildSharedSnapshot()`
does not. They are separate functions with separate names and separate routes. The choice
between them is never made by a query parameter such as `?format=`.

## 3. Answer values are columns, not JSON

JSON is permitted in exactly four places: `share_link.snapshot_json`,
`template_field.config_json`, `app_setting.value`, and export output.

Everything else that will ever be filtered, joined, aggregated or referenced by a foreign
key gets a column. Under deadline pressure `meeting.answers_json` always looks like it
saves a day, and it costs every chart, every aggregate and every future type change.

Denormalization is acceptable only where it captures point-in-time meaning:
`meeting_answer.field_key`, `meeting_answer_option.option_key`, the share snapshot. Never
denormalize something that is one JOIN away from immutable data.

## 4. Dates: `?today` is a parameter, `date('now')` is banned

`date('now')` in SQLite is UTC. In Moscow after 21:00 that is already tomorrow, and the
cadence dashboard starts lying by a day.

- Today's date is computed by `domain/cadence.ts:todayInTz()` from `app_user.timezone`.
- Every query takes it as a bound `?today` parameter.
- `tests/no-sql-now.test.ts` enforces this over `src/db/queries/` (migrations excepted).
- `held_on` is strictly `YYYY-MM-DD`: it is the only x-axis for charts and the only thing
  cadence arithmetic compares against. `scheduled_at` is the only instant, and it is always
  wrapped in `date()` before comparison.

## 5. History is never rewritten

- A template version is edited in place while `frozen_at IS NULL`. The first meeting bound
  to it freezes it; any later edit forks it, copying sections, fields and options and
  preserving `section_key` / `field_key` / `option_key`.
- This yields the invariant the editor relies on: **a draft version cannot have answers**,
  so changing a field's type, scale or visibility inside a draft is safe.
- All editor operations address sections, fields and options **by key, not by id**: after a
  fork the ids change and the keys do not.
- `meeting_answer.field_id` has **no** `ON DELETE CASCADE`, deliberately. A field with
  answers is not deleted; the attempt must fail rather than destroy history.
- `metric.key` is immutable once referenced. Only `label` changes.
- People, teams, templates and metrics are removed via `archived_at`. In a tool whose value
  is longitudinal history, a hard delete is a bug.

## 6. No build step

Bun + Hono + server-rendered HTML + HTMX. No bundler, no JSX, no runtime CDN — htmx and
Chart.js are vendored into `public/vendor/`.

- `views/html.ts` is the **only** place escaping is implemented. The `html` tagged template
  escapes every interpolated value unless it is wrapped in `raw()`.
- `views/components/field-input.ts` renders both the editable and the read-only form of
  every field type: one function, two modes, so the edit page and the share page cannot
  drift apart in how they interpret a value.
- Chart routes return JSON already shaped as `{labels, datasets}`. The client does not
  compute.
- Client scripts stay small and take their user-facing strings from `data-` attributes
  rendered by the server, so no user-facing text is hardcoded in JavaScript.

## 7. Backups only via `VACUUM INTO`

With WAL enabled, copying the `.sqlite` file silently loses everything still in the `-wal`.
`cp` is never used for backups, including in documentation.

## 8. Charts: palette and form

The categorical palette is eight slots in a fixed order (`--series-1..8` in
`public/app.css`), and since D10 there are **two** of them: the bare `:root` holds the
values validated against the light surface, and the `prefers-color-scheme: dark` branch
holds a second set validated against the dark one. A ninth slot is never generated: at
most eight series, beyond that use a list or facets.

- **A colour slot belongs to an entity, never to a rank — and to the same entity on both
  surfaces.** A person does not change colour because their score moved, a filter does not
  repaint the survivors, and the sun going down does not repaint them either: each dark
  slot holds its light slot's hue to within two degrees in OKLCH, so slot 3 is the same
  person's green in either theme. Only lightness and chroma are re-stepped, because
  lightness and chroma are what the surface changes.
- **Each palette is validated against its own surface, never inherited from the other.**
  The dark eight are not a lightening of the light eight: every slot is solved for at
  least 4:1 against the dark card, and the set is re-checked on that surface for the
  lightness band, the chroma floor and colour-vision separation of adjacent pairs. Reusing
  the light values there would put slot 7 at 1.92:1 and four of the eight outside the dark
  lightness band. And no colour is ever defined only inside the media block: every token
  has a value on the bare `:root`, which the dark branch redefines — a colour that exists
  in one branch only is a colour missing on the other surface.
- **One axis.** Never two y-scales on one plot.
- **Mixed scales are drawn normalized** (0–100%) and the caption says so. Otherwise a
  change from a 1–5 to a 1–10 scale reads as improvement.
- **A legend is always present for two or more series**, and at four or fewer the lines are
  also directly labelled: identity must never rest on colour alone.
- Recessive grid and axes; text wears text tokens, not the series colour. Both are read
  from the token layer at draw time — `public/compare-chart.js` and
  `public/metric-chart.js` resolve `--series-*`, `--text`, `--muted` and `--surface` off
  the root element — so no chart colour is hardcoded in JavaScript and one description
  draws both surfaces. The chart routes still send a slot index and never a colour.

## 9. The repository is public

`origin` is `github.com/ya-makariy/121`, commits are authored as `me@ya-makariy.com`. A
work address never lands here. Seeds, fixtures and tests contain invented placeholder
names only — never a real colleague's name. `data/` is in `.gitignore`.
