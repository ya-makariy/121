-- Starter content. The 1:1 process is being built from scratch, so this template is not a
-- copy of something existing: it defines the process. The first meeting can be run right
-- after installation with nothing configured.
--
-- Keys here (metric.key, section_key, field_key) are readable rather than random: the seed
-- lives a long time, and a readable key in a chart or an export saves time. Fields created
-- in the builder get generated keys — only stability matters, not shape.
--
-- The wording below is user content, not code: a template is single-language by design,
-- the same way a manager's own templates are. The starter template is written in English
-- because it is the first thing every new instance shows; a manager who works in another
-- language renames these sections and questions in the builder.

------------------------------------------------------------------ metrics
INSERT INTO metric (key, label, description, kind, direction, created_at) VALUES
  ('job_satisfaction', 'Job satisfaction',
   'How well the work suits the person overall right now.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('growth_clarity', 'Clarity of own growth',
   'Whether the person knows where they are growing and what they are doing about it.',
   'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('team_direction_clarity', 'Clarity of team direction',
   'Whether it is clear where the team is going and why.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('workload', 'Workload',
   'Subjective amount of work. Higher is worse: direction -1.', 'scalar', -1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('energy', 'Energy',
   'Whether there is energy left. An early burnout signal together with workload.',
   'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('feedback_recognition', 'Feedback and recognition',
   'Whether the person gets enough feedback and recognition.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('team_relationships', 'Relationships in the team',
   'Comfort and trust in relationships with colleagues.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('attrition_risk', 'Attrition risk',
   'A private assessment by the manager. Higher is worse: direction -1.', 'categorical', -1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

------------------------------------------------------------------ template
INSERT INTO template (name, description, is_default, created_at, updated_at)
VALUES ('Regular 1:1',
        'The default meeting plan. The last section is visible to the manager only.',
        1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT INTO template_version (template_id, version_no, created_at)
VALUES ((SELECT id FROM template WHERE is_default = 1),
        1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));

UPDATE template
SET current_version_id = (SELECT id FROM template_version WHERE version_no = 1
                          AND template_id = template.id)
WHERE is_default = 1;

------------------------------------------------------------------ sections
INSERT INTO template_section (version_id, section_key, title, description, position)
SELECT tv.id, s.section_key, s.title, s.description, s.position
FROM template_version tv,
  (SELECT 'checkin'    AS section_key, 'Check-in' AS title,
          'The conversation before the numbers. What has happened since the last meeting.'
          AS description, 1 AS position
   UNION ALL SELECT 'pulse',    'Pulse',
          'Short 1-5 scales. Their trend is what the charts are built from.', 2
   UNION ALL SELECT 'growth',   'Growth',
          'Where the person is heading, and whether that is clear to them.', 3
   UNION ALL SELECT 'agreements', 'Agreements',
          'The outcome of the meeting in words. Concrete items live in a separate list.', 4
   UNION ALL SELECT 'manager_private', 'Manager assessment',
          'For my eyes only. It never reaches the summary shared with the person.', 5) s
WHERE tv.version_no = 1;

------------------------------------------------------------------ fields
-- visibility is stated explicitly on every field: the database default is 'private'
-- (fail closed), so shared fields have to say so out loud.
INSERT INTO template_field (
  version_id, section_id, field_key, label, help_text, type, visibility,
  is_required, position, metric_id, scale_min, scale_max, scale_min_label, scale_max_label
)
SELECT
  ts.version_id, ts.id, f.field_key, f.label, f.help_text, f.type, f.visibility,
  f.is_required, f.position,
  (SELECT id FROM metric WHERE key = f.metric_key),
  f.scale_min, f.scale_max, f.scale_min_label, f.scale_max_label
FROM template_section ts
JOIN (
  SELECT 'checkin' AS sk, 'since_last' AS field_key,
         'What has happened since the last meeting' AS label,
         'Free-form. Written down as the conversation goes.' AS help_text,
         'text' AS type, 'shared' AS visibility, 0 AS is_required, 1 AS position,
         NULL AS metric_key, NULL AS scale_min, NULL AS scale_max,
         NULL AS scale_min_label, NULL AS scale_max_label
  UNION ALL SELECT 'checkin', 'energy', 'Energy',
         'Whether there is energy right now.', 'scale', 'shared', 0, 2,
         'energy', 1, 5, 'running empty', 'full of energy'

  UNION ALL SELECT 'pulse', 'job_satisfaction', 'How well the work suits you right now',
         NULL, 'scale', 'shared', 0, 1,
         'job_satisfaction', 1, 5, 'not at all', 'completely'
  UNION ALL SELECT 'pulse', 'workload', 'Workload',
         'Higher means heavier. The chart accounts for the direction.', 'scale', 'shared', 0, 2,
         'workload', 1, 5, 'far too little', 'at the limit'
  UNION ALL SELECT 'pulse', 'feedback_recognition', 'Is there enough feedback and recognition',
         NULL, 'scale', 'shared', 0, 3,
         'feedback_recognition', 1, 5, 'not enough', 'enough'
  UNION ALL SELECT 'pulse', 'team_relationships', 'Relationships in the team',
         NULL, 'scale', 'shared', 0, 4,
         'team_relationships', 1, 5, 'hard', 'easy'

  UNION ALL SELECT 'growth', 'growth_clarity', 'Is it clear where you are growing',
         NULL, 'scale', 'shared', 0, 1,
         'growth_clarity', 1, 5, 'not at all', 'completely clear'
  UNION ALL SELECT 'growth', 'team_direction_clarity', 'Is it clear where the team is going',
         NULL, 'scale', 'shared', 0, 2,
         'team_direction_clarity', 1, 5, 'not at all', 'completely clear'
  UNION ALL SELECT 'growth', 'growth_notes', 'Growth: what we agreed on',
         'What the person wants to be able to do, and the next step towards it.',
         'text', 'shared', 0, 3,
         NULL, NULL, NULL, NULL, NULL

  UNION ALL SELECT 'agreements', 'summary', 'Meeting outcome',
         'The person will see this. A couple of paragraphs on what matters.',
         'text', 'shared', 0, 1,
         NULL, NULL, NULL, NULL, NULL

  UNION ALL SELECT 'manager_private', 'attrition_risk', 'Attrition risk',
         'Private. This exercises the visibility mechanism: it must never leak into a summary.',
         'single_select', 'private', 0, 1,
         'attrition_risk', NULL, NULL, NULL, NULL
  UNION ALL SELECT 'manager_private', 'manager_notes', 'My notes',
         'Private. Observations, hypotheses, things to check at the next meeting.',
         'text', 'private', 0, 2,
         NULL, NULL, NULL, NULL, NULL
) f ON f.sk = ts.section_key
WHERE ts.version_id = (SELECT id FROM template_version WHERE version_no = 1);

------------------------------------------------------------------ options
-- score is required for a metric-bound select: without it the field never becomes a chart.
INSERT INTO template_field_option (field_id, option_key, label, score, color, position)
SELECT tf.id, o.option_key, o.label, o.score, o.color, o.position
FROM template_field tf
JOIN (
  SELECT 'low'    AS option_key, 'Low'  AS label, 0.0 AS score, '#2f9e44' AS color, 1 AS position
  UNION ALL SELECT 'medium', 'Medium', 0.5, '#e8a33d', 2
  UNION ALL SELECT 'high',   'High',   1.0, '#c92a2a', 3
) o
WHERE tf.field_key = 'attrition_risk';

------------------------------------------------------------------ settings
INSERT INTO app_setting (owner_id, key, value) VALUES
  (1, 'locale', 'ru'),
  (1, 'onboarded', 'false');
