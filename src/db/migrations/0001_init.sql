-- 121: initial schema.
-- Pragmas live in src/db/index.ts, not here: some of them cannot run inside a transaction.
--
-- Rules this schema locks in (reasoning in CLAUDE.md and PLAN.md):
--   * answer values sit in typed columns, never JSON;
--   * template_field.visibility defaults to 'private' — fail closed;
--   * meeting_answer.field_id has NO ON DELETE CASCADE: history is not deleted;
--   * owner_id exists from day one so that v2 (auth, cloud) stays additive.

CREATE TABLE _migration_log (
  version    INTEGER PRIMARY KEY,
  filename   TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

------------------------------------------------------------------ identity (v2-ready)
CREATE TABLE app_user (
  id            INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT,                        -- v2; NULL in v1
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

------------------------------------------------------------------ metrics
CREATE TABLE metric (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  key         TEXT NOT NULL,                 -- IMMUTABLE once referenced
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

------------------------------------------------------------------ templates
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
  frozen_at         TEXT,                    -- NULL => draft, edited in place
  change_note       TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (template_id, version_no)
);
CREATE INDEX idx_tv_template ON template_version(template_id, version_no DESC);

CREATE TABLE template_section (
  id          INTEGER PRIMARY KEY,
  version_id  INTEGER NOT NULL REFERENCES template_version(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,                 -- stable across forks
  title       TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL,
  UNIQUE (version_id, section_key)
);
CREATE INDEX idx_section_order ON template_section(version_id, position);
-- No UNIQUE(version_id, position) on purpose: it breaks drag-reorder and buys nothing.

CREATE TABLE template_field (
  id              INTEGER PRIMARY KEY,
  version_id      INTEGER NOT NULL REFERENCES template_version(id) ON DELETE CASCADE,
  section_id      INTEGER NOT NULL REFERENCES template_section(id) ON DELETE CASCADE,
  field_key       TEXT NOT NULL,             -- stable across forks
  label           TEXT NOT NULL,
  help_text       TEXT,
  type            TEXT NOT NULL CHECK (type IN
                    ('scale','text','short_text','checkbox','single_select','multi_select','date')),
  visibility      TEXT NOT NULL DEFAULT 'private'    -- FAIL CLOSED
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
  option_key TEXT NOT NULL,                  -- stable across forks
  label      TEXT NOT NULL,
  score      REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  color      TEXT,
  position   INTEGER NOT NULL,
  UNIQUE (field_id, option_key)
);
CREATE INDEX idx_option_order ON template_field_option(field_id, position);

------------------------------------------------------------------ people and teams
CREATE TABLE person (
  id                  INTEGER PRIMARY KEY,
  owner_id            INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  full_name           TEXT NOT NULL,
  email               TEXT,
  role_title          TEXT,
  timezone            TEXT,
  started_on          TEXT,
  cadence_days        INTEGER CHECK (cadence_days IS NULL OR cadence_days > 0),
  cadence_anchor_on   TEXT,                  -- used before the first meeting
  default_template_id INTEGER REFERENCES template(id),
  notes               TEXT,                  -- private, never shared
  user_id             INTEGER REFERENCES app_user(id),   -- v2: the mentee logs in
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

------------------------------------------------------------------ meetings
CREATE TABLE meeting (
  id                  INTEGER PRIMARY KEY,
  owner_id            INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  person_id           INTEGER NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  template_version_id INTEGER REFERENCES template_version(id),   -- NULL = freeform
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','completed','cancelled')),
  visibility          TEXT NOT NULL DEFAULT 'private'  -- inert in v1, the axis for v2
                        CHECK (visibility IN ('private','team','org')),
  title               TEXT,
  scheduled_at        TEXT,
  held_on             TEXT,                  -- YYYY-MM-DD, the x-axis of every chart
  duration_min        INTEGER,
  private_notes       TEXT,                  -- never shared
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
  field_id   INTEGER NOT NULL REFERENCES template_field(id),  -- NO CASCADE, deliberately
  field_key  TEXT NOT NULL,                 -- denormalized: the identity of a series
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

-- The carry-over agenda is derived live; this table records what was actually reviewed
-- and the status it had at that moment.
CREATE TABLE meeting_action_review (
  meeting_id       INTEGER NOT NULL REFERENCES meeting(id)     ON DELETE CASCADE,
  action_item_id   INTEGER NOT NULL REFERENCES action_item(id) ON DELETE CASCADE,
  status_at_review TEXT NOT NULL,
  note             TEXT,
  PRIMARY KEY (meeting_id, action_item_id)
);

------------------------------------------------------------------ sharing
CREATE TABLE share_link (
  id             INTEGER PRIMARY KEY,
  owner_id       INTEGER NOT NULL DEFAULT 1 REFERENCES app_user(id),
  meeting_id     INTEGER NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,      -- 32 random bytes, base64url
  snapshot_json  TEXT NOT NULL,             -- immutable, shared fields only
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

------------------------------------------------------------------ views
-- The single source of every line chart.
CREATE VIEW v_metric_point AS
SELECT m.id AS meeting_id, m.person_id, m.template_version_id, m.held_on AS on_date,
       f.metric_id, f.field_key, f.type AS field_type, f.label AS field_label,
       CASE f.type WHEN 'checkbox' THEN a.bool_value * 1.0 ELSE a.num_value END AS raw_value,
       CASE f.type
         WHEN 'scale'    THEN (a.num_value - f.scale_min) * 1.0
                               / NULLIF(f.scale_max - f.scale_min, 0)
         WHEN 'checkbox' THEN a.bool_value * 1.0
         ELSE a.num_value                    -- single_select: option score, already 0..1
       END AS norm_value
FROM meeting_answer a
JOIN meeting        m ON m.id = a.meeting_id
JOIN template_field f ON f.id = a.field_id
WHERE m.status = 'completed' AND f.metric_id IS NOT NULL
  AND f.type IN ('scale','single_select','checkbox');

-- Categorical distributions over time.
CREATE VIEW v_metric_category AS
SELECT m.id AS meeting_id, m.person_id, m.held_on AS on_date,
       f.metric_id, f.field_key, ao.option_key, o.label AS option_label, o.color
FROM meeting_answer        a
JOIN meeting               m  ON m.id = a.meeting_id AND m.status = 'completed'
JOIN template_field        f  ON f.id = a.field_id
JOIN meeting_answer_option ao ON ao.answer_id = a.id
JOIN template_field_option o  ON o.id = ao.option_id
WHERE f.metric_id IS NOT NULL;

-- The privacy chokepoint: the sharing path reads ONLY this.
CREATE VIEW v_shared_answer AS
SELECT a.id AS answer_id, a.meeting_id, a.field_id, a.field_key,
       a.num_value, a.text_value, a.date_value, a.bool_value,
       f.section_id, f.position, f.label, f.help_text, f.type,
       f.scale_min, f.scale_max, f.scale_min_label, f.scale_max_label
FROM meeting_answer a
JOIN template_field f ON f.id = a.field_id
WHERE f.visibility = 'shared';
