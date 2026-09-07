-- The summary showed the "Agreements" heading twice: the template section holding the
-- closing text, and the block of actual agreements. The section is renamed.
--
-- Only label/title change: section_key and field_key are left alone, because they are the
-- identity of the question and history and charts depend on their continuity.

UPDATE template_section
SET title = 'Итог',
    description = 'Что записать словами по итогам встречи. Конкретные пункты — в договорённостях ниже.'
WHERE section_key = 'agreements';

UPDATE template_field
SET label = 'Итог своими словами'
WHERE field_key = 'summary';
