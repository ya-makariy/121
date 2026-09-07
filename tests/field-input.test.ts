import { describe, expect, test } from "bun:test";
import { EMPTY_ANSWER, fieldInput, fieldReadout } from "../src/views/components/field-input.ts";
import type { AnswerValue } from "../src/views/components/field-input.ts";
import type { FieldType, FieldWithOptions, Visibility } from "../src/db/types.ts";

/**
 * The markup contract of the one function that serves both modes.
 *
 * `field-input.ts` is a pure function, so asserting the emitted HTML is cheap — and it is
 * the only guard against the editable and the read-only mode drifting apart, which is the
 * property CLAUDE.md rule 6 asks for. It also pins the accessibility fix: a group of
 * radios or checkboxes is named by a `legend`, a single control by a bound `label for`.
 */

/** Field types whose control is a group, so the question wording must be a `legend`. */
const GROUPED: FieldType[] = ["scale", "single_select", "multi_select", "checkbox"];
/** Field types with exactly one control, so the wording must be a bound `label`. */
const SINGLE: FieldType[] = ["text", "short_text", "date"];
const ALL_TYPES: FieldType[] = [...GROUPED, ...SINGLE];

function makeField(
  type: FieldType,
  over: Partial<FieldWithOptions> = {},
): FieldWithOptions {
  const key = over.field_key ?? `q_${type}`;
  const base: FieldWithOptions = {
    id: 7,
    version_id: 1,
    section_id: 1,
    field_key: key,
    label: "How is the pace right now",
    help_text: null,
    type,
    visibility: "shared" as Visibility,
    is_required: 0,
    position: 10,
    metric_id: null,
    scale_min: 1,
    scale_max: 5,
    scale_step: 1,
    scale_min_label: "flat",
    scale_max_label: "full of it",
    config_json: null,
    options: type === "single_select" || type === "multi_select"
      ? [
          { id: 1, field_id: 7, option_key: "opt_a", label: "Waiting on review",
            score: 1, color: null, position: 1 },
          { id: 2, field_id: 7, option_key: "opt_b", label: "Unclear priority",
            score: 2, color: null, position: 2 },
        ]
      : [],
  };
  return { ...base, ...over };
}

