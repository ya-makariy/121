# 121 — self-hosted инструмент для 1:1 встреч

## Состояние

| Этап | Состояние |
| --- | --- |
| 0. Каркас, вендоринг, PLAN/CLAUDE | готово |
| 1. Схема и раннер миграций | готово |
| 2. Сид: метрики и стартовый шаблон | готово |
| 3. Сквозной срез до реальной 1:1 | готово |
| 3a. Сравнение людей и «кому уделить внимание» | готово |
| 4. Конструктор шаблонов и метрик | готово |
| 5. Команды в UI, каденс, договорённости | каденс и договорённости готовы; команд в UI нет |
| 7. Английский код, кириллица только в локализации | готово |
| 6. Экспорт, бэкап, переключатель языка | готово |

Проверено: 72 теста, `tsc --noEmit` чистый, сквозной сценарий пройден вживую
(человек → встреча → заполнение → завершение → график → снапшот → Markdown),
приватный сентинел не найден ни в одной поверхности шаринга, правка замороженной
версии шаблона форкает её и не меняет прошлые встречи.

Осталось до полного скоупа v1: управление командами в интерфейсе — сейчас команда
создаётся только скриптом демо-данных, хотя схема, фильтр по команде и агрегаты готовы.

## Context

Регулярных 1:1 как процесса сейчас нет — он строится с нуля, и этот инструмент его
задаёт. Вдохновение — то, как 1:1 ведут в CODA, но это не миграция: переносить нечего,
импорт не нужен, история начинается с первой встречи в приложении.

Из этого следуют два практических требования:

- **Стартовый шаблон — это и есть определение процесса**, а не копия чего-то
  существующего. Он должен быть осмысленным сразу, из коробки, чтобы первую 1:1 можно
  было провести, ничего не настраивая.
- **Инструмент обязан быть полезен на первой встрече**, когда графиков ещё нет. Значит
  ценность даёт не только динамика: заполняемый по шаблону план встречи, договорённости и
  их перенос, готовое к отправке саммари. Графики — накопительная награда, а не условие
  пользы. Пустые состояния («точек пока нет, будет видно после 2-3 встреч») проектируются
  наравне с заполненными.

Что нужно: держать людей и команды, вести 1:1 по кастомному плану встречи, показывать
динамику метрик человека и команды во времени и отдавать подопечному результат встречи —
без приватной части. Данные чувствительные (удовлетворённость, риск ухода, приватные
заметки руководителя), поэтому self-hosted, а не чужой SaaS.

Репозиторий `/Users/m.balashov/github/121` пустой, всё пишется с нуля.

**v1 — локальная установка без авторизации.** Приложение слушает `127.0.0.1`, любой
пришедший считается хозяином. Авторизация, облачный хостинг и доступ с разных устройств —
этап v2 (раздел «v2»); модель данных проектируется так, чтобы v2 был аддитивным.

Следствие v1, которое надо принять осознанно: пока приложение на localhost, подопечный
физически не откроет share-ссылку. Поэтому «поделиться» в v1 = собрать неизменяемый
снапшот встречи из `shared`-полей и отдать его Markdown-файлом (скопировать в мессенджер).
Токенизированный роут `/s/:token` при этом пишется сразу и начинает работать в v2 сам,
без переделки данных.

Первым артефактом работы этот план кладётся в репозиторий как `PLAN.md`.

## Решения, принятые в обсуждении

| Вопрос | Решение |
| --- | --- |
| Доступ подопечного | Только share-ссылка на read-only снапшот, без логина подопечного |
| Мультитенант | Один менеджер на инстанс |
| Стек | Bun 1.3 + Hono + SSR HTML + HTMX, `bun:sqlite`, Chart.js — без сборки |
| Скоуп v1 | Кастомные шаблоны, action items с переносом, каденс в UI, экспорт/бэкап |
| Видимость | Пофлаговая: у каждого поля шаблона `shared`/`private` |
| Напоминания | Только в интерфейсе (дашборд overdue/due-soon), без крона и пушей |
| Авторизация | v1 — нет, только localhost; v2 — пароль + сессии + облако |
| Язык | ru/en с переключателем |
| Порядок работ | Сквозной тонкий срез, редактор шаблонов — вторым этапом |

Правки к формулировке стека, принятые по ходу проектирования:

- **Chart.js и HTMX вендорятся в `public/vendor/`, не с CDN.** Локальный инструмент,
  который ломается в самолёте или за корпоративным прокси, не является self-hosted.
  ~250 КБ в репозитории, шага сборки по-прежнему нет.
- **Переводится только «хром» интерфейса.** Пользовательский контент (названия шаблонов,
  формулировки полей, подписи метрик) хранится в одной колонке `label` на одном языке:
  заставлять себя писать каждый вопрос дважды — налог без выгоды для инструмента одного
  человека. Если понадобится двуязычная подпись оси — это одна аддитивная колонка.

## Ключевая идея модели: метрики отдельно от полей шаблона

Единственное решение, от которого зависит, будет ли инструмент полезен через год.

