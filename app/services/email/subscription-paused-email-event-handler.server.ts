/**
 * EmailEvent handler — subscription paused (EMAIL-6F).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import type { SubscriptionPauseCause } from "./email.types";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  EmailEventMetaParseError,
  parseSubscriptionPausedEmailEventMeta,
  stampSubscriptionPausedEmailSentAt,
} from "./email-outbox-event-driven.server";
import {
  buildSubscriptionPausedEmailData,
  resolveSubscriptionEmailRecipient,
} from "./subscription-email.server";

let testHandlerDb: typeof db | null = null;

/** @internal Mileyo business regression tests only. */
export const __setSubscriptionPausedEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetSubscriptionPausedEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

const resolveHandlerDb = () => testHandlerDb ?? db;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

const SUBSCRIPTION_PAUSED_EMAIL_SUBJECTS: Record<
  SubscriptionPauseCause,
  string
> = {
  payment_final_failure: "Votre abonnement a été suspendu",
  user_voluntary: "Votre abonnement est en pause",
};

export const processSubscriptionPausedEmailEvent = async ({
  event,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  let episodeId: string;
  let cause: SubscriptionPauseCause;

  try {
    ({ cause, episodeId } = parseSubscriptionPausedEmailEventMeta(
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

  if (event.eventType !== EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED}`,
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

  if (selection.subscriptionPauseEmailEpisodeId !== episodeId) {
    return cancelled("episode_mismatch");
  }

  if (selection.status !== "paused" || selection.active === true) {
    return cancelled("not_paused");
  }

  if (selection.subscriptionPausedEmailSentAt) {
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
      data: buildSubscriptionPausedEmailData({
        customerName,
        pauseCause: cause,
        shop: selection.shop,
      }),
      subject: SUBSCRIPTION_PAUSED_EMAIL_SUBJECTS[cause],
      template: "subscription-paused",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampSubscriptionPausedEmailSentAt({ selectionId: selection.id });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const subscriptionPausedEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processSubscriptionPausedEmailEvent({ event, now });
