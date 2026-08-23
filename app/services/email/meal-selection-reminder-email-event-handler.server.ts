/**
 * EmailEvent handler — meal selection reminder (EMAIL-6E).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import { getDeliveryCutoffStatus } from "../../utils/deliveryDate";
import db from "../../db.server";
import { getPortalModificationBlockReason } from "../subscriptionModificationBlock.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { EmailEventHandler } from "./email-event-handlers.server";
import type { EmailEventRecord } from "./email-event.server";
import {
  classifyEmailSendFailureForEmailEvent,
  EMAIL_EVENT_REFERENCE_TYPE_SUBSCRIPTION_SELECTION,
  EmailEventMetaParseError,
  parseEmailEventDeliveryDateMeta,
  stampMealSelectionReminderForDelivery,
} from "./email-outbox-campaign.server";
import {
  buildMealSelectionReminderEmailData,
  hasExplicitMealSelectionForDelivery,
  isMealSelectionReminderAlreadySentForDelivery,
  isMealSelectionReminderSendWindowOpen,
  resolveMealSelectionCycle,
  resolveSubscriptionEmailRecipient,
  shouldSendMealSelectionReminderEmail,
} from "./meal-selection-email.server";

const PORTAL_RECOVERY_STATUSES = [
  RECOVERY_STATUS.RETRY_SCHEDULED,
  RECOVERY_STATUS.PROCESSING,
  RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
  RECOVERY_STATUS.EMAIL_SEND_FAILED,
  RECOVERY_STATUS.FINAL_FAILED,
] as const;

const resolveHandlerDb = () => testHandlerDb ?? db;

/** @internal Mileyo business regression tests only. */
export const __setMealSelectionReminderEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetMealSelectionReminderEmailEventTestDb = (): void => {
  testHandlerDb = null;
};

let testHandlerDb: typeof db | null = null;

const cancelled = (reason: string) =>
  ({ outcome: "cancelled" as const, reason });

const loadLatestRecovery = async (
  shop: string,
  selectionId: string,
) => {
  const recoveries = await resolveHandlerDb().subscriptionPaymentRecovery.findMany({
    orderBy: { updatedAt: "desc" },
    take: 1,
    where: {
      shop,
      status: { in: [...PORTAL_RECOVERY_STATUSES] },
      subscriptionMealSelectionId: selectionId,
    },
  });

  return recoveries[0] ?? null;
};

export const processMealSelectionReminderEmailEvent = async ({
  event,
  now,
}: {
  event: EmailEventRecord;
  now: Date;
}) => {
  let deliveryDate: string;

  try {
    ({ deliveryDate } = parseEmailEventDeliveryDateMeta(event.metaJson));
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

  if (event.eventType !== EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER}`,
      outcome: "permanent_failure" as const,
    };
  }

  const selection = await resolveHandlerDb().subscriptionMealSelection.findUnique({
    where: { id: event.referenceId },
  });

  if (!selection) {
    return cancelled("selection_missing");
  }

  if (
    isMealSelectionReminderAlreadySentForDelivery({
      effectiveDeliveryDate: deliveryDate,
      mealSelectionReminderDeliveryDate: selection.mealSelectionReminderDeliveryDate,
    })
  ) {
    return {
      outcome: "sent" as const,
      providerId: event.providerId ?? undefined,
    };
  }

  if (!isMileyoTransactionalEmailEnabled()) {
    return cancelled("transactional_emails_disabled");
  }

  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection, now);

  if (!effectiveDeliveryDate || effectiveDeliveryDate !== deliveryDate) {
    return cancelled("delivery_cycle_mismatch");
  }

  if (!isMealSelectionReminderSendWindowOpen(now)) {
    return cancelled("outside_send_window");
  }

  if (selection.active !== true || selection.status !== "active") {
    return cancelled("inactive");
  }

  if (!selection.subscriptionContractId?.trim()) {
    return cancelled("inactive");
  }

  const cutoff = getDeliveryCutoffStatus(effectiveDeliveryDate, now);

  if (!cutoff.isKnown || cutoff.isPassed) {
    return cancelled("cutoff_passed");
  }

  if (
    hasExplicitMealSelectionForDelivery({
      effectiveDeliveryDate,
      mealSelectionLastExplicitDeliveryDate:
        selection.mealSelectionLastExplicitDeliveryDate,
    })
  ) {
    return cancelled("explicit_selection");
  }

  const recovery = await loadLatestRecovery(selection.shop, selection.id);
  const blockReason = getPortalModificationBlockReason(
    {
      active: selection.active,
      lastBillingAttemptAt: selection.lastBillingAttemptAt ?? null,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus ?? null,
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate ?? null,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
      resumeAttemptOrderId: selection.resumeAttemptOrderId ?? null,
      resumeAttemptStatus: selection.resumeAttemptStatus ?? null,
      status: selection.status ?? "active",
      subscriptionContractId: selection.subscriptionContractId ?? null,
    },
    recovery,
    now,
  );

  if (blockReason && blockReason !== "cutoff_passed") {
    return cancelled("blocked");
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

  const mealsCount = selection.mealsCount ?? 0;

  if (mealsCount <= 0) {
    return cancelled("invalid_meals_count");
  }

  const hasExplicitSelection = hasExplicitMealSelectionForDelivery({
    effectiveDeliveryDate,
    mealSelectionLastExplicitDeliveryDate:
      selection.mealSelectionLastExplicitDeliveryDate,
  });

  const eligible = shouldSendMealSelectionReminderEmail({
    active: selection.active,
    effectiveDeliveryDate,
    hasExplicitSelection,
    hasRecipient: true,
    mealSelectionReminderDeliveryDate: selection.mealSelectionReminderDeliveryDate,
    now,
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
    transactionalEmailsEnabled: true,
  });

  if (!eligible) {
    return cancelled("not_eligible");
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail(
    {
      data: buildMealSelectionReminderEmailData({
        customerName,
        effectiveDeliveryDate,
        mealsCount,
        shop: selection.shop,
      }),
      subject: "N'oubliez pas de choisir vos repas",
      template: "meal-selection-reminder",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampMealSelectionReminderForDelivery({
    deliveryDate,
    selectionId: selection.id,
  });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const mealSelectionReminderEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processMealSelectionReminderEmailEvent({ event, now });
