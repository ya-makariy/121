/**
 * Демо-данные для проверки графиков и сравнения. Запуск: bun scripts/demo-data.ts
 *
 * Имена выдуманные и намеренно безымянные: репозиторий может стать публичным,
 * реальных коллег в фикстурах быть не должно.
 *
 * Скрипт добавляет данные, а не чистит базу. Чтобы начать заново — удалите
 * data/121.sqlite (и файлы -wal/-shm).
 */
import { openDb } from "../src/db/index.ts";
import { migrate } from "../src/db/migrate.ts";
import { createPerson } from "../src/db/queries/people.ts";
import { createMeeting, completeMeeting } from "../src/db/queries/meetings.ts";
import { defaultTemplate, getFieldWithOptions, loadVersionStructure } from "../src/db/queries/templates.ts";
import { createAction } from "../src/db/queries/actions.ts";
import { saveAnswer } from "../src/domain/answers.ts";
import { nowIso } from "../src/lib/dates.ts";

const db = openDb();
migrate(db);

const template = defaultTemplate(db);
if (!template?.current_version_id) throw new Error("Нет шаблона по умолчанию — миграции не применялись?");
const versionId = template.current_version_id;
const structure = loadVersionStructure(db, versionId);
const fields = structure.flatMap((s) => s.fields);

const byKey = new Map(fields.map((f) => [f.field_key, f]));

const team = db
  .query<{ id: number }, [string, string]>(
    `INSERT INTO team (owner_id, name, description, created_at, updated_at)
     VALUES (1, 'Демо-команда', 'Выдуманные данные для проверки графиков', ?, ?)
     ON CONFLICT (owner_id, name) DO UPDATE SET updated_at = excluded.updated_at
     RETURNING id`,
  )
  .get(nowIso(), nowIso())!;

// Четыре траектории, каждая со своим смыслом на графике:
//   ровно хорошо / медленно проседает / выкарабкивается / перегружен
const CAST = [
  {
    name: "Первый Демо", role: "Старший инженер",
    dates: ["2026-05-12", "2026-06-09", "2026-07-07", "2026-08-11", "2026-09-01"],
    job: [4, 4, 5, 4, 5], workload: [3, 3, 2, 3, 3], growth: [4, 4, 5, 5, 5],
    energy: [4, 4, 5, 4, 5], risk: ["low", "low", "low", "low", "low"],
  },
  {
    name: "Вторая Демо", role: "Инженер",
    dates: ["2026-05-14", "2026-06-11", "2026-07-09", "2026-08-13", "2026-09-03"],
    job: [4, 4, 3, 3, 2], workload: [3, 4, 4, 4, 5], growth: [4, 3, 3, 2, 2],
    energy: [4, 3, 3, 2, 2], risk: ["low", "low", "medium", "medium", "high"],
  },
  {
    name: "Третий Демо", role: "Младший инженер",
    dates: ["2026-05-19", "2026-06-16", "2026-07-14", "2026-08-18", "2026-09-04"],
    job: [2, 2, 3, 4, 4], workload: [4, 4, 3, 3, 3], growth: [2, 3, 3, 4, 5],
    energy: [2, 3, 3, 4, 4], risk: ["medium", "medium", "low", "low", "low"],
  },
  {
    name: "Четвёртая Демо", role: "Тимлид направления",
    dates: ["2026-05-21", "2026-06-18", "2026-07-16", "2026-08-20", "2026-09-05"],
    job: [4, 3, 3, 3, 3], workload: [4, 5, 5, 5, 5], growth: [4, 4, 3, 3, 3],
    energy: [3, 3, 2, 2, 2], risk: ["low", "low", "medium", "medium", "medium"],
  },
] as const;

let created = 0;
for (const person of CAST) {
  const p = createPerson(db, {
    full_name: person.name,
    email: null,
    role_title: person.role,
    cadence_days: 14,
    cadence_anchor_on: null,
    default_template_id: template.id,
    notes: "Выдуманный человек для проверки графиков.",
  });

  db.query("INSERT INTO team_member (team_id, person_id, is_primary) VALUES (?, ?, 1)")
    .run(team.id, p.id);

  person.dates.forEach((heldOn, i) => {
    const meeting = createMeeting(
      db, { person_id: p.id, template_version_id: versionId, held_on: heldOn },
    );

    const scalars: [string, number][] = [
      ["job_satisfaction", person.job[i]!],
      ["workload", person.workload[i]!],
      ["growth_clarity", person.growth[i]!],
      ["energy", person.energy[i]!],
      ["team_direction_clarity", Math.min(5, person.growth[i]! + 1)],
      ["feedback_recognition", person.job[i]!],
      ["team_relationships", 4],
    ];
    for (const [key, value] of scalars) {
      const field = byKey.get(key);
      if (field) saveAnswer(db, meeting.id, getFieldWithOptions(db, field.id)!, { value: String(value) });
    }

    const risk = byKey.get("attrition_risk");
    if (risk) {
      saveAnswer(db, meeting.id, getFieldWithOptions(db, risk.id)!, {
        optionKeys: [person.risk[i]!],
      });
    }

    const summary = byKey.get("summary");
    if (summary) {
      saveAnswer(db, meeting.id, getFieldWithOptions(db, summary.id)!, {
        value: `Встреча ${i + 1}: обсудили текущие задачи и планы.`,
      });
    }

    completeMeeting(db, meeting.id);
    created++;
  });

  createAction(db, {
    person_id: p.id, created_meeting_id: null,
    title: `Договорённость для ${person.name}`, details: null,
    assignee: "person", visibility: "shared", due_on: "2026-09-25",
  });
}

console.log(`Добавлено: ${CAST.length} человек, ${created} завершённых встреч, команда «Демо-команда».`);
db.close();