Если строить графики «по полю шаблона», любая правка плана встречи — переименовал вопрос,
поменял шкалу с 1-5 на 1-10, сделал отдельный шаблон для синьоров — обрывает график.
Поэтому вводится первоклассная **метрика**: стабильный неизменяемый ключ
(`job_satisfaction`, `growth_clarity`, …) со своей шкалой и направлением «больше =
лучше/хуже». Поле шаблона *привязывается* к метрике; поле без привязки — просто заметка.

Отсюда: разные шаблоны и разные версии одного шаблона кормят один график; формулировку
вопроса можно переписать, не потеряв историю; агрегат по команде считается по метрике.

Второе решение того же уровня: **шаблоны версионируются копированием, заполненная встреча
ссылается на конкретную версию.** Версия изменяется на месте, пока `frozen_at IS NULL`;
первая привязка встречи её замораживает, дальнейшая правка форкает версию с копированием
секций/полей/опций и сохранением стабильных ключей. Прошлые встречи не
переинтерпретируются никогда — это структурное свойство, а не дисциплина.

Два уровня идентичности, намеренно разные:
`field_key` — «тот же вопрос внутри линии этого шаблона»; `metric_id` — «то же измерение
где угодно». В редакторе нужен явный переключатель **«это другой вопрос (начать новую
серию)»**, который выдаёт новый `field_key`: схема не может отличить исправление опечатки
от смены смысла вопроса, поэтому спрашивает.

Сравнимость шкал — нормализацией на чтении из *замороженного* поля:
`norm = (num_value - scale_min) / (scale_max - scale_min)` → всегда 0..1. Не кешируется
колонкой: данные неизменяемы, кеш дал бы только рассинхрон.

## Схема данных

Одна миграция `src/db/migrations/0001_init.sql`. Значения полей — **нормализованными
типизированными колонками, никогда JSON.** JSON разрешён ровно в четырёх местах:
`share_link.snapshot_json` (по определению неизменяемый документ),
`template_field.config_json` (UI-крутилки без семантики запросов), `app_setting.value`,
вывод экспорта. Всё, что когда-либо будет фильтроваться, джойниться, агрегироваться или
участвовать в FK, получает колонку. Это записывается в `CLAUDE.md` проекта, потому что
под давлением дедлайна `meeting.answers_json` всегда выглядит как экономия дня.

Время: TEXT ISO-8601 UTC для моментов, TEXT `YYYY-MM-DD` для дат. Не epoch — бэкап
должен читаться человеком. `held_on` (дата) — единственная ось X всех графиков и единственное,
с чем сравнивает арифметика каденса.

