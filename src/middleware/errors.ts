import type { ErrorHandler, NotFoundHandler } from "hono";
import { thm } from "./theme.ts";
import { AnswerValidationError, CodedError, PrivacyLeakError } from "../lib/errors.ts";
import { html } from "../views/html.ts";
import { layout } from "../views/layout.ts";
import { dict, errorMessage } from "../i18n/index.ts";
import { config } from "../config.ts";
import { loc } from "./locale.ts";

/** Falls back to the configured locale: an error can happen before the locale is set. */
function localeOf(c: Parameters<ErrorHandler>[1]): "ru" | "en" {
  try {
    return loc(c);
  } catch {
    return config.defaultLocale;
  }
}

export const onError: ErrorHandler = (err, c) => {
  const locale = localeOf(c);

  // A privacy leak is not "a 500": it is the guard doing its job, and it must be visible
  // in the log with the field names, not swallowed into a generic error page.
  if (err instanceof PrivacyLeakError) {
    console.error("[privacy]", err.message);
    return c.text(errorMessage(locale, err), 500);
  }

  // An invalid answer is the person's input, not a fault: it answers an HTMX request and
  // has to be short and readable in place.
  if (err instanceof AnswerValidationError) {
    return c.text(errorMessage(locale, err), 422);
  }

  const t = dict(locale);
  const text = err instanceof CodedError ? errorMessage(locale, err) : err.message;
  console.error("[error]", err);
  return c.html(
    layout({
      locale,
      theme: thm(c),
      title: t.errors.pageTitle,
      body: html`<h1>${t.errors.pageHeading}</h1><pre class="md">${text}</pre>`,
    }),
    500,
  );
};

export const onNotFound: NotFoundHandler = (c) => {
  const locale = localeOf(c);
  const t = dict(locale);
  return c.html(
    layout({
      locale,
      theme: thm(c),
      title: t.errors.notFoundTitle,
      body: html`
        <h1>404</h1>
        <p class="sub">${t.errors.notFoundText}</p>
        <p><a href="/">${t.errors.toDashboard}</a></p>
      `,
    }),
    404,
  );
};
