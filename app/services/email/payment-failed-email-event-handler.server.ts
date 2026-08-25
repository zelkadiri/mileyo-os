/**
 * EmailEvent handler — payment failed (EMAIL-6F).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import {
  ACTIVE_RECOVERY_STATUSES,
  RECOVERY_STATUS,
} from "../../constants/subscriptionPaymentRecovery";
import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY,
  stampPaymentFailedEmailSentAt,
} from "./email-outbox-event-driven.server";
import {
  buildPaymentFailedEmailData,
  formatPaymentEmailDateTime,
  resolvePaymentEmailRecipient,
} from "./payment-email.server";
import { buildSubscriptionPortalUrl } from "./subscription-email.server";

let testHandlerDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setPaymentFailedEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetPaymentFailedEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

const resolveHandlerDb = () => testHandlerDb ?? db;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

const PAYMENT_PROBLEM_STATUSES = [
  ...ACTIVE_RECOVERY_STATUSES,
  RECOVERY_STATUS.FINAL_FAILED,
] as const;

export const processPaymentFailedEmailEvent = async ({
  event,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  if (
    event.referenceType !==
    EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY
  ) {
    return {
      errorCode: "invalid_reference_type",
      message: `expected referenceType=${EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_PAYMENT_RECOVERY}`,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.eventType !== EMAIL_EVENT_TYPE.PAYMENT_FAILED) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.PAYMENT_FAILED}`,
      outcome: "permanent_failure" as const,
    };
  }

  const recovery =
    await resolveHandlerDb().subscriptionPaymentRecovery.findUnique({
      where: { id: event.referenceId },
    });

  if (!recovery) {
    return cancelled("recovery_missing");
  }

  if (recovery.paymentFailedEmailSentAt) {
    return {
      outcome: "sent" as const,
      providerId: event.providerId ?? undefined,
    };
  }

  if (recovery.status === RECOVERY_STATUS.RECOVERED) {
    return cancelled("recovery_recovered");
  }

  if (
    !(PAYMENT_PROBLEM_STATUSES as readonly string[]).includes(recovery.status)
  ) {
    return cancelled("payment_problem_inactive");
  }

  const selection =
    await resolveHandlerDb().subscriptionMealSelection.findUnique({
      where: { id: recovery.subscriptionMealSelectionId },
    });

  if (!selection) {
    return cancelled("selection_missing");
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

  const { customerName, recipient } = resolvePaymentEmailRecipient(
    selection,
    order,
  );

  if (!recipient) {
    return cancelled("no_recipient");
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail(
    {
      data: buildPaymentFailedEmailData({
        customerName,
        failureCount: recovery.failureCount,
        nextRetryAt: formatPaymentEmailDateTime(recovery.nextRetryAt),
        portalUrl: buildSubscriptionPortalUrl({ shop: selection.shop }),
        recoveryId: recovery.id,
        subscriptionContractId: selection.subscriptionContractId,
      }),
      subject: "Votre paiement d’abonnement n’a pas abouti",
      template: "payment-failed",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampPaymentFailedEmailSentAt({ recoveryId: recovery.id });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const paymentFailedEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processPaymentFailedEmailEvent({ event, now });
