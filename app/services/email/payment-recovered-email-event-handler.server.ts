/**
 * EmailEvent handler — payment recovered (EMAIL-6F).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  EmailEventMetaParseError,
  parsePaymentRecoveredEmailEventMeta,
  stampPaymentRecoveredEmailSentAt,
} from "./email-outbox-event-driven.server";
import {
  buildPaymentRecoveredEmailData,
  resolvePaymentEmailRecipient,
} from "./payment-email.server";
import { buildSubscriptionPortalUrl } from "./subscription-email.server";

let testHandlerDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setPaymentRecoveredEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetPaymentRecoveredEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

const resolveHandlerDb = () => testHandlerDb ?? db;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

export const processPaymentRecoveredEmailEvent = async ({
  event,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  let orderId: string;
  let recoveryIds: string[];

  try {
    ({ orderId, recoveryIds } = parsePaymentRecoveredEmailEventMeta(
      event.metaJson,
    ));
  } catch (error) {
    const message =
      error instanceof EmailEventMetaParseError
        ? error.message
        : "invalid metaJson";
    return {
      errorCode: "invalid_meta",
      message,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.referenceType !== EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION) {
    return {
      errorCode: "invalid_reference_type",
      message: `expected referenceType=${EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION}`,
      outcome: "permanent_failure" as const,
    };
  }

  if (event.eventType !== EMAIL_EVENT_TYPE.PAYMENT_RECOVERED) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.PAYMENT_RECOVERED}`,
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

  const recoveries =
    await resolveHandlerDb().subscriptionPaymentRecovery.findMany({
      where: { id: { in: recoveryIds } },
    });

  if (recoveries.length !== recoveryIds.length) {
    return cancelled("recovery_ids_incomplete");
  }

  for (const recovery of recoveries) {
    if (recovery.subscriptionMealSelectionId !== selection.id) {
      return cancelled("recovery_selection_mismatch");
    }
    if (recovery.status !== RECOVERY_STATUS.RECOVERED) {
      return cancelled("recovery_not_recovered");
    }
  }

  if (recoveries.some((recovery) => recovery.paymentRecoveredEmailSentAt)) {
    await stampPaymentRecoveredEmailSentAt({ recoveryIds });
    return {
      outcome: "sent" as const,
      providerId: event.providerId ?? undefined,
    };
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
      data: buildPaymentRecoveredEmailData({
        customerName,
        orderId,
        portalUrl: buildSubscriptionPortalUrl({ shop: selection.shop }),
        recoveryId: recoveryIds[0] ?? null,
        subscriptionContractId: selection.subscriptionContractId,
      }),
      subject: "Votre paiement Mileyo est confirmé",
      template: "payment-recovered",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampPaymentRecoveredEmailSentAt({ recoveryIds });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const paymentRecoveredEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processPaymentRecoveredEmailEvent({ event, now });