/** Every `for` on the page must point at an `id` that is actually there. */
function danglingFor(markup: string): string[] {
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
  return [...markup.matchAll(/\bfor="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((target) => !ids.has(target));
}

function duplicateIds(markup: string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const m of markup.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1]!;
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  return dupes;
}

describe("fieldInput markup", () => {
  test("a group of controls is named by a legend, not by an unbound label", () => {
    for (const type of GROUPED) {
      const out = fieldInput(makeField(type), EMPTY_ANSWER, 3, "en").value;
      expect(out).toContain("<fieldset>");
      expect(out).toContain("</fieldset>");
      expect(out).toMatch(/<legend>[\s\S]*How is the pace right now[\s\S]*<\/legend>/);
      // The question wording never sits in a label that addresses nothing.
      expect(out).not.toMatch(/<label>\s*How is the pace/);
    }
  });

  test("a single control is named by a label bound to its own id", () => {
    for (const type of SINGLE) {
      const out = fieldInput(makeField(type), EMPTY_ANSWER, 3, "en").value;
      expect(out).not.toContain("<fieldset>");
      expect(out).toContain(`<label for="fc-q_${type}">`);
      expect(out).toContain(`id="fc-q_${type}"`);
      expect(danglingFor(out)).toEqual([]);
    }
  });

  test("no field type emits a for that points at no id", () => {
    for (const type of ALL_TYPES) {
      const out = fieldInput(makeField(type), EMPTY_ANSWER, 3, "en").value;
      expect(danglingFor(out)).toEqual([]);
    }
  });

  test("ids are derived from field_key, so many fields on one page stay unique", () => {
    // Same row id on purpose: the control id must come from the key, which is unique per
    // template version, not from anything that could repeat.
    const page = ALL_TYPES
      .map((type) => fieldInput(makeField(type), EMPTY_ANSWER, 3, "en").value)
      .join("\n");
    expect(duplicateIds(page.replace(/\bid="f7(-state)?"/g, ""))).toEqual([]);
  });

  /**
   * A radio group's scope is its form owner plus its name. These inputs have no form
   * owner, so a shared name made every scale on the meeting page one exclusive group:
   * answering one question unchecked all the others. The names must differ per field.
   */
  test("radio and option names are scoped per field, so groups do not merge", () => {
    for (const type of ["scale", "single_select"] as FieldType[]) {
      const a = fieldInput(makeField(type, { id: 11, field_key: "q_a" }), EMPTY_ANSWER, 3, "en").value;
      const b = fieldInput(makeField(type, { id: 12, field_key: "q_b" }), EMPTY_ANSWER, 3, "en").value;
      const nameOf = (out: string) => [...out.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
      const namesA = new Set(nameOf(a));
      const namesB = new Set(nameOf(b));
      // Each field posts under exactly one name, and never under the other field's name.
      expect(namesA.size).toBe(1);
      expect(namesB.size).toBe(1);
      for (const n of namesA) expect(namesB.has(n)).toBe(false);
    }
  });

  test("the fieldset stays inside div.field, so hx-include=closest .field is intact", () => {
    for (const type of ["single_select", "multi_select"] as FieldType[]) {
      const out = fieldInput(makeField(type), EMPTY_ANSWER, 3, "en").value;
      expect(out).toContain(`hx-include="closest .field"`);
      // The only `.field` ancestor is the wrapping div; the fieldset carries no such
      // class and opens after it.
      expect(out.indexOf(`class="field"`)).toBeLessThan(out.indexOf("<fieldset>"));
      expect(out).not.toMatch(/<fieldset[^>]*class="[^"]*\bfield\b/);
      // Every option input is inside that div, so the posted set is the whole group.
      expect([...out.matchAll(/name="option-7"/g)]).toHaveLength(2);
    }
  });

  test("the save indicator sits outside the fieldset, next to it inside the field", () => {
    const out = fieldInput(makeField("scale"), EMPTY_ANSWER, 3, "en").value;
    expect(out.indexOf("</fieldset>")).toBeLessThan(out.indexOf("saved-flag"));
  });

  test("help text and the private badge ride along with the wording in both forms", () => {
    const grouped = fieldInput(
      makeField("scale", { help_text: "Right now, not on average", visibility: "private" }),
      EMPTY_ANSWER, 3, "en",
    ).value;
    expect(grouped).toMatch(
      /<legend>[\s\S]*badge private[\s\S]*class="hint">Right now, not on average[\s\S]*<\/legend>/,
    );

    const single = fieldInput(
      makeField("text", { help_text: "Right now, not on average", visibility: "private" }),
      EMPTY_ANSWER, 3, "en",
    ).value;
    expect(single).toMatch(
      /<label for="fc-q_text">[\s\S]*badge private[\s\S]*class="hint">Right now, not on average[\s\S]*<\/label>/,
    );
  });
});

describe("the two modes do not drift", () => {
  const answers: Record<FieldType, AnswerValue & { optionLabels?: string | null }> = {
    scale: { ...EMPTY_ANSWER, num: 4 },
    text: { ...EMPTY_ANSWER, text: "Closed the billing migration" },
    short_text: { ...EMPTY_ANSWER, text: "Two weeks" },
    checkbox: { ...EMPTY_ANSWER, bool: 1 },
    date: { ...EMPTY_ANSWER, date: "2026-03-14" },
    single_select: { ...EMPTY_ANSWER, optionKeys: ["opt_a"], optionLabels: "Waiting on review" },
    multi_select: { ...EMPTY_ANSWER, optionKeys: ["opt_a"], optionLabels: "Waiting on review" },
  };

  test("both modes render the same question wording for every field type", () => {
    for (const type of ALL_TYPES) {
      const field = makeField(type);
      const editable = fieldInput(field, answers[type], 3, "en").value;
      const readonly = fieldReadout(field, answers[type], "en");
      expect(editable).toContain(field.label);
      expect(readonly).not.toBeNull();
      expect(readonly!.value).toContain(field.label);
    }
  });

  test("the read-only form carries no form control and no dangling for", () => {
    for (const type of ALL_TYPES) {
      const out = fieldReadout(makeField(type), answers[type], "en")!.value;
      expect(out).not.toMatch(/<input|<textarea|<select|<fieldset/);
      expect(danglingFor(out)).toEqual([]);
    }
  });
});