```sql
-- Прагмы живут в db/index.ts, не здесь.

------------------------------------------------------------------ identity (v2-ready)
CREATE TABLE app_user (
  id            INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT,                        -- v2; NULL в v1
  role          TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('manager','admin')),
  locale        TEXT NOT NULL DEFAULT 'ru'  CHECK (locale IN ('ru','en')),
  timezone      TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at    TEXT NOT NULL,
  archived_at   TEXT
);
INSERT INTO app_user (id, display_name, created_at)
VALUES (1, 'Local manager', strftime('%Y-%m-%dT%H:%M:%SZ','now'));

CREATE TABLE app_setting (
  owner_id INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  key      TEXT NOT NULL,
  value    TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
);

------------------------------------------------------------------ метрики
CREATE TABLE metric (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  key         TEXT NOT NULL,                 -- НЕИЗМЕНЯЕМ после первой привязки
  label       TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'scalar' CHECK (kind IN ('scalar','categorical')),
  direction   INTEGER NOT NULL DEFAULT 1     CHECK (direction IN (1,-1)),
  target_min  REAL,
  target_max  REAL,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (owner_id, key)
);

------------------------------------------------------------------ шаблоны
CREATE TABLE template (
  id                 INTEGER PRIMARY KEY,
  owner_id           INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  name               TEXT NOT NULL,
  description        TEXT,
  current_version_id INTEGER REFERENCES template_version(id) DEFERRABLE INITIALLY DEFERRED,
  is_default         INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  archived_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE template_version (
  id                INTEGER PRIMARY KEY,
  template_id       INTEGER NOT NULL REFERENCES template(id) ON DELETE CASCADE,
  version_no        INTEGER NOT NULL,
  parent_version_id INTEGER REFERENCES template_version(id),
  frozen_at         TEXT,                    -- NULL => черновик, правится на месте
  change_note       TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (template_id, version_no)
);
CREATE INDEX idx_tv_template ON template_version(template_id, version_no DESC);

CREATE TABLE template_section (
  id          INTEGER PRIMARY KEY,
  version_id  INTEGER NOT NULL REFERENCES template_version(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,                 -- стабилен при форке
  title       TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL,
  UNIQUE (version_id, section_key)
);
CREATE INDEX idx_section_order ON template_section(version_id, position);
-- UNIQUE(version_id, position) намеренно нет: сломает drag-reorder, пользы ноль.

CREATE TABLE template_field (
  id              INTEGER PRIMARY KEY,
  version_id      INTEGER NOT NULL REFERENCES template_version(id) ON DELETE CASCADE,
  section_id      INTEGER NOT NULL REFERENCES template_section(id) ON DELETE CASCADE,
  field_key       TEXT NOT NULL,             -- ULID, стабилен при форке
  label           TEXT NOT NULL,
  help_text       TEXT,
  type            TEXT NOT NULL CHECK (type IN
                    ('scale','text','short_text','checkbox','single_select','multi_select','date')),
  visibility      TEXT NOT NULL DEFAULT 'private'    -- FAIL CLOSED, см. инвариант
                    CHECK (visibility IN ('shared','private')),
  is_required     INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  position        INTEGER NOT NULL,
  metric_id       INTEGER REFERENCES metric(id),
  scale_min       INTEGER,
  scale_max       INTEGER,
  scale_step      INTEGER NOT NULL DEFAULT 1,
  scale_min_label TEXT,
  scale_max_label TEXT,
  config_json     TEXT,
  UNIQUE (version_id, field_key),
  CHECK (type <> 'scale' OR (scale_min IS NOT NULL AND scale_max IS NOT NULL
                             AND scale_max > scale_min)),
  CHECK (metric_id IS NULL OR type IN ('scale','single_select','multi_select','checkbox'))
);
CREATE INDEX idx_field_order  ON template_field(version_id, section_id, position);
CREATE INDEX idx_field_metric ON template_field(metric_id) WHERE metric_id IS NOT NULL;
CREATE INDEX idx_field_key    ON template_field(field_key);

CREATE TABLE template_field_option (
  id         INTEGER PRIMARY KEY,
  field_id   INTEGER NOT NULL REFERENCES template_field(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,                  -- стабилен при форке
  label      TEXT NOT NULL,
  score      REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  color      TEXT,
  position   INTEGER NOT NULL,
  UNIQUE (field_id, option_key)
);
CREATE INDEX idx_option_order ON template_field_option(field_id, position);

------------------------------------------------------------------ люди и команды
CREATE TABLE person (
  id                  INTEGER PRIMARY KEY,
  owner_id            INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  full_name           TEXT NOT NULL,
  email               TEXT,
  role_title          TEXT,
  timezone            TEXT,
  started_on          TEXT,
  cadence_days        INTEGER CHECK (cadence_days IS NULL OR cadence_days > 0),
  cadence_anchor_on   TEXT,                  -- до первой встречи
  default_template_id INTEGER REFERENCES template(id),
  notes               TEXT,                  -- приватно, никогда не шарится
  user_id             INTEGER REFERENCES app_user(id),   -- v2: логин подопечного
  archived_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_person_active ON person(owner_id) WHERE archived_at IS NULL;

CREATE TABLE team (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  name        TEXT NOT NULL,
  description TEXT,
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

CREATE TABLE team_member (
  team_id    INTEGER NOT NULL REFERENCES team(id)   ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0,1)),
  joined_on  TEXT,
  left_on    TEXT,
  PRIMARY KEY (team_id, person_id)
);
CREATE UNIQUE INDEX ux_person_primary_team
  ON team_member(person_id) WHERE is_primary = 1 AND left_on IS NULL;
CREATE INDEX idx_team_member_person ON team_member(person_id) WHERE left_on IS NULL;

------------------------------------------------------------------ встречи
CREATE TABLE meeting (
  id                  INTEGER PRIMARY KEY,
  owner_id            INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  person_id           INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  template_version_id INTEGER REFERENCES template_version(id),   -- NULL = freeform
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','completed','cancelled')),
  visibility          TEXT NOT NULL DEFAULT 'private'  -- инертно в v1, ось для v2
                        CHECK (visibility IN ('private','team','org')),
  title               TEXT,
  scheduled_at        TEXT,
  held_on             TEXT,                  -- YYYY-MM-DD, ось X всех графиков
  duration_min        INTEGER,
  private_notes       TEXT,                  -- не шарится никогда
  counts_for_cadence  INTEGER NOT NULL DEFAULT 1 CHECK (counts_for_cadence IN (0,1)),
  completed_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (status <> 'completed' OR held_on IS NOT NULL)
);
CREATE INDEX idx_meeting_person   ON meeting(person_id, held_on DESC);
CREATE INDEX idx_meeting_upcoming ON meeting(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_meeting_version  ON meeting(template_version_id);

CREATE TABLE meeting_answer (
  id         INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  field_id   INTEGER NOT NULL REFERENCES template_field(id),  -- БЕЗ CASCADE, намеренно
  field_key  TEXT NOT NULL,                 -- денормализация: идентичность серии
  num_value  REAL,
  text_value TEXT,
  date_value TEXT,
  bool_value INTEGER CHECK (bool_value IN (0,1)),
  updated_at TEXT NOT NULL,
  UNIQUE (meeting_id, field_id)
);
CREATE INDEX idx_answer_field ON meeting_answer(field_id);
CREATE INDEX idx_answer_key   ON meeting_answer(field_key);

CREATE TABLE meeting_answer_option (
  answer_id  INTEGER NOT NULL REFERENCES meeting_answer(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES template_field_option(id),
  option_key TEXT NOT NULL,
  PRIMARY KEY (answer_id, option_id)
);
CREATE INDEX idx_answer_option_key ON meeting_answer_option(option_key);

------------------------------------------------------------------ action items
CREATE TABLE action_item (
  id                 INTEGER PRIMARY KEY,
  owner_id           INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  person_id          INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  created_meeting_id INTEGER REFERENCES meeting(id) ON DELETE SET NULL,
  closed_meeting_id  INTEGER REFERENCES meeting(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  details            TEXT,
  assignee           TEXT NOT NULL DEFAULT 'person'
                       CHECK (assignee IN ('manager','person','both')),
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','done','dropped')),
  visibility         TEXT NOT NULL DEFAULT 'shared'
                       CHECK (visibility IN ('shared','private')),
  due_on             TEXT,
  closed_at          TEXT,
  position           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_action_open ON action_item(person_id, status)
  WHERE status IN ('open','in_progress');
CREATE INDEX idx_action_due  ON action_item(due_on) WHERE status IN ('open','in_progress');
CREATE INDEX idx_action_created_meeting ON action_item(created_meeting_id);

-- Повестка переноса вычисляется live; эта таблица фиксирует, что реально разобрали
-- и в каком статусе оно было на тот момент.
CREATE TABLE meeting_action_review (
  meeting_id       INTEGER NOT NULL REFERENCES meeting(id)     ON DELETE CASCADE,
  action_item_id   INTEGER NOT NULL REFERENCES action_item(id) ON DELETE CASCADE,
  status_at_review TEXT NOT NULL,
  note             TEXT,
  PRIMARY KEY (meeting_id, action_item_id)
);

------------------------------------------------------------------ шаринг
CREATE TABLE share_link (
  id             INTEGER PRIMARY KEY,
  owner_id       INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  meeting_id     INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,      -- 32 случайных байта, base64url
  snapshot_json  TEXT NOT NULL,             -- неизменяемый, только shared-поля
  snapshot_hash  TEXT NOT NULL,
  locale         TEXT NOT NULL DEFAULT 'ru',
  created_at     TEXT NOT NULL,
  revoked_at     TEXT,
  expires_at     TEXT,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT
);
CREATE INDEX idx_share_meeting ON share_link(meeting_id, created_at DESC);
CREATE INDEX idx_share_active  ON share_link(token) WHERE revoked_at IS NULL;

------------------------------------------------------------------ представления
-- Единственный источник всех линейных графиков.
CREATE VIEW v_metric_point AS
SELECT m.id AS meeting_id, m.person_id, m.template_version_id, m.held_on AS on_date,
       f.metric_id, f.field_key, f.type AS field_type, f.label AS field_label,
       CASE f.type WHEN 'checkbox' THEN a.bool_value * 1.0 ELSE a.num_value END AS raw_value,
       CASE f.type
         WHEN 'scale'    THEN (a.num_value - f.scale_min) * 1.0
                               / NULLIF(f.scale_max - f.scale_min, 0)
         WHEN 'checkbox' THEN a.bool_value * 1.0
         ELSE a.num_value                    -- single_select: score опции, уже 0..1
       END AS norm_value
FROM meeting_answer a
JOIN meeting        m ON m.id = a.meeting_id
JOIN template_field f ON f.id = a.field_id
WHERE m.status = 'completed' AND f.metric_id IS NOT NULL
  AND f.type IN ('scale','single_select','checkbox');

-- Категориальные распределения во времени.
CREATE VIEW v_metric_category AS
SELECT m.id AS meeting_id, m.person_id, m.held_on AS on_date,
       f.metric_id, f.field_key, ao.option_key, o.label AS option_label, o.color
FROM meeting_answer        a
JOIN meeting               m  ON m.id = a.meeting_id AND m.status = 'completed'
JOIN template_field        f  ON f.id = a.field_id
JOIN meeting_answer_option ao ON ao.answer_id = a.id
JOIN template_field_option o  ON o.id = ao.option_id
WHERE f.metric_id IS NOT NULL;

-- Точка контроля приватности: путь шаринга читает ТОЛЬКО это.
CREATE VIEW v_shared_answer AS
SELECT a.id AS answer_id, a.meeting_id, a.field_id, a.field_key,
       a.num_value, a.text_value, a.date_value, a.bool_value,
       f.section_id, f.position, f.label, f.help_text, f.type,
       f.scale_min, f.scale_max, f.scale_min_label, f.scale_max_label
FROM meeting_answer a
JOIN template_field f ON f.id = a.field_id
WHERE f.visibility = 'shared';
```

