/**
 * EmailEvent handler — subscription created (EMAIL-6F).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  stampSubscriptionCreatedEmailSentAt,
} from "./email-outbox-event-driven.server";
import {
  buildSubscriptionCreatedEmailData,
  resolveSubscriptionEmailRecipient,
} from "./subscription-email.server";

let testHandlerDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setSubscriptionCreatedEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetSubscriptionCreatedEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

const resolveHandlerDb = () => testHandlerDb ?? db;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

export const processSubscriptionCreatedEmailEvent = async ({
  event,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  if (event.referenceType !== EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION) {
    return {
      errorCode: "invalid_reference_type",
      message: `expected referenceType=${EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION}`,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.eventType !== EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED}`,
      outcome: "permanent_failure" as const,
    };
  }

  const selection =
    await resolveHandlerDb().subscriptionMealSelection.findUnique({
      where: { id: event.referenceId },
    });

  if (!selection) {
    return cancelled("selection_missing");
  }

  if (selection.subscriptionCreatedEmailSentAt) {
    return {
      outcome: "sent" as const,
      providerId: event.providerId ?? undefined,
    };
  }

  if (!selection.subscriptionContractId?.trim()) {
    return cancelled("missing_contract");
  }

  if (selection.status !== "active" || selection.active !== true) {
    return cancelled("inactive");
  }

  if (!isMileyoTransactionalEmailEnabled()) {
    return cancelled("transactional_emails_disabled");
  }

  const order = await resolveHandlerDb().boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolveSubscriptionEmailRecipient(
    selection,
    order,
  );

  if (!recipient) {
    return cancelled("no_recipient");
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail(
    {
      data: buildSubscriptionCreatedEmailData({
        customerName,
        mealsCount: selection.mealsCount,
        nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
        shop: selection.shop,
      }),
      subject: "Votre abonnement Mileyo est confirmé",
      template: "subscription-created",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampSubscriptionCreatedEmailSentAt({ selectionId: selection.id });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const subscriptionCreatedEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processSubscriptionCreatedEmailEvent({ event, now });
