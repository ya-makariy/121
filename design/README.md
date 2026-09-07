# design/ — визуальная спецификация

Здесь лежит то, из чего собран канвас редизайна, и то, на что ссылаются задачи `D*`
в [BACKLOG.md](../BACKLOG.md).

**Канвас:** <https://claude.ai/code/artifact/6d4087f0-7e2b-4560-b808-be70d4921476>

16 артбордов на одном полотне: путь встречи, люди, аналитика, шаблоны и лист токенов.
Над каждым рядом заметка о том, что изменено и почему. Артборды нарисованы не по
скриншотам, а из настоящего `public/app.css` и настоящей разметки страниц, снятой с
работающего сервера — поэтому то, что выглядит правильно на артборде, будет выглядеть
правильно в приложении.

## Что где

| Файл | Что это |
| --- | --- |
| `refine.css` | **Предложение.** Слой добавлений к `public/app.css`: токены, компоненты, правки. Задача `D1` начинает перенос этого файла в `public/app.css`. |
| `artboards/*.html` | Фрагменты `<body>` — по одному на экран. Только разметка; стили берутся из `app.css` + `refine.css`. |
| `canvas.json` | Раскладка полотна: позиции, подписи, заметки. |
| `build.mjs` | Собирает артборды в `out/*.dc.html`, вклеивая стили. |
| `out/` | Производное, в `.gitignore`. |

## Пересборка

```sh
node design/build.mjs
```

Читает `public/app.css` **из репозитория**, поэтому правки в стилях сразу видны на
артбордах: правишь `app.css`, пересобираешь, открываешь `out/<Name>.dc.html` в браузере —
это обычная HTML-страница.

Обновить сам канвас (опубликованную страницу) отсюда нельзя: для этого нужен агент со
скиллом `/design`, который засеет `out/*.dc.html` вместе с `canvas.json` и опубликует по
той же ссылке.

## Артборд → страница → код

| Артборд | Страница | Вьюха | Роут |
| --- | --- | --- | --- |
| `Main` | Дашборд | `views/pages/dashboard.ts` | `GET /` |
| `People` | Люди | `views/pages/people.ts` → `peopleListPage` | `GET /people` |
| `Person` | Карточка человека | `views/pages/person.ts` | `GET /people/:id` |
| `PersonNew` | Новый человек | `views/pages/people.ts` → `personFormPage` | `GET /people/new` |
| `PersonEdit` | Правка человека | `views/pages/people.ts` → `personFormPage` | `GET /people/:id/edit` |
| `Meeting` | Встреча, заполнение | `views/pages/meeting.ts` | `GET /meetings/:id` (черновик) |
| `MeetingDone` | Встреча, завершена | `views/pages/meeting.ts` | `GET /meetings/:id` (`completed`) |
| `Share` | Саммари для подопечного | `views/pages/share.ts` | `GET /s/:token` |
| `Compare` | Сравнение | `views/pages/compare.ts` | `GET /compare` |
| `Actions` | Договорённости | `views/pages/misc.ts` → `actionsPage` | `GET /actions` |
| `Templates` | Шаблоны | `views/pages/misc.ts` → `templatesPage` | `GET /templates` |
| `TemplateEditor` | Конструктор шаблона | `views/pages/template-editor.ts` | `GET /templates/:id` |
| `TemplateVersions` | Версии шаблона | `views/pages/template-versions.ts` | `GET /templates/:id/versions` |
| `Metrics` | Метрики | `views/pages/metrics.ts` | `GET /metrics` |
| `Settings` | Настройки | `views/pages/misc.ts` → `settingsPage` | `GET /settings` |
| `Foundation` | Лист токенов | — | — |

`Foundation` не соответствует странице приложения: это справочник токенов, типографики,
бейджей, контролов и палитры серий. Отдельные артборды `Meeting` и `MeetingDone` — это
два режима одной вьюхи, редактируемый и read-only, которые
`views/components/field-input.ts` рендерит одной функцией (правило 6).

## Содержимое артбордов

`design/` не попадает под проверку `tests/language.test.ts`: она сканирует `src/`,
`scripts/` и `tests/`. Кириллица в артбордах — это макетный пользовательский текст, а не
код, поэтому здесь она уместна; комментарии в `refine.css` и `build.mjs` всё равно
английские, как везде (правило 1).

Все имена, роли, адреса и ссылки — выдуманные плейсхолдеры (`example.com`), правило 9.
Ни одна строка не взята из локальной базы. Числа внутри артбордов согласованы между
собой: счётчики полей на `Templates`, `TemplateVersions` и в рельсе `Meeting` сходятся,
версия v2 — черновик без встреч (правило 5), а точки на графике `Compare` — это ровно
то нормирование 1–5 → 0–100%, которое рисует `Person`.
