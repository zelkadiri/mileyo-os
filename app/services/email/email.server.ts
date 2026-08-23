import {
  createEmailClient,
  getEmailFrom,
  getResendApiKey,
} from "./email-client.server";
import {
  mapResendSendError,
  resolveSendEmailIdempotencyKey,
} from "./email-resend-errors.server";
import { renderEmailTemplate } from "./email-render.server";
import type {
  EmailPayload,
  EmailRecipient,
  EmailSendResult,
  SendEmailOptions,
} from "./email.types";

type SendEmailTestDeps = {
  createClient?: typeof createEmailClient;
};

let sendEmailTestDeps: SendEmailTestDeps = {};

/** @internal Mileyo business regression tests only. */
export const __setSendEmailTestDeps = (deps: SendEmailTestDeps): void => {
  sendEmailTestDeps = deps;
};

/** @internal Mileyo business regression tests only. */
export const __resetSendEmailTestDeps = (): void => {
  sendEmailTestDeps = {};
};

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
  options?: SendEmailOptions,
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

  const clientFactory = sendEmailTestDeps.createClient ?? createEmailClient;
  const client = clientFactory();
  if (!client) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "RESEND_API_KEY is not configured",
    };
  }

  const idempotency = resolveSendEmailIdempotencyKey(options?.idempotencyKey);
  if ("ok" in idempotency) {
    return idempotency;
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

  const requestOptions =
    idempotency.mode === "present"
      ? { idempotencyKey: idempotency.key }
      : undefined;

  const { data, error } = await client.emails.send(
    {
      from,
      to,
      subject: payload.subject,
      html,
      text,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    },
    requestOptions,
  );

  if (error) {
    return mapResendSendError(error);
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
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  getEmailFrom,
  getResendApiKey,
  isMileyoTransactionalEmailEnabled,
  RESEND_API_KEY_ENV,
} from "./email-client.server";
export {
  buildPaymentFailedEmailData,
  buildPaymentRecoveredEmailData,
  formatPaymentEmailDateTime,
  resolvePaymentEmailRecipient,
  shouldSendPaymentFailedEmail,
  shouldSendPaymentRecoveredEmail,
} from "./payment-email.server";
export {
  buildSubscriptionCreatedEmailData,
  buildSubscriptionPausedEmailData,
  buildSubscriptionPortalUrl,
  formatSubscriptionEmailDateTime,
  formatSubscriptionEmailDeliveryDate,
  isAllowedSubscriptionPauseCause,
  resolveSubscriptionEmailRecipient,
  shouldSendSubscriptionCreatedEmail,
  shouldSendSubscriptionPausedEmail,
  trySendSubscriptionCreatedEmail,
  trySendSubscriptionPausedEmail,
  resetSubscriptionPausedEmailSentAt,
  SUBSCRIPTION_PAUSE_CAUSES_V1,
  SUBSCRIPTION_PORTAL_PATH,
} from "./subscription-email.server";
export {
  buildMealSelectionConfirmedEmailData,
  buildMealSelectionConfirmedEmailDataFromSelection,
  buildMealSelectionReminderEmailData,
  buildMealSelectionReminderEmailDataFromSelection,
  evaluateMealSelectionConfirmedEligibility,
  evaluateMealSelectionReminderEligibility,
  formatMealSelectionCutoffLabel,
  formatMealSelectionDeliveryDateLabel,
  hasExplicitMealSelectionForDelivery,
  isMealSelectionConfirmedAlreadySentForDelivery,
  isMealSelectionCutoffPassed,
  isMealSelectionCutoffUnknown,
  isMealSelectionReminderAlreadySentForDelivery,
  isMealSelectionReminderSendWindowOpen,
  markMealSelectionExplicitForCurrentDelivery,
  resolveMealSelectionCycle,
  resolveSubscriptionEmailRecipient as resolveMealSelectionEmailRecipient,
  shouldSendMealSelectionConfirmedEmail,
  shouldSendMealSelectionReminderEmail,
  trySendMealSelectionConfirmedEmail,
  trySendMealSelectionReminderEmail,
} from "./meal-selection-email.server";
export {
  buildUpcomingDeliveryEmailData,
  buildUpcomingDeliveryEmailDataFromSelection,
  evaluateUpcomingDeliveryEligibility,
  formatUpcomingDeliveryDateLabel,
  hasUsableUpcomingDeliveryMeals,
  isUpcomingDeliveryCutoffSatisfied,
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  isUpcomingDeliveryEmailSendWindowOpen,
  resolveUpcomingDeliveryCycle,
  resolveSubscriptionEmailRecipient as resolveUpcomingDeliveryEmailRecipient,
  shouldSendUpcomingDeliveryEmail,
  trySendUpcomingDeliveryEmail,
} from "./upcoming-delivery-email.server";
export {
  mapResendSendError,
  resolveSendEmailIdempotencyKey,
} from "./email-resend-errors.server";
export type { ResendSendError } from "./email-resend-errors.server";
export { renderEmailTemplate } from "./email-render.server";
export type {
  EmailPayload,
  EmailRecipient,
  EmailRenderResult,
  EmailSendFailure,
  EmailSendFailureReason,
  EmailSendResult,
  EmailTemplateName,
  SendEmailOptions,
  PaymentFailedEmailData,
  PaymentRecoveredEmailData,
  SubscriptionCreatedEmailData,
  SubscriptionPausedEmailData,
  MealSelectionConfirmedEmailData,
  MealSelectionReminderEmailData,
  UpcomingDeliveryEmailData,
  SubscriptionPauseCause,
} from "./email.types";
export type {
  MarkMealSelectionExplicitResult,
  MealSelectionCycle,
  MealSelectionEmailOrderSource,
  MealSelectionEmailSelectionSource,
  TrySendMealSelectionReminderResult,
} from "./meal-selection-email.server";
export type {
  UpcomingDeliveryCycle,
  TrySendUpcomingDeliveryEmailResult,
  UpcomingDeliveryEmailOrderSource,
  UpcomingDeliveryEmailSelectionSource,
} from "./upcoming-delivery-email.server";
export type {
  PaymentEmailOrderSource,
  PaymentEmailSelectionSource,
  ResolvedPaymentEmailRecipient,
} from "./payment-email.server";
export type {
  ResolvedSubscriptionEmailRecipient,
  SubscriptionEmailOrderSource,
  SubscriptionEmailSelectionSource,
} from "./subscription-email.server";