### Правила записи по типу поля

Живут в одной функции `domain/answers.ts`, больше нигде:

| тип | колонки | строки опций |
| --- | --- | --- |
| `scale` | `num_value` | — |
| `text`, `short_text` | `text_value` | — |
| `checkbox` | `bool_value` | — |
| `date` | `date_value` | — |
| `single_select` | `num_value` = `score` выбранной опции | ровно 1 |
| `multi_select` | — | 0..n |

Запись score опции в `num_value` для `single_select` — единственная денормализация в
таблице значений: она позволяет `v_metric_point` остаться плоским джойном, и её делает та
же функция, что разрешает опцию, так что разъехаться они не могут.

## Формы ключевых запросов

`?today` всегда приходит связанным параметром, посчитанным в приложении из
`app_user.timezone`. `date('now')` в SQLite — UTC, и в Москве после 21:00 дашборд начнёт
врать на день.

**A. Таймлайн метрики по человеку** — `v_metric_point` по `person_id` + `metric_id`,
`ORDER BY on_date`. Рисуем `raw_value`, если `COUNT(DISTINCT template_version_id) = 1`,
иначе `norm_value` с осью 0-100% и вертикальным маркером в точках смены версии — чтобы
руководитель видел «здесь вопрос изменился».

**B. Агрегат по команде** — сначала среднее по человеку за период, потом по людям, иначе
человек с двумя встречами за месяц получает двойной вес:

