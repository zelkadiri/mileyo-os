/**
 * Generic email foundation types.
 * Domain-specific email payloads are added in later EMAIL steps.
 */

export type EmailRecipient = {
  email: string;
  name?: string;
};

/** Template identifiers known to the email layer. Expand as templates are added. */
export type EmailTemplateName = "test";

export type EmailPayload<TData = Record<string, unknown>> = {
  /** Optional override; otherwise uses process.env.EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  subject: string;
  template: EmailTemplateName;
  to: EmailRecipient | EmailRecipient[];
  data?: TData;
};

export type EmailSendSuccess = {
  ok: true;
  id: string;
};

export type EmailSendFailure = {
  ok: false;
  reason:
    | "missing_api_key"
    | "missing_sender"
    | "render_error"
    | "send_error"
    | "unknown_template";
  message: string;
};

export type EmailSendResult = EmailSendSuccess | EmailSendFailure;

export type EmailRenderResult = {
  html: string;
  text: string;
};
