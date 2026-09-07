/**
 * Domain errors carry a stable code plus parameters, never a sentence.
 *
 * Two reasons. The domain must not decide how a message reads to a person — that is the
 * view's job and it depends on the viewer's locale. And a code keeps user-facing wording
 * inside the dictionaries, where translations live (see CLAUDE.md rule 1).
 *
 * `message` is filled with the code and its parameters so server logs and stack traces
 * stay readable without a dictionary lookup.
 */
export type ErrorParams = Record<string, string | number>;

export class CodedError extends Error {
  constructor(readonly code: string, readonly params: ErrorParams = {}) {
    const rendered = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    super(rendered === "" ? code : `${code} ${rendered}`);
    this.name = new.target.name;
  }
}

/** Editing a template or its fields, sections and options. */
export class TemplateEditError extends CodedError {}

/** Creating or changing a metric. */
export class MetricEditError extends CodedError {}

/** An answer that does not fit its field. */
export class AnswerValidationError extends CodedError {}

/** Building a snapshot for the person the manager meets. */
export class SnapshotError extends CodedError {}

/**
 * Private content reached a sharing surface. Not an ordinary failure: it is the one bug
 * that damages a relationship rather than data, so it is loud and separate.
 */
export class PrivacyLeakError extends CodedError {}
