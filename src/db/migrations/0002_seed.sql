-- Стартовое наполнение. Процесс 1:1 строится с нуля, поэтому этот шаблон — не копия
-- чего-то существующего, а определение процесса: первую встречу можно провести
-- сразу после установки, ничего не настраивая.
--
-- Ключи (metric.key, section_key, field_key) здесь читаемые, а не случайные: сид живёт
-- долго, и читаемый ключ в графике и в экспорте экономит время. Поля, созданные в
-- редакторе, получают сгенерированные ключи — важна только стабильность, не форма.

------------------------------------------------------------------ метрики
INSERT INTO metric (key, label, description, kind, direction, created_at) VALUES
  ('job_satisfaction', 'Удовлетворённость работой',
   'Насколько работа сейчас в целом устраивает.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('growth_clarity', 'Ясность собственного развития',
   'Понимает ли человек, куда он развивается и что для этого делает.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('team_direction_clarity', 'Ясность направления команды',
   'Понятно ли, куда идёт команда и зачем.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('workload', 'Нагрузка',
   'Субъективный объём нагрузки. Больше — хуже: направление -1.', 'scalar', -1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('energy', 'Энергия',
   'Есть ли силы. Ранний сигнал выгорания вместе с нагрузкой.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('feedback_recognition', 'Обратная связь и признание',
   'Достаточно ли человек получает обратной связи и признания.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('team_relationships', 'Отношения в команде',
   'Комфорт и доверие в отношениях с коллегами.', 'scalar', 1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  ('attrition_risk', 'Риск ухода',
   'Приватная оценка руководителя. Больше — хуже: направление -1.', 'categorical', -1,
   strftime('%Y-%m-%dT%H:%M:%SZ','now'));

------------------------------------------------------------------ шаблон
INSERT INTO template (name, description, is_default, created_at, updated_at)
VALUES ('Регулярный 1:1',
        'План встречи по умолчанию. Последняя секция видна только руководителю.',
        1, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT INTO template_version (template_id, version_no, created_at)
VALUES ((SELECT id FROM template WHERE is_default = 1),
        1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));

UPDATE template
SET current_version_id = (SELECT id FROM template_version WHERE version_no = 1
                          AND template_id = template.id)
WHERE is_default = 1;

------------------------------------------------------------------ секции
INSERT INTO template_section (version_id, section_key, title, description, position)
SELECT tv.id, s.section_key, s.title, s.description, s.position
FROM template_version tv,
  (SELECT 'checkin'    AS section_key, 'Как дела' AS title,
          'Разговор до цифр. Что произошло с прошлой встречи.' AS description, 1 AS position
   UNION ALL SELECT 'pulse',    'Пульс',
          'Короткие шкалы 1-5. Их динамика и попадает в графики.', 2
   UNION ALL SELECT 'growth',   'Развитие',
          'Куда человек идёт и понятно ли ему это.', 3
   UNION ALL SELECT 'agreements', 'Договорённости',
          'Итог встречи словами. Конкретные пункты живут отдельным списком.', 4
   UNION ALL SELECT 'manager_private', 'Оценка руководителя',
          'Только для меня. Не попадает в саммари для подопечного никогда.', 5) s
WHERE tv.version_no = 1;

------------------------------------------------------------------ поля
-- visibility задаётся явно у каждого поля: дефолт в БД — 'private' (fail closed),
-- поэтому shared-поля обязаны сказать это вслух.
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
  SELECT 'checkin' AS sk, 'since_last' AS field_key, 'Что произошло с прошлой встречи' AS label,
         'Свободный рассказ. Заполняется по ходу разговора.' AS help_text,
         'text' AS type, 'shared' AS visibility, 0 AS is_required, 1 AS position,
         NULL AS metric_key, NULL AS scale_min, NULL AS scale_max,
         NULL AS scale_min_label, NULL AS scale_max_label
  UNION ALL SELECT 'checkin', 'energy', 'Энергия',
         'Есть ли силы сейчас.', 'scale', 'shared', 0, 2,
         'energy', 1, 5, 'на нуле', 'полон сил'

  UNION ALL SELECT 'pulse', 'job_satisfaction', 'Насколько работа сейчас устраивает',
         NULL, 'scale', 'shared', 0, 1,
         'job_satisfaction', 1, 5, 'совсем нет', 'полностью'
  UNION ALL SELECT 'pulse', 'workload', 'Нагрузка',
         'Больше — тяжелее. В графике направление учтено.', 'scale', 'shared', 0, 2,
         'workload', 1, 5, 'слишком мало', 'на пределе'
  UNION ALL SELECT 'pulse', 'feedback_recognition', 'Достаточно ли обратной связи и признания',
         NULL, 'scale', 'shared', 0, 3,
         'feedback_recognition', 1, 5, 'не хватает', 'достаточно'
  UNION ALL SELECT 'pulse', 'team_relationships', 'Отношения в команде',
         NULL, 'scale', 'shared', 0, 4,
         'team_relationships', 1, 5, 'тяжело', 'легко'

  UNION ALL SELECT 'growth', 'growth_clarity', 'Понятно ли, куда ты развиваешься',
         NULL, 'scale', 'shared', 0, 1,
         'growth_clarity', 1, 5, 'совсем нет', 'полностью ясно'
  UNION ALL SELECT 'growth', 'team_direction_clarity', 'Понятно ли, куда идёт команда',
         NULL, 'scale', 'shared', 0, 2,
         'team_direction_clarity', 1, 5, 'совсем нет', 'полностью ясно'
  UNION ALL SELECT 'growth', 'growth_notes', 'Развитие: о чём договорились',
         'Что человек хочет уметь, какой следующий шаг.', 'text', 'shared', 0, 3,
         NULL, NULL, NULL, NULL, NULL

  UNION ALL SELECT 'agreements', 'summary', 'Итог встречи',
         'Это увидит подопечный. Пара абзацев о главном.', 'text', 'shared', 0, 1,
         NULL, NULL, NULL, NULL, NULL

  UNION ALL SELECT 'manager_private', 'attrition_risk', 'Риск ухода',
         'Приватно. Проверка механизма видимости — не должно утечь в саммари.',
         'single_select', 'private', 0, 1,
         'attrition_risk', NULL, NULL, NULL, NULL
  UNION ALL SELECT 'manager_private', 'manager_notes', 'Мои заметки',
         'Приватно. Наблюдения, гипотезы, что проверить на следующей встрече.',
         'text', 'private', 0, 2,
         NULL, NULL, NULL, NULL, NULL
) f ON f.sk = ts.section_key
WHERE ts.version_id = (SELECT id FROM template_version WHERE version_no = 1);

------------------------------------------------------------------ опции
-- score обязателен для метричного select: без него поле не построится в график.
INSERT INTO template_field_option (field_id, option_key, label, score, color, position)
SELECT tf.id, o.option_key, o.label, o.score, o.color, o.position
FROM template_field tf
JOIN (
  SELECT 'low'    AS option_key, 'Низкий'  AS label, 0.0 AS score, '#2f9e44' AS color, 1 AS position
  UNION ALL SELECT 'medium', 'Средний', 0.5, '#e8a33d', 2
  UNION ALL SELECT 'high',   'Высокий', 1.0, '#c92a2a', 3
) o
WHERE tf.field_key = 'attrition_risk';

------------------------------------------------------------------ настройки
INSERT INTO app_setting (owner_id, key, value) VALUES
  (1, 'locale', 'ru'),
  (1, 'onboarded', 'false');