```sql
WITH per_person AS (
  SELECT p.person_id, strftime('%Y-%m', p.on_date) AS period, AVG(p.norm_value) AS v
  FROM v_metric_point p
  JOIN team_member tm ON tm.person_id = p.person_id AND tm.left_on IS NULL
  WHERE tm.team_id = ?team_id AND p.metric_id = ?metric_id AND p.on_date >= ?from_date
  GROUP BY p.person_id, period
)
SELECT period, COUNT(*) AS people, AVG(v) AS avg_norm, MIN(v) AS min_norm, MAX(v) AS max_norm
FROM per_person GROUP BY period
HAVING COUNT(*) >= ?min_people        -- по умолчанию 3: не деанонимизировать корзины
ORDER BY period;
```

Агрегация идёт по **текущему** составу (`left_on IS NULL`): реальный вопрос руководителя —
«как движется моя команда в её нынешнем составе». `joined_on`/`left_on` хранятся с первого
дня, поэтому альтернатива «состав на тот момент» останется правкой запроса, а не миграцией.
Выбор показывается в UI графика, а не прячется.

**C. Открытые action items** — один запрос на два экрана: `?person_id = NULL` даёт
глобальный список, конкретный `person_id` — блок переноса в повестке встречи. Перенос
**вычисляется, а не копируется**: никакого дублирования строк и сверки. Сортировка:
просроченные, потом по `due_on`, потом по возрасту. При завершении встречи пишутся строки
`meeting_action_review`.

**D. Каденс** — `due_on = date(COALESCE(последняя completed held_on, cadence_anchor_on,
date(created_at)), '+cadence_days days')`; статус выводится из сравнения с `?today`:
`overdue` / `due_soon` / `ok` / `no_cadence`. Два намеренных решения: запланированная
будущая встреча **не** снимает просрочку (встреча через три недели не значит, что каденс
соблюдён — «запланировано» это отдельный флаг, а не статус), и `counts_for_cadence`
позволяет не считать десятиминутный ad-hoc за 1:1.

## Инвариант приватности

Единственная поломка, которая портит отношения с человеком, а не данные. Входов много:
HTML share-страница, `.md` экспорт снапшота, payload графика, HTMX-партиал, отрендеренный
не тем шаблоном, `meeting.private_notes`. Защита слоями:

1. `visibility` по умолчанию `'private'` в самой БД — баг, забывший передать видимость,
   *скрывает*, а не раскрывает.
2. `v_shared_answer` — единственное, что читает путь шаринга. `domain/snapshot.ts` —
   единственный сборщик снапшота; `db/queries/shares.ts` не импортирует другие query-модули.
3. `buildSharedSnapshot()` в конце проверяет, что ни один `field_id` в payload не имеет
   `visibility = 'private'`, и падает, если это не так.
4. `tests/snapshot-privacy.test.ts` — встреча, где каждый тип поля приватен и содержит
   строку-сентинел, после чего сентинел ищется в отрендеренном HTML, JSON снапшота,
   Markdown и во всех payload графиков. Этот тест не удаляется никогда.
5. Публичный роутер `/s/:token` монтируется **вне** auth-мидлвари с самого начала: в v2 он
   должен остаться неаутентифицированным, и если в v1 он окажется внутри — про это забудут.

Отдельно: экспорт и шаринг имеют **противоположные** контракты приватности, поэтому это
две функции с разными именами и разными роутами — `exportFullJson()` / `exportFullMarkdown()`
включают приватное (это бэкап), `buildSharedSnapshot()` не включает. Выбор между ними
никогда не делается query-параметром `?format=`.

## Сравнение людей на одном полотне

Добавлено по ходу работы: нужно видеть и общекомандное настроение, и кому стоит уделить
внимание. Это два разных вопроса, и одной картинкой они не отвечаются, поэтому на
странице `/compare` две формы рядом.

**График — про настроение команды.** Линия среднего плюс полоса мин-макс. Читается при
любом размере команды и не зависит от того, сколько людей выбрано. Индивидуальные линии
включаются галочками — до восьми: девятая серия в категориальной палитре потребовала бы
генерировать цвет, а это неразличимые пары.

**Список — про внимание.** Последнее значение по каждому человеку, изменение с прошлой
встречи, отсортировано худшим вперёд. «Хуже» зависит от `metric.direction`: у нагрузки и
риска ухода плохо наверху шкалы, у остальных внизу. Восемь ломаных на этот вопрос не
отвечают, а список отвечает сразу. Он же служит табличным видом данных графика, поэтому
идентичность нигде не держится на одном цвете.

