-- A birthday, so the dashboard can say "in three days" before the day arrives.
--
-- Three integer columns rather than one date: the year is optional. Many people would
-- rather not tell their manager how old they are, and a date column would have to invent
-- a year to hold "the twelfth of November" at all. Month and day go together (both set or
-- both empty, which the domain parser guarantees); the year may stand alone as missing.
-- Separate columns also keep "whose birthday is in November" a plain WHERE, in line with
-- CLAUDE.md rule 3.
--
-- Not part of a shared snapshot: it is the manager's reminder, and the person already
-- knows when they were born.

ALTER TABLE person ADD COLUMN birth_month INTEGER
  CHECK (birth_month IS NULL OR (birth_month BETWEEN 1 AND 12));
ALTER TABLE person ADD COLUMN birth_day INTEGER
  CHECK (birth_day IS NULL OR (birth_day BETWEEN 1 AND 31));
ALTER TABLE person ADD COLUMN birth_year INTEGER
  CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2100));
