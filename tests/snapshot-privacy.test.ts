import { describe, expect, test } from "bun:test";
import { testDb, makePerson, makeMeeting, completeMeeting, defaultVersionId, addField } from "./helpers.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { getFieldWithOptions, loadVersionStructure } from "../src/db/queries/templates.ts";
import { buildSharedSnapshot, hashPayload } from "../src/domain/snapshot.ts";
import { renderMarkdown } from "../src/domain/markdown.ts";
import { publicSharePage } from "../src/views/pages/share.ts";
import { createAction } from "../src/db/queries/actions.ts";
import { personTimeline } from "../src/db/queries/metrics.ts";
import { getMetricByKey } from "../src/db/queries/metrics.ts";
import { nowIso } from "../src/lib/dates.ts";

/**
 * ЭТОТ ТЕСТ НЕ УДАЛЯЕТСЯ И НЕ ОСЛАБЛЯЕТСЯ. См. CLAUDE.md §1.
 *
 * Утечка приватного — единственная поломка, которая портит отношения с человеком,
 * а не данные. Тест заполняет приватным сентинелом каждый тип поля и ищет его во всех
 * поверхностях, куда снапшот может просочиться.
 */
const SENTINEL = "SENTINEL_PRIVATE_ДОЛЖНО_ОСТАТЬСЯ_ВНУТРИ";