Решения, которые стоит помнить:

- **Группировка по месяцам, а не по датам встреч.** Люди встречаются в разные дни; по
  сырым датам линии не выравниваются и общий тренд читать невозможно. Внутри месяца у
  человека берётся среднее, поэтому две встречи за месяц не дают двойного веса.
- **Цветовой слот закреплён за человеком** (порядок по `person.id`), а не за его местом
  в рейтинге: иначе изменение оценки перекрашивало бы график.
- **Палитра — восемь слотов в фиксированном порядке**, проверенных валидатором на белом
  фоне: худшая соседняя пара CVD ΔE 9.1, обычное зрение ΔE 19.6. Три слота не дотягивают
  до контраста 3:1 к фону, поэтому у линий есть и легенда, и подписи у концов.
- **Полоса разброса рецессивная серая**, а не цвет серии: это контекст, а не сущность.
- **Порядок метрик в списках задан данными** (`metric.display_order`, миграция 0004):
  первым экраном сравнения не должна открываться приватная оценка риска ухода.
  Раньше порядок задавался алфавитом, и она открывалась первой.

## Конструктор шаблонов и метрик

Этап 4. Ключевая сложность здесь не в интерфейсе, а в том, что правка шаблона не должна
переписывать заполненные встречи.

**Все правки адресуются по ключу, а не по id.** Каждая операция начинается с
`ensureDraft()`: если по текущей версии уже прошли встречи, правка уходит в форк, и id
полей меняются под руками. По ключу (`section_key` / `field_key` / `option_key`)
сопоставление старых id с новыми не нужно вообще — это убирает целый класс багов.

Отсюда следует инвариант, на котором держится редактор: **у черновика не может быть
заполненных встреч**, поэтому внутри черновика безопасно менять тип поля, шкалу и
видимость — переинтерпретировать нечего. Заполненные встречи остаются привязанными к
своей замороженной версии навсегда, и это проверяется тестом: ответ «4 из 5» не должен
превратиться в «4 из 10» из-за того, что шкалу потом расширили.

Что есть в конструкторе:

- Секции и вопросы: создание, правка, удаление, порядок. Порядок меняется перетаскиванием
  и стрелками ↑↓ — стрелки это обычные формы и работают всегда, включая телефон и
  выключенный JS; перетаскивание только ускорение.
- Все семь типов полей, привязка к метрике, флаг видимости, варианты с числовым весом.
- **Переключатель «это другой вопрос»** при правке формулировки. Схема не может отличить
  исправление опечатки от смены смысла, поэтому спрашивает: галочка выдаёт новый
  `field_key` и сознательно обрывает серию, а старые ответы остаются при старом вопросе.
- **Проверка шаблона** перед тем, как по нему начнут собирать данные: метричный select без
  весов у вариантов (иначе график не построится, и выяснится это через месяц), select без
  вариантов, две привязки к одной метрике (две точки за одну встречу — непонятно, какая
  настоящая), пустые секции.
- Экран версий с диффом по `field_key`: переформулирован, сменил тип, сменил шкалу,
  привязан/отвязан от метрики, **сменил видимость** — последнее отдельным пунктом, потому
  что это то изменение, которое меняет, что увидит подопечный.
- Копия шаблона, шаблон по умолчанию, архивирование.
- Раскрытие форм через URL (`?edit=<ключ>`), а не модалками: работает без JS, ссылку можно
  сохранить и переслать, и это укладывается в «без шага сборки».

Метрики (`/metrics`): создание, правка, архивирование, счётчик использования — в скольких
полях и шаблонах метрика привязана и сколько точек уже собрано. Ключ предлагается из
подписи с транслитерацией и **фиксируется навсегда, как только на метрику начали
ссылаться**: переименовать ключ значит незаметно склеить или разорвать историю.
Переименовывается только подпись. Направление менять можно — это исправление трактовки,
а не данных. Метрика без ссылок удаляется по-настоящему (это опечатка при создании),
метрика со ссылками уходит в архив: за ней стоит история.

## Структура проекта

```
121/
  package.json           # type: module; scripts: dev, start, migrate, export, backup, test
  .env.example           # PORT, DB_PATH, BASE_URL, DEFAULT_LOCALE, TZ
  data/                  # gitignored: 121.sqlite, backups/
  public/
    app.css
    vendor/htmx.min.js  vendor/chart.umd.min.js
  src/
    server.ts            # migrate -> pragmas -> routes -> serve (127.0.0.1)
    config.ts
    db/
      index.ts           # openDb() + прагмы
      migrate.ts         # раннер по user_version
      migrations/0001_init.sql, 0002_seed.sql
      queries/           # people, teams, templates, meetings, answers, metrics,
                         # actions, shares, cadence, exportq — prepared statements
      types.ts           # рукописные интерфейсы строк, без ORM и кодогенерации
    domain/              # чистая логика, без импортов Hono, юнит-тестируемая
      template-version.ts  # fork(), freezeIfNeeded(), diff(), mintFieldKey()
      answers.ts           # валидация и правила записи по типу
      snapshot.ts          # buildSharedSnapshot() -> SharePayload
      markdown.ts          # SharePayload -> md
      cadence.ts           # todayInTz(), classify()
      export.ts  backup.ts  tokens.ts
    routes/
      index.ts           # share-роутер монтируется ВНЕ auth
      dashboard.ts  people.ts  teams.ts  templates.ts  meetings.ts  actions.ts
      charts.ts          # JSON уже в форме {labels, datasets} для Chart.js
      shares.ts          # POST create/revoke; GET /s/:token; GET /s/:token.md
      settings.ts        # локаль, экспорт, бэкап
    views/
      html.ts            # html`` с экранированием — ЕДИНСТВЕННОЕ место экранирования
      layout.ts  components/  pages/
    i18n/index.ts  ru.ts  en.ts
    middleware/locale.ts  current-user.ts  errors.ts
    lib/dates.ts  ids.ts  validate.ts
  tests/
    snapshot-privacy.test.ts  template-fork.test.ts  cadence.test.ts  metrics.test.ts
```

