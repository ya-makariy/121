import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index.ts";
import { getTemplate, loadVersionStructure } from "../db/queries/templates.ts";
import { listMetrics } from "../db/queries/metrics.ts";
import { templatesPage, type TemplateSummary } from "../views/pages/misc.ts";
import { templateEditorPage } from "../views/pages/template-editor.ts";
import { templateVersionsPage, type VersionRow } from "../views/pages/template-versions.ts";
import { loc } from "../middleware/locale.ts";
import { dict, errorMessage } from "../i18n/index.ts";
import { OWNER_ID } from "../middleware/current-user.ts";
import {
  answerCountForFieldKey, createTemplate, currentVersion, diffVersions, duplicateTemplate,
  listVersions, meetingCountForVersion, TemplateEditError,
} from "../domain/template-version.ts";
import {
  addField, addOption, addSection, deleteField, deleteOption, deleteSection, isFieldType,
  moveField, moveSection, reorderFields, reorderSections, updateField, updateOption,
  updateSection, validateTemplate, type FieldInput,
} from "../domain/template-editor.ts";
import { nowIso } from "../lib/dates.ts";
import type { FieldType, Visibility } from "../db/types.ts";

export const templateRoutes = new Hono();

// ─────────────────────────────────────────────────────────── form parsing

function str(form: Record<string, unknown>, key: string): string | null {
  const v = form[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(form: Record<string, unknown>, key: string): number | null {
  const v = str(form, key);
  if (v === null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function flag(form: Record<string, unknown>, key: string): boolean {
  return form[key] !== undefined;
}

function parseFieldInput(form: Record<string, unknown>): FieldInput {
  const rawType = str(form, "type") ?? "text";
  const type: FieldType = isFieldType(rawType) ? rawType : "text";
  const visibility: Visibility = str(form, "visibility") === "shared" ? "shared" : "private";
  return {
    label: str(form, "label") ?? "",
    helpText: str(form, "help_text"),
    type,
    visibility,
    isRequired: flag(form, "is_required"),
    metricId: num(form, "metric_id"),
    scaleMin: num(form, "scale_min"),
    scaleMax: num(form, "scale_max"),
    scaleMinLabel: str(form, "scale_min_label"),
    scaleMaxLabel: str(form, "scale_max_label"),
  };
}

// ─────────────────────────────────────────────────────────── rendering the editor

function renderEditor(c: Context, templateId: number, opts: { error?: string; forked?: boolean } = {}) {
  const template = getTemplate(db(), templateId);
  if (!template || template.current_version_id === null) return c.notFound();

  const version = currentVersion(db(), templateId);
  const sections = loadVersionStructure(db(), version.id);

  const answerCounts = new Map<string, number>();
  for (const section of sections) {
    for (const field of section.fields) {
      answerCounts.set(field.field_key, answerCountForFieldKey(db(), templateId, field.field_key));
    }
  }

  return c.html(
    templateEditorPage({
      locale: loc(c),
      template,
      version,
      sections,
      metrics: listMetrics(db(), OWNER_ID),
      problems: validateTemplate(db(), version.id),
      answerCounts,
      meetingsOnVersion: meetingCountForVersion(db(), version.id),
      editField: c.req.query("edit") ?? null,
      editSection: c.req.query("edit_section") ?? null,
      addFieldTo: c.req.query("add_field") ?? null,
      forked: opts.forked ?? c.req.query("forked") !== undefined,
      error: opts.error ?? null,
    }),
  );
}

/**
 * Mutation wrapper. It does two things that would otherwise be repeated in every route:
 * catches editor errors and shows them on the page instead of as a 500, and notices that
 * an edit landed in a fork so it can say so out loud — otherwise a new version appearing
 * looks like unexplained behaviour.
 */
function mutate(
  c: Context, templateId: number, run: () => void, redirectTo?: () => string,
): Response {
  const before = getTemplate(db(), templateId)?.current_version_id ?? null;
  try {
    run();
  } catch (err) {
    if (err instanceof TemplateEditError) {
      return renderEditor(c, templateId, { error: errorMessage(loc(c), err) }) as Response;
    }
    throw err;
  }
  const after = getTemplate(db(), templateId)?.current_version_id ?? null;
  const forked = before !== null && after !== null && before !== after;
  // The target is computed after the operation: it can depend on what got created.
  const target = redirectTo ? redirectTo() : `/templates/${templateId}`;
  return c.redirect(forked ? `${target}${target.includes("?") ? "&" : "?"}forked=1` : target, 303);
}

// ─────────────────────────────────────────────────────────── list and creation

templateRoutes.get("/templates", (c) => {
  const templates = db()
    .query<TemplateSummary, [number]>(
      `SELECT t.*, tv.version_no, tv.frozen_at,
              (SELECT COUNT(*) FROM template_section s WHERE s.version_id = tv.id) AS section_count,
              (SELECT COUNT(*) FROM template_field f WHERE f.version_id = tv.id) AS field_count
       FROM template t
       LEFT JOIN template_version tv ON tv.id = t.current_version_id
       WHERE t.owner_id = ? AND t.archived_at IS NULL
       ORDER BY t.is_default DESC, t.name`,
    )
    .all(OWNER_ID);

  return c.html(
    templatesPage({ locale: loc(c), templates, metrics: listMetrics(db(), OWNER_ID) }),
  );
});

templateRoutes.post("/templates", async (c) => {
  const form = await c.req.parseBody();
  const name = str(form, "name") ?? dict(loc(c)).editor.newTemplate;
  const template = createTemplate(db(), name, OWNER_ID);
  return c.redirect(`/templates/${template.id}`, 303);
});

templateRoutes.get("/templates/:id", (c) =>
  renderEditor(c, Number.parseInt(c.req.param("id"), 10)));

templateRoutes.post("/templates/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  const name = str(form, "name");
  if (name === null) return c.redirect(`/templates/${id}`, 303);
  // A template's name and description live outside the version: they are not meeting content.
  db().query("UPDATE template SET name = ?, description = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(name, str(form, "description"), nowIso(), id, OWNER_ID);
  return c.redirect(`/templates/${id}`, 303);
});

templateRoutes.post("/templates/:id/duplicate", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const source = getTemplate(db(), id);
  if (!source) return c.notFound();
  const copy = duplicateTemplate(db(), id, `${source.name} — ${dict(loc(c)).editor.copySuffix}`, OWNER_ID);
  return c.redirect(`/templates/${copy.id}`, 303);
});

templateRoutes.post("/templates/:id/default", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  db().query("UPDATE template SET is_default = 0 WHERE owner_id = ?").run(OWNER_ID);
  db().query("UPDATE template SET is_default = 1, updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(nowIso(), id, OWNER_ID);
  return c.redirect(`/templates/${id}`, 303);
});

templateRoutes.post("/templates/:id/archive", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const now = nowIso();
  // Archive, not delete: completed meetings stand behind this template.
  db().query("UPDATE template SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND is_default = 0")
    .run(now, now, id, OWNER_ID);
  return c.redirect("/templates", 303);
});

// ─────────────────────────────────────────────────────────── sections

templateRoutes.post("/templates/:id/sections", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  return mutate(c, id, () => addSection(db(), id, str(form, "title") ?? "", str(form, "description")));
});

templateRoutes.post("/templates/:id/sections/:key", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  const form = await c.req.parseBody();
  return mutate(c, id, () =>
    updateSection(db(), id, key, {
      title: str(form, "title") ?? "",
      description: str(form, "description"),
    }));
});

