# design/ — visual specification

*Читать по-русски: [README.ru.md](README.ru.md)*

This is what the redesign canvas is built from. The `D*` design tasks that referred to it
have all been implemented (see the status section in [PLAN.md](../PLAN.md)); the artboards
remain the visual reference for the current `public/app.css`.

**Canvas:** <https://claude.ai/code/artifact/6d4087f0-7e2b-4560-b808-be70d4921476>

16 artboards on one canvas: the meeting flow, people, analytics, templates and a token
sheet. Above each row there is a note on what changed and why. The artboards are drawn not
from screenshots but from the real `public/app.css` and the real page markup captured from a
running server, so what looks right on an artboard will look right in the app.

## What is where

| File | What it is |
| --- | --- |
| `refine.css` | **A proposal.** A layer of additions to `public/app.css`: tokens, components, fixes. Task `D1` moved its tokens into `public/app.css`; what is left here is the proposal as drawn. |
| `artboards/*.html` | `<body>` fragments, one per screen. Markup only; styles come from `app.css` + `refine.css`. |
| `canvas.json` | Canvas layout: positions, captions, notes. |
| `build.mjs` | Assembles the artboards into `out/*.dc.html`, inlining the styles. |
| `out/` | Derived output, in `.gitignore`. |

## Rebuilding

```sh
node design/build.mjs
```

It reads `public/app.css` **from the repository**, so style changes show up on the
artboards immediately: edit `app.css`, rebuild, open `out/<Name>.dc.html` in a browser. It is
an ordinary HTML page.

The canvas itself (the published page) cannot be updated from here: that takes an agent
with the `/design` skill, which seeds `out/*.dc.html` together with `canvas.json` and
publishes to the same link.

## Artboard → page → code

| Artboard | Page | View | Route |
| --- | --- | --- | --- |
| `Main` | Dashboard | `views/pages/dashboard.ts` | `GET /` |
| `People` | People | `views/pages/people.ts` → `peopleListPage` | `GET /people` |
| `Person` | Person card | `views/pages/person.ts` | `GET /people/:id` |
| `PersonNew` | New person | `views/pages/people.ts` → `personFormPage` | `GET /people/new` |
| `PersonEdit` | Edit person | `views/pages/people.ts` → `personFormPage` | `GET /people/:id/edit` |
| `Meeting` | Meeting, in progress | `views/pages/meeting.ts` | `GET /meetings/:id` (draft) |
| `MeetingDone` | Meeting, completed | `views/pages/meeting.ts` | `GET /meetings/:id` (`completed`) |
| `Share` | Summary for the report | `views/pages/share.ts` | `GET /s/:token` |
| `Compare` | Comparison | `views/pages/compare.ts` | `GET /compare` |
| `Actions` | Action items | `views/pages/misc.ts` → `actionsPage` | `GET /actions` |
| `Templates` | Templates | `views/pages/misc.ts` → `templatesPage` | `GET /templates` |
| `TemplateEditor` | Template builder | `views/pages/template-editor.ts` | `GET /templates/:id` |
| `TemplateVersions` | Template versions | `views/pages/template-versions.ts` | `GET /templates/:id/versions` |
| `Metrics` | Metrics | `views/pages/metrics.ts` | `GET /metrics` |
| `Settings` | Settings | `views/pages/misc.ts` → `settingsPage` | `GET /settings` |
| `Foundation` | Token sheet | — | — |

`Foundation` does not correspond to an app page: it is a reference of tokens, typography,
badges, controls and the series palette. The separate `Meeting` and `MeetingDone` artboards
are two modes of one view, editable and read-only, which `views/components/field-input.ts`
renders with a single function (rule 6).

## Artboard content

`design/` is outside the scope of `tests/language.test.ts`, which scans `src/`, `scripts/`
and `tests/`. Cyrillic in the artboards is mock user text, not code, so it belongs there;
comments in `refine.css` and `build.mjs` are English anyway, as everywhere (rule 1).

All names, roles, addresses and links are invented placeholders (`example.com`), rule 9. Not
a single line is taken from the local database. The numbers inside the artboards agree with
each other: the field counters on `Templates`, `TemplateVersions` and in the `Meeting` rail
match, version v2 is a draft with no meetings (rule 5), and the points on the `Compare` chart
are exactly the 1–5 → 0–100% normalization that `Person` draws.