Ограничения «без сборки»: никакого JSX — `views/html.ts` отдаёт tagged template, который
экранирует всё интерполированное, кроме обёрнутого в `raw()`. `components/field-input.ts`
рендерит и редактируемую, и read-only форму каждого типа поля — одна функция, два режима,
чтобы share-страница и страница правки не могли разойтись в трактовке. Графики: роут
отдаёт JSON, страница — `<canvas data-src>` плюс крошечный inline-init.

`middleware/current-user.ts` в v1 — заглушка, возвращающая `{id: 1}`, но **все запросы уже
принимают `owner_id`**. В v2 меняется один файл.

## Язык кода и локализация

Код, идентификаторы и комментарии — только английские; кириллица живёт исключительно в
слое локализации. Это проверяется тестом `tests/language.test.ts`, а не памятью.

Из этого правила вытекли три структурных решения, которые сами по себе полезны:

- **Доменные ошибки несут код, а не предложение.** `TemplateEditError("SCALE_INVALID")`
  вместо готового текста. Домен не решает, как сообщение читается человеком — это дело
  представления и зависит от локали. Формулировки живут в словарях, а `message` ошибки
  содержит код с параметрами, чтобы логи читались без словаря.
- **Проверки шаблона возвращают коды с параметрами**, а не собранные строки.
- **Форматирование дат уехало в `src/i18n/dates.ts`.** `Intl` даёт русские месяцы в
  именительном падеже («сентябрь»), а в дате нужен родительный («7 сентября») — это данные
  локали, поэтому им место в слое локализации. В `lib/dates.ts` осталась арифметика без
  локали. Туда же переехала таблица транслитерации.
- Клиентские скрипты берут пользовательский текст из `data-`атрибутов, отрендеренных
  сервером, поэтому в JavaScript нет ни одной локализованной строки.

Исключения, зафиксированные в тесте: каталог `src/i18n/` целиком и содержимое сида
(`0002_seed.sql`, `0003_...`) — стартовый шаблон это пользовательский контент, который по
проекту одноязычный, как и любой шаблон, написанный руководителем. Комментарии в сиде при
этом английские.

## Миграции, бэкап, прагмы

Нумерованные `.sql`, гейт по `PRAGMA user_version`, применяются при старте до приёма
соединений, только вперёд, без down-миграций.

Прагмы при открытии, в этом порядке: `journal_mode = WAL`, `foreign_keys = ON`
(per-connection, ставится каждый раз), `busy_timeout = 5000`, `synchronous = NORMAL`,
`temp_store = MEMORY`.

Раннер: собрать файлы по `^(\d{4})_[a-z0-9_]+\.sql$`, отсортировать численно, упасть на
дырах и дублях номеров; если есть неприменённые — сначала `VACUUM INTO
data/backups/pre-migration-<N>-<ts>.sqlite`; затем на каждую: `foreign_keys = OFF` →
`BEGIN IMMEDIATE` → `run(sql)` → `PRAGMA user_version = <n>` → запись в `_migration_log`
→ `COMMIT` → `PRAGMA foreign_key_check` (падать, если непусто) → `foreign_keys = ON`.
`_migration_log(version, filename, sha256, applied_at)` хранит контрольные суммы, и на
старте суммы уже применённых файлов сверяются — это ловит самый частый self-hosted
прострел: правку миграции, которая уже выполнилась.

**Бэкап — только `VACUUM INTO`, никогда `cp`.** При включённом WAL копирование `.sqlite`
молча теряет всё, что осталось в `-wal`. Роут `POST /settings/backup` делает vacuum в
`data/backups/` и отдаёт получившийся файл.

## Этапы

**0. Каркас.** `bun init`, `.gitignore` (`data/`, `.env`), `git config user.email
me@ya-makariy.com` (origin — `github.com/ya-makariy/121`, локальный адрес не задан;
рабочий адрес в этот репозиторий попадать не должен), `PLAN.md` из этого документа,
`CLAUDE.md` с правилом про JSON и про `?today`. Вендорим htmx и chart.js.

**1. БД и миграции.** `0001_init.sql` целиком, раннер, прагмы, `tests/` на то, что
миграция применяется на чистой базе и идемпотентна при повторном старте.