describe("приватность снапшота", () => {
  test("сентинел не попадает ни в одну поверхность шаринга", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);

    // Приватное поле каждого типа, какой можно заполнить сентинелом или отличимым значением.
    const privateFields = [
      addField(db, versionId, { fieldKey: "p_text", label: `${SENTINEL} метка`, type: "text", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_short", label: "приватная строка", type: "short_text", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_scale", label: "приватная шкала", type: "scale", visibility: "private", scaleMin: 1, scaleMax: 5 }),
      addField(db, versionId, { fieldKey: "p_check", label: "приватный чекбокс", type: "checkbox", visibility: "private" }),
      addField(db, versionId, { fieldKey: "p_date", label: "приватная дата", type: "date", visibility: "private" }),
    ];
    const sharedField = addField(db, versionId, {
      fieldKey: "s_text", label: "видно подопечному", type: "text", visibility: "shared",
    });

    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    for (const id of privateFields) {
      const field = getFieldWithOptions(db, id)!;
      const raw =
        field.type === "scale" ? { value: "3" }
        : field.type === "checkbox" ? { value: "on" }
        : field.type === "date" ? { value: "2026-09-09" }
        : { value: `${SENTINEL} содержимое` };
      saveAnswer(db, meetingId, field, raw);
    }
    saveAnswer(db, meetingId, getFieldWithOptions(db, sharedField)!, {
      value: "это можно показывать",
    });

    // Приватное поле из сида — single_select с метрикой.
    const seedPrivate = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'attrition_risk'",
      )
      .get(versionId)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, seedPrivate.id)!, { optionKeys: ["high"] });

    // Приватные заметки о встрече и приватная договорённость.
    db.query("UPDATE meeting SET private_notes = ? WHERE id = ?")
      .run(`${SENTINEL} заметка о встрече`, meetingId);
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId,
      title: `${SENTINEL} приватная договорённость`, details: null,
      assignee: "manager", visibility: "private", due_on: null,
    });
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId,
      title: "открытая договорённость", details: null,
      assignee: "person", visibility: "shared", due_on: "2026-09-20",
    });

    completeMeeting(db, meetingId);

    const payload = buildSharedSnapshot(db, meetingId, "ru");

    // 1. JSON снапшота — то, что уходит в БД и потом рендерится подопечному.
    const json = JSON.stringify(payload);
    expect(json).not.toContain(SENTINEL);

    // 2. Markdown — основной способ поделиться в v1.
    const md = renderMarkdown(payload);
    expect(md).not.toContain(SENTINEL);

    // 3. Публичная HTML-страница.
    const publicHtml = publicSharePage(payload);
    expect(publicHtml).not.toContain(SENTINEL);

    // 4. Хеш считается от того же payload — не должен зависеть от приватного.
    expect(hashPayload(payload)).toHaveLength(64);

    // Позитивная проверка: shared-содержимое на месте, иначе тест проходил бы впустую.
    expect(md).toContain("это можно показывать");
    expect(md).toContain("открытая договорённость");
    expect(publicHtml).toContain("это можно показывать");
  });

  test("приватная договорённость не попадает в снапшот, открытая попадает", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    createAction(db, {
      person_id: personId, created_meeting_id: meetingId, title: "приватное дело",
      details: null, assignee: "manager", visibility: "private", due_on: null,
    });
    createAction(db, {
      person_id: personId, created_meeting_id: meetingId, title: "общее дело",
      details: null, assignee: "person", visibility: "shared", due_on: null,
    });
    completeMeeting(db, meetingId);

    const titles = buildSharedSnapshot(db, meetingId, "ru").actions.map((a) => a.title);
    expect(titles).toContain("общее дело");
    expect(titles).not.toContain("приватное дело");
  });

  test("приватная метрика считается в графиках, но не уходит подопечному", () => {
    // Риск ухода — приватное поле, привязанное к метрике: руководителю нужна его
    // динамика, подопечному она не видна никогда.
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    const field = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM template_field WHERE version_id = ? AND field_key = 'attrition_risk'",
      )
      .get(versionId)!;
    saveAnswer(db, meetingId, getFieldWithOptions(db, field.id)!, { optionKeys: ["medium"] });
    completeMeeting(db, meetingId);

    const metric = getMetricByKey(db, "attrition_risk")!;
    const points = personTimeline(db, personId, metric.id);
    expect(points).toHaveLength(1);
    expect(points[0]!.norm_value).toBe(0.5);

    const payload = buildSharedSnapshot(db, meetingId, "ru");
    const labels = payload.sections.flatMap((s) => s.items.map((i) => i.fieldKey));
    expect(labels).not.toContain("attrition_risk");
  });

  test("представление v_shared_answer не отдаёт приватные поля", () => {
    const db = testDb();
    const versionId = defaultVersionId(db);
    const personId = makePerson(db);
    const meetingId = makeMeeting(db, personId, versionId, "2026-09-07");

    const priv = addField(db, versionId, {
      fieldKey: "leak_check", label: "приватное", type: "text", visibility: "private",
    });
    saveAnswer(db, meetingId, getFieldWithOptions(db, priv)!, { value: SENTINEL });

    const rows = db
      .query<{ text_value: string | null }, [number]>(
        "SELECT text_value FROM v_shared_answer WHERE meeting_id = ?",
      )
      .all(meetingId);
    expect(rows.every((r) => r.text_value !== SENTINEL)).toBe(true);
  });

  test("дефолт видимости в БД — private (fail closed)", () => {
    // Баг, забывший передать видимость, должен скрыть, а не раскрыть.
    const db = testDb();
    const versionId = defaultVersionId(db);
    const section = db
      .query<{ id: number }, [number]>("SELECT id FROM template_section WHERE version_id = ? LIMIT 1")
      .get(versionId)!;

    const row = db
      .query<{ visibility: string }, any[]>(
        `INSERT INTO template_field (version_id, section_id, field_key, label, type, position)
         VALUES (?, ?, 'no_visibility_given', 'без указания видимости', 'text', 90)
         RETURNING visibility`,
      )
      .get(versionId, section.id)!;
    expect(row.visibility).toBe("private");
  });

  test("структура секций грузится в порядке отображения", () => {
    const db = testDb();
    const sections = loadVersionStructure(db, defaultVersionId(db));
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.map((s) => s.position)).toEqual([...sections.map((s) => s.position)].sort((a, b) => a - b));
    expect(nowIso()).toContain("T");
  });
});