templateRoutes.post("/templates/:id/sections/:key/delete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  return mutate(c, id, () => deleteSection(db(), id, c.req.param("key")));
});

templateRoutes.post("/templates/:id/sections/:key/move", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  const direction = str(form, "direction") === "up" ? "up" : "down";
  return mutate(c, id, () => moveSection(db(), id, c.req.param("key"), direction));
});

templateRoutes.post("/templates/:id/sections/:key/fields", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  const form = await c.req.parseBody();
  const input = parseFieldInput(form);
  const needsOptions = input.type === "single_select" || input.type === "multi_select";
  let created = "";
  return mutate(
    c, id,
    () => {
      // Placeholder option labels come from the dictionary: the domain holds no user text.
      created = addField(db(), id, key, input, dict(loc(c)).editor.optionPlaceholders).fieldKey;
    },
    // A select field opens straight into editing: its options still need filling in.
    () => (needsOptions ? `/templates/${id}?edit=${encodeURIComponent(created)}` : `/templates/${id}`),
  );
});

// ─────────────────────────────────────────────────────────── fields

templateRoutes.post("/templates/:id/fields/:key", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  const form = await c.req.parseBody();
  const input = parseFieldInput(form);
  const newQuestion = flag(form, "new_question");
  return mutate(c, id, () =>
    updateField(db(), id, key, input, {
      newQuestion,
      optionLabels: dict(loc(c)).editor.optionPlaceholders,
    }));
});

