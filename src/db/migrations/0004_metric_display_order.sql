-- Metric order in dropdowns came from the alphabet, so the comparison screen opened on
-- whichever metric happened to sort first — at one point the private attrition-risk
-- assessment. The first screen has to be meaningful, so the order becomes data.

ALTER TABLE metric ADD COLUMN display_order INTEGER NOT NULL DEFAULT 100;

UPDATE metric SET display_order = CASE key
  WHEN 'job_satisfaction'       THEN 1
  WHEN 'growth_clarity'         THEN 2
  WHEN 'team_direction_clarity' THEN 3
  WHEN 'energy'                 THEN 4
  WHEN 'workload'               THEN 5
  WHEN 'feedback_recognition'   THEN 6
  WHEN 'team_relationships'     THEN 7
  WHEN 'attrition_risk'         THEN 90
  ELSE 100
END;
