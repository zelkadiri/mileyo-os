import {
  createEmailClient,
  getEmailFrom,
  getResendApiKey,
} from "./email-client.server";
import { renderEmailTemplate } from "./email-render.server";
import type {
  EmailPayload,
  EmailRecipient,
  EmailSendResult,
} from "./email.types";

const normalizeRecipients = (
  to: EmailRecipient | EmailRecipient[],
): string[] => {
  const list = Array.isArray(to) ? to : [to];
  return list.map((recipient) => recipient.email.trim()).filter(Boolean);
};

const resolveSender = (payloadFrom?: string): string | null => {
  const override = payloadFrom?.trim();
  if (override) {
    return override;
  }
  return getEmailFrom();
};

/**
 * Internal email API — render a template and send via Resend.
 * No subscription / payment / meal logic.
 */
export const sendEmail = async (
  payload: EmailPayload,
): Promise<EmailSendResult> => {
  if (!getResendApiKey()) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "RESEND_API_KEY is not configured",
    };
  }

  const from = resolveSender(payload.from);
  if (!from) {
    console.warn("[EMAIL] Missing EMAIL_FROM");
    return {
      ok: false,
      reason: "missing_sender",
      message: "EMAIL_FROM is not configured",
    };
  }

  const client = createEmailClient();
  if (!client) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "RESEND_API_KEY is not configured",
    };
  }

  let html: string;
  let text: string;

  try {
    const rendered = await renderEmailTemplate(
      payload.template,
      payload.data ?? {},
    );
    html = rendered.html;
    text = rendered.text;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to render email template";

    if (message.startsWith("Unknown email template:")) {
      return {
        ok: false,
        reason: "unknown_template",
        message,
      };
    }

    return {
      ok: false,
      reason: "render_error",
      message,
    };
  }

  const to = normalizeRecipients(payload.to);
  if (to.length === 0) {
    return {
      ok: false,
      reason: "send_error",
      message: "At least one recipient email is required",
    };
  }

  const { data, error } = await client.emails.send({
    from,
    to,
    subject: payload.subject,
    html,
    text,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
  });

  if (error) {
    return {
      ok: false,
      reason: "send_error",
      message: error.message,
    };
  }

  if (!data?.id) {
    return {
      ok: false,
      reason: "send_error",
      message: "Resend returned no email id",
    };
  }

  return {
    ok: true,
    id: data.id,
  };
};

export {
  createEmailClient,
  EMAIL_FROM_ENV,
  getEmailFrom,
  getResendApiKey,
  RESEND_API_KEY_ENV,
} from "./email-client.server";
export { renderEmailTemplate } from "./email-render.server";
export type {
  EmailPayload,
  EmailRecipient,
  EmailRenderResult,
  EmailSendResult,
  EmailTemplateName,
} from "./email.types";
