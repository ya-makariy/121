import type { ErrorHandler, NotFoundHandler } from "hono";
import { AnswerValidationError } from "../domain/answers.ts";
import { PrivacyLeakError } from "../domain/snapshot.ts";
import { html } from "../views/html.ts";
import { layout } from "../views/layout.ts";
import { config } from "../config.ts";

export const onError: ErrorHandler = (err, c) => {
  // Утечка приватного — не «ошибка 500», а событие, которое должно быть видно.
  if (err instanceof PrivacyLeakError) {
    console.error("[ПРИВАТНОСТЬ]", err.message);
    return c.text(`Сборка саммари остановлена: ${err.message}`, 500);
  }
  if (err instanceof AnswerValidationError) {
    return c.text(err.message, 422);
  }
  console.error("[ошибка]", err);
  return c.html(
    layout({
      locale: config.defaultLocale,
      title: "Ошибка",
      body: html`<h1>Что-то сломалось</h1><pre class="md">${err.message}</pre>`,
    }),
    500,
  );
};

export const onNotFound: NotFoundHandler = (c) =>
  c.html(
    layout({
      locale: config.defaultLocale,
      title: "404",
      body: html`<h1>404</h1><p class="sub">Такой страницы нет.</p><p><a href="/">На дашборд</a></p>`,
    }),
    404,
  );