templateRoutes.post("/templates/:id/fields/:key/delete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  return mutate(c, id, () => deleteField(db(), id, c.req.param("key")));
});

templateRoutes.post("/templates/:id/fields/:key/move", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const form = await c.req.parseBody();
  const direction = str(form, "direction") === "up" ? "up" : "down";
  return mutate(c, id, () => moveField(db(), id, c.req.param("key"), direction));
});

// ─────────────────────────────────────────────────────────── options

templateRoutes.post("/templates/:id/fields/:key/options", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  const form = await c.req.parseBody();
  return mutate(
    c, id,
    () => addOption(db(), id, key, {
      label: str(form, "label") ?? "",
      score: num(form, "score"),
      color: str(form, "color"),
    }),
    () => `/templates/${id}?edit=${encodeURIComponent(key)}`,
  );
});

templateRoutes.post("/templates/:id/fields/:key/options/:optionKey", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  const form = await c.req.parseBody();
  return mutate(
    c, id,
    () => updateOption(db(), id, key, c.req.param("optionKey"), {
      label: str(form, "label") ?? "",
      score: num(form, "score"),
      color: str(form, "color"),
    }),
    () => `/templates/${id}?edit=${encodeURIComponent(key)}`,
  );
});

templateRoutes.post("/templates/:id/fields/:key/options/:optionKey/delete", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const key = c.req.param("key");
  return mutate(
    c, id,
    () => deleteOption(db(), id, key, c.req.param("optionKey")),
    () => `/templates/${id}?edit=${encodeURIComponent(key)}`,
  );
});

// ─────────────────────────────────────────────────────────── drag reordering

templateRoutes.post("/templates/:id/reorder-sections", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const body = await c.req.json<{ keys?: string[] }>().catch(() => ({ keys: [] }));
  try {
    reorderSections(db(), id, body.keys ?? []);
  } catch (err) {
    if (err instanceof TemplateEditError) {
      return c.json({ ok: false, error: errorMessage(loc(c), err) }, 422);
    }
    throw err;
  }
  return c.json({ ok: true });
});

templateRoutes.post("/templates/:id/reorder-fields", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const body = await c.req
    .json<{ section?: string; keys?: string[] }>()
    .catch(() => ({ section: undefined, keys: [] }));
  if (body.section === undefined) return c.json({ ok: false }, 400);
  try {
    reorderFields(db(), id, body.section, body.keys ?? []);
  } catch (err) {
    if (err instanceof TemplateEditError) {
      return c.json({ ok: false, error: errorMessage(loc(c), err) }, 422);
    }
    throw err;
  }
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────── versions

templateRoutes.get("/templates/:id/versions", (c) => {
  const id = Number.parseInt(c.req.param("id"), 10);
  const template = getTemplate(db(), id);
  if (!template) return c.notFound();

  const versions: VersionRow[] = listVersions(db(), id).map((v) => ({
    ...v,
    meetings: meetingCountForVersion(db(), v.id),
    fields: db()
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM template_field WHERE version_id = ?")
      .get(v.id)!.n,
    is_current: v.id === template.current_version_id,
  }));

  const diffParam = c.req.query("diff");
  let diff = null;
  if (diffParam !== undefined) {
    const toId = Number.parseInt(diffParam, 10);
    const target = versions.find((v) => v.id === toId);
    if (target?.parent_version_id != null) {
      diff = diffVersions(db(), target.parent_version_id, toId);
    }
  }

  return c.html(templateVersionsPage({ locale: loc(c), template, versions, diff }));
});
