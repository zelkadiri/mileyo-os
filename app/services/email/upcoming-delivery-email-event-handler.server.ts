/**
 * EmailEvent handler — upcoming delivery (EMAIL-6E).
 * Send + business stamp only; EmailEvent transitions stay in the generic worker.
 */

import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import { EMAIL_EVENT_TYPE } from "../../constants/emailEvent";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../../constants/boxOrder";
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
  stampUpcomingDeliveryForDelivery,
} from "./email-outbox-campaign.server";
import { getMerchantSupportContact } from "../../utils/merchantSupport.server";
import {
  buildUpcomingDeliveryEmailData,
  hasUsableUpcomingDeliveryMeals,
  isUpcomingDeliveryCutoffSatisfied,
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  isUpcomingDeliveryEmailSendWindowOpen,
  resolveSubscriptionEmailRecipient,
  resolveUpcomingDeliveryCycle,
  shouldSendUpcomingDeliveryEmail,
} from "./upcoming-delivery-email.server";
import { getSelectedMealsFromJson } from "../../utils/mealSelection";

const PORTAL_RECOVERY_STATUSES = [
  RECOVERY_STATUS.RETRY_SCHEDULED,
  RECOVERY_STATUS.PROCESSING,
  RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
  RECOVERY_STATUS.EMAIL_SEND_FAILED,
  RECOVERY_STATUS.FINAL_FAILED,
] as const;

const resolveHandlerDb = () => testHandlerDb ?? db;

/** @internal Mileyo business regression tests only. */
export const __setUpcomingDeliveryEmailEventTestDb = (
  client: typeof db | null,
): void => {
  testHandlerDb = client;
};

/** @internal Mileyo business regression tests only. */
export const __resetUpcomingDeliveryEmailEventTestDb = (): void => {
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

const loadMatchingBoxOrderProof = async ({
  deliveryDate,
  selectionId,
  shop,
}: {
  deliveryDate: string;
  selectionId: string;
  shop: string;
}) =>
  resolveHandlerDb().boxOrder.findFirst({
    select: {
      scheduledDeliveryDate: true,
      simulated: true,
      subscriptionSelectionId: true,
    },
    where: {
      shop,
      scheduledDeliveryDate: deliveryDate,
      subscriptionSelectionId: selectionId,
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
    },
  });

export const processUpcomingDeliveryEmailEvent = async ({
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

  if (event.eventType !== EMAIL_EVENT_TYPE.UPCOMING_DELIVERY) {
    return {
      errorCode: "invalid_event_type",
      message: `expected eventType=${EMAIL_EVENT_TYPE.UPCOMING_DELIVERY}`,
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
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate: deliveryDate,
      upcomingDeliveryEmailDeliveryDate: selection.upcomingDeliveryEmailDeliveryDate,
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

  const { effectiveDeliveryDate } = resolveUpcomingDeliveryCycle(selection, now);

  if (!effectiveDeliveryDate || effectiveDeliveryDate !== deliveryDate) {
    return cancelled("delivery_cycle_mismatch");
  }

  if (
    !isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate,
      now,
    })
  ) {
    return cancelled("outside_send_window");
  }

  if (!isUpcomingDeliveryCutoffSatisfied(effectiveDeliveryDate, now)) {
    return cancelled("cutoff_not_passed");
  }

  if (selection.active !== true || selection.status !== "active") {
    return cancelled("inactive");
  }

  if (!selection.subscriptionContractId?.trim()) {
    return cancelled("inactive");
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

  const hasUsableMeals = hasUsableUpcomingDeliveryMeals({
    mealsCount: selection.mealsCount,
    selectedMeals: selection.selectedMeals,
  });

  if (!hasUsableMeals) {
    return cancelled("no_meals");
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

  const matchingBoxOrder = await loadMatchingBoxOrderProof({
    deliveryDate,
    selectionId: selection.id,
    shop: selection.shop,
  });

  if (
    !matchingBoxOrder ||
    matchingBoxOrder.simulated === true ||
    matchingBoxOrder.subscriptionSelectionId !== selection.id ||
    matchingBoxOrder.scheduledDeliveryDate !== deliveryDate
  ) {
    return cancelled("no_box_order");
  }

  const eligible = shouldSendUpcomingDeliveryEmail({
    active: selection.active,
    effectiveDeliveryDate,
    hasRecipient: true,
    hasUsableMeals,
    now,
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
    transactionalEmailsEnabled: true,
    upcomingDeliveryEmailDeliveryDate: selection.upcomingDeliveryEmailDeliveryDate,
  });

  if (!eligible) {
    return cancelled("not_eligible");
  }

  const merchantSupport = await getMerchantSupportContact(selection.shop);
  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
  const mealsCount = selection.mealsCount ?? 0;

  const emailData = buildUpcomingDeliveryEmailData({
    customerName,
    effectiveDeliveryDate,
    mealsCount,
    selectedMeals,
    shop: selection.shop,
    supportHref: merchantSupport.href,
    supportLabel: merchantSupport.label,
  });

  if (!emailData) {
    return cancelled("invalid_email_data");
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail(
    {
      data: emailData,
      subject: "Votre prochaine box Mileyo arrive bientôt",
      template: "upcoming-delivery",
      to: recipient,
    },
    { idempotencyKey: event.idempotencyKey },
  );

  if (!result.ok) {
    return classifyEmailSendFailureForEmailEvent(result);
  }

  await stampUpcomingDeliveryForDelivery({
    deliveryDate,
    selectionId: selection.id,
  });

  return {
    outcome: "sent" as const,
    providerId: result.id,
  };
};

export const upcomingDeliveryEmailEventHandler: EmailEventHandler = async ({
  event,
  now,
}) => processUpcomingDeliveryEmailEvent({ event, now });