**2. Сид (`0002_seed.sql`).** Метрики: `job_satisfaction`, `growth_clarity`,
`team_direction_clarity` (шкала 1-5, `direction = 1`); `workload` и `energy`
(1-5, `direction = -1` для workload); `feedback_recognition`, `team_relationships`
(1-5); `attrition_risk` — `categorical`, low/medium/high со `score` 0/0.5/1,
`direction = -1`. Стартовый шаблон «Регулярный 1:1» с секциями: как дела (shared),
метрики (shared), развитие (shared), договорённости (shared), **приватная оценка
руководителя** — `attrition_risk` + свободное поле, оба `private`. Сид — только
безымянные примеры, никаких реальных имён (репозиторий может стать публичным).

**3. Сквозной тонкий срез** — на вшитом сидовом шаблоне, без редактора:
люди CRUD → создать встречу → заполнить поля (HTMX, автосохранение по полю) →
завершить встречу → график метрики по человеку → снапшот + Markdown.
Здесь же `tests/snapshot-privacy.test.ts`. После этого этапа инструментом уже можно
провести настоящую 1:1 — это критерий готовности среза.

**4. Редактор шаблонов.** Секции и поля, drag-reorder через HTMX, все типы полей,
привязка к метрике, флаг видимости, переключатель «это другой вопрос», forkOnEdit +
`frozen_at`, экран диффа версий, запрет удаления поля с ответами.

**5. Команды, каденс, action items.** M2M-команды с primary, дашборд
overdue/due-soon/ok, глобальный список открытых договорённостей, перенос в повестку,
агрегаты по команде с порогом `min_people`.

**6. Экспорт, бэкап, i18n-переключатель.** Полный JSON и Markdown, `VACUUM INTO`,
словари ru/en и мидлварь локали (cookie > `?lang=` > `Accept-Language` > default).

## Верификация

- `bun test` — приватность снапшота (сентинел), форк шаблона (заполненная встреча
  сохраняет старую трактовку после правки), нормализация метрик через смену шкалы 1-5 →
  1-10, каденс на границе часового пояса (21:00 по Москве не должно давать сдвиг на день),
  агрегат по команде с человеком, у которого две встречи за период.
- `bun run dev` → `http://127.0.0.1:PORT`: пройти сценарий вручную — добавить человека,
  провести встречу по стартовому шаблону, увидеть точку на графике, создать снапшот.
- Проверить приватность руками: в снапшоте и в `.md` не должно быть содержимого
  приватной секции; открыть `/s/:token` в приватном окне.
- Отредактировать стартовый шаблон после заполненной встречи → убедиться, что старая
  встреча открывается в прежнем виде и график не разорвался.
- `grep -rn "'now'" src/db/queries/` — должно быть пусто.
- `POST /settings/backup` → открыть полученный файл в `sqlite3` и проверить, что данные
  последней встречи там есть (проверка WAL-ловушки).

## v2 — не делаем сейчас, но не перекрашиваем потом

Заложено с первого дня, потому что почти бесплатно, а retrofit дорог: `app_user` с одной
строкой и `owner_id NOT NULL DEFAULT 1` на всех доменных таблицах; `password_hash`, `role`,
`timezone`, `locale`; заглушка `current-user.ts` при том, что запросы уже принимают
`owner_id`; `meeting.visibility`; `person.user_id`; `archived_at` вместо жёстких удалений
(в инструменте, чья ценность — продольная история, hard delete это баг); публичный
share-роутер вне auth; `created_at`/`updated_at` везде.

Безопасно отложено, потому что аддитивно: таблица `session`; хеширование share-токенов
(в v1 токен хранится как есть, чтобы можно было заново скопировать ссылку — файл БД и так
локальный секрет; в облаке — `token_hash` + показ один раз); RBAC глубже `role`; шаринг
между руководителями; аудит-лог; уведомления и почта; ответы подопечного в его части
подготовки. Мультидевайс в v2 — это один хостящийся экземпляр БД с авторизацией, а не
синхронизация: именно поэтому `INTEGER PRIMARY KEY` сегодня безопасен.

## Расхождения в исходных требованиях, разрешённые здесь

- **«Select-поля как временные ряды.»** У multi_select нет скалярного ряда — только доля
  каждой опции во времени. single_select строится в ряд, только если у опций есть
  числовые `score`. Отсюда два представления вместо одного, и валидация «у метричного
  select все опции имеют score» на публикации шаблона, а не на построении графика.
- **Тип `date` и графики.** Дата не привязывается к метрике (запрещено CHECK-ом). Если
  нужен график — метрика называется «дней до X» и это scale-поле.
- **«Открытые пункты всплывают автоматически» при отсутствии крона.** Согласуется только
  если «автоматически» = «вычисляется при открытии следующей встречи». Так и сделано.
- **«Приватное» в двух разных смыслах.** Приватное-от-подопечного
  (`template_field.visibility`, нужно сейчас) и приватное-от-других-руководителей (скоуп
  доступа, отложено) — это две разные оси. Одной колонкой их перегружать нельзя, иначе v2
  либо утечёт коллегам, либо спрячет от подопечного его же саммари.
