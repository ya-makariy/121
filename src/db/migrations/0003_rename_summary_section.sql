-- The summary showed the "Agreements" heading twice: the template section holding the
-- closing text, and the block of actual agreements. The section is renamed.
--
-- Only label/title change: section_key and field_key are left alone, because they are the
-- identity of the question and history and charts depend on their continuity.

UPDATE template_section
SET title = 'Wrap-up',
    description = 'What to put in words at the end of the meeting. Concrete items go into the agreements below.'
WHERE section_key = 'agreements';

UPDATE template_field
SET label = 'Wrap-up in your own words'
WHERE field_key = 'summary';
