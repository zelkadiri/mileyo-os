/**
 * EmailEvent outbox helpers for scheduled campaign emails (EMAIL-6E).
 * Idempotency keys, meta parsing, transport failure mapping, business stamps.
 */

import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import type { EmailEventHandlerResult } from "./email-event-handlers.server";
import {
  parseEmailEventMeta,
  serializeEmailEventMeta,
  type EmailEventRecord,
} from "./email-event.server";
import type { EmailSendFailure, EmailSendFailureReason } from "./email.types";

let testCampaignDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setEmailOutboxCampaignTestDb = (client: typeof db | null): void => {
  testCampaignDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetEmailOutboxCampaignTestDb = (): void => {
  testCampaignDb = null;
};

const resolveCampaignDb = () => testCampaignDb ?? db;

export const EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION =
  "subscription_selection";

const DELIVERY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type EmailEventDeliveryDateMeta = {
  deliveryDate: string;
};

export class EmailEventMetaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailEventMetaParseError";
  }
}

export const buildMealSelectionReminderEmailEventIdempotencyKey = (
  selectionId: string,
  effectiveDeliveryDate: string,
): string =>
  `meal_selection_reminder:${selectionId}:${effectiveDeliveryDate}`;

export const buildUpcomingDeliveryEmailEventIdempotencyKey = (
  selectionId: string,
  effectiveDeliveryDate: string,
): string => `upcoming_delivery:${selectionId}:${effectiveDeliveryDate}`;

export const parseEmailEventDeliveryDateMeta = (
  metaJson: string | null | undefined,
): EmailEventDeliveryDateMeta => {
  const parsed = parseEmailEventMeta(metaJson);

  if (!parsed) {
    throw new EmailEventMetaParseError("EmailEvent metaJson is required");
  }

  const deliveryDate = parsed.deliveryDate;

  if (typeof deliveryDate !== "string" || !DELIVERY_DATE_PATTERN.test(deliveryDate)) {
    throw new EmailEventMetaParseError(
      "EmailEvent metaJson.deliveryDate must be YYYY-MM-DD",
    );
  }

  return { deliveryDate };
};

export const buildCampaignEmailEventMetaJson = (
  deliveryDate: string,
): string => serializeEmailEventMeta({ deliveryDate });

const RETRYABLE_SEND_FAILURE_REASONS = new Set<EmailSendFailureReason>([
  "rate_limit_exceeded",
  "send_error",
  "concurrent_idempotent_requests",
  "missing_api_key",
  "missing_sender",
]);

const PERMANENT_SEND_FAILURE_REASONS = new Set<EmailSendFailureReason>([
  "render_error",
  "unknown_template",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "validation_error",
]);

export const classifyEmailSendFailureForEmailEvent = (
  failure: EmailSendFailure,
): Extract<
  EmailEventHandlerResult,
  { outcome: "retryable_failure" | "permanent_failure" }
> => {
  const errorCode = failure.providerErrorCode ?? failure.reason;
  const message = failure.message;

  if (PERMANENT_SEND_FAILURE_REASONS.has(failure.reason)) {
    return {
      errorCode,
      message,
      outcome: "permanent_failure",
    };
  }

  if (RETRYABLE_SEND_FAILURE_REASONS.has(failure.reason)) {
    return {
      errorCode,
      message,
      outcome: "retryable_failure",
    };
  }

  return {
    errorCode,
    message,
    outcome: "retryable_failure",
  };
};

export const stampMealSelectionReminderForDelivery = async ({
  deliveryDate,
  selectionId,
  sentAt = new Date(),
}: {
  deliveryDate: string;
  selectionId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult = await resolveCampaignDb().subscriptionMealSelection.updateMany({
    data: {
      mealSelectionReminderDeliveryDate: deliveryDate,
      mealSelectionReminderEmailSentAt: sentAt,
    },
    where: {
      id: selectionId,
      OR: [
        { mealSelectionReminderDeliveryDate: null },
        { mealSelectionReminderDeliveryDate: { not: deliveryDate } },
      ],
    },
  });

  return updateResult.count > 0;
};

export const stampUpcomingDeliveryForDelivery = async ({
  deliveryDate,
  selectionId,
  sentAt = new Date(),
}: {
  deliveryDate: string;
  selectionId: string;
  sentAt?: Date;
}): Promise<boolean> => {
  const updateResult = await resolveCampaignDb().subscriptionMealSelection.updateMany({
    data: {
      upcomingDeliveryEmailDeliveryDate: deliveryDate,
      upcomingDeliveryEmailSentAt: sentAt,
    },
    where: {
      id: selectionId,
      OR: [
        { upcomingDeliveryEmailDeliveryDate: null },
        { upcomingDeliveryEmailDeliveryDate: { not: deliveryDate } },
      ],
    },
  });

  return updateResult.count > 0;
};

export const backfillMealSelectionReminderStampFromSentEvent = async ({
  deliveryDate,
  event,
  selectionId,
}: {
  deliveryDate: string;
  event: EmailEventRecord;
  selectionId: string;
}): Promise<boolean> => {
  if (event.status !== "sent" || event.eventType !== EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER) {
    return false;
  }

  return stampMealSelectionReminderForDelivery({
    deliveryDate,
    selectionId,
    sentAt: event.sentAt ?? new Date(),
  });
};

export const backfillUpcomingDeliveryStampFromSentEvent = async ({
  deliveryDate,
  event,
  selectionId,
}: {
  deliveryDate: string;
  event: EmailEventRecord;
  selectionId: string;
}): Promise<boolean> => {
  if (event.status !== "sent" || event.eventType !== EMAIL_EVENT_TYPE.UPCOMING_DELIVERY) {
    return false;
  }

  return stampUpcomingDeliveryForDelivery({
    deliveryDate,
    selectionId,
    sentAt: event.sentAt ?? new Date(),
  });
};
