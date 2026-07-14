import type { DeliveryRescheduleReason } from "../constants/deliverySchedule";
import db from "../db.server";
import {
  computeNextBillingDateFromCurrentDelivery,
  computeNextWeeklyDeliveryDate,
  computeRenewalDeliveryDate,
  getWeekday,
  projectActiveScheduledDeliveryDate,
  referenceDateFromInstant,
  scheduleDeliveryDate,
  type DeliveryDateString,
} from "../utils/deliveryDate";
import {
  getDeliveryDateFromLineItemProperties,
  type LineItemProperty,
} from "../utils/orderLineItemProperties";
import {
  fetchSubscriptionContractNextBillingDate,
  setSubscriptionContractNextBillingDate,
  type ShopifyAdminGraphql,
} from "./subscriptionBillingWorker.server";

export type FirstOrderDeliveryScheduleResolution = {
  deliveryRescheduleReason: DeliveryRescheduleReason | null;
  desiredDeliveryDate: DeliveryDateString;
  preferredDeliveryWeekday: number;
  referenceDate: DeliveryDateString;
  scheduledDeliveryDate: DeliveryDateString;
};

export type RenewalDeliveryScheduleResolution = {
  deliveryRescheduleReason: DeliveryRescheduleReason | null;
  desiredDeliveryDate: DeliveryDateString;
  referenceDate: DeliveryDateString;
  scheduledDeliveryDate: DeliveryDateString;
};

export type DeliveryScheduleLogEvent = "scheduled" | "rescheduled" | "skipped";

export type FirstOrderBillingAlignment = {
  alignedNextBillingDate: Date;
  firstDeliveryDate: DeliveryDateString;
  nextDeliveryDate: DeliveryDateString;
};

export type AlignFirstOrderBillingResult =
  | {
      alignedNextBillingDate: Date;
      firstDeliveryDate: DeliveryDateString;
      nextDeliveryDate: DeliveryDateString;
      previousNextBillingDate: Date | null;
      status: "aligned";
    }
  | { reason: string; status: "skipped" }
  | { error: string; status: "failed" };

export type AlignRenewalBillingResult = AlignFirstOrderBillingResult;

const alignBillingWithDeliverySchedule = async ({
  admin,
  alignedNextBillingDate,
  currentDeliveryDate,
  nextDeliveryDate,
  selectionId,
  shopifyOrderId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  alignedNextBillingDate: Date;
  currentDeliveryDate: DeliveryDateString;
  nextDeliveryDate: DeliveryDateString;
  selectionId: string;
  shopifyOrderId: string;
  subscriptionContractId: string;
}): Promise<AlignFirstOrderBillingResult> => {
  let previousNextBillingDate: Date | null = null;

  try {
    previousNextBillingDate = await fetchSubscriptionContractNextBillingDate(
      admin,
      subscriptionContractId,
    );
  } catch (error) {
    console.log("[BILLING_ALIGNMENT] previous nextBillingDate fetch failed", {
      error: error instanceof Error ? error.message : error,
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
    });
  }

  try {
    const shopifyUpdate = await setSubscriptionContractNextBillingDate(
      admin,
      subscriptionContractId,
      alignedNextBillingDate,
    );

    if (!shopifyUpdate.ok) {
      console.log("[BILLING_ALIGNMENT] failed", {
        currentDeliveryDate,
        error: shopifyUpdate.error,
        nextDeliveryDate,
        previousNextBillingDate: previousNextBillingDate?.toISOString() ?? null,
        reason: "aligned_with_delivery_cutoff",
        selectionId,
        shopifyOrderId,
        subscriptionContractId,
        targetNextBillingDate: alignedNextBillingDate.toISOString(),
      });

      return { error: shopifyUpdate.error, status: "failed" };
    }

    await db.subscriptionMealSelection.update({
      data: { nextBillingDate: shopifyUpdate.nextBillingDate },
      where: { id: selectionId },
    });

    console.log("[BILLING_ALIGNMENT] aligned_with_delivery_cutoff", {
      alignedNextBillingDate: shopifyUpdate.nextBillingDate.toISOString(),
      currentDeliveryDate,
      nextDeliveryDate,
      previousNextBillingDate: previousNextBillingDate?.toISOString() ?? null,
      reason: "aligned_with_delivery_cutoff",
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
    });

    return {
      alignedNextBillingDate: shopifyUpdate.nextBillingDate,
      firstDeliveryDate: currentDeliveryDate,
      nextDeliveryDate,
      previousNextBillingDate,
      status: "aligned",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.log("[BILLING_ALIGNMENT] failed", {
      currentDeliveryDate,
      error: message,
      nextDeliveryDate,
      previousNextBillingDate: previousNextBillingDate?.toISOString() ?? null,
      reason: "aligned_with_delivery_cutoff",
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
      targetNextBillingDate: alignedNextBillingDate.toISOString(),
    });

    return { error: message, status: "failed" };
  }
};

export const resolveFirstOrderBillingAlignment = (
  firstDeliverySchedule: FirstOrderDeliveryScheduleResolution | null,
): FirstOrderBillingAlignment | null => {
  if (!firstDeliverySchedule) {
    return null;
  }

  const alignedNextBillingDate = computeNextBillingDateFromCurrentDelivery(
    firstDeliverySchedule.scheduledDeliveryDate,
  );

  if (!alignedNextBillingDate) {
    return null;
  }

  return {
    alignedNextBillingDate,
    firstDeliveryDate: firstDeliverySchedule.scheduledDeliveryDate,
    nextDeliveryDate: computeNextWeeklyDeliveryDate(
      firstDeliverySchedule.scheduledDeliveryDate,
    ),
  };
};

export const alignFirstOrderBillingWithDeliverySchedule = async ({
  admin,
  firstDeliverySchedule,
  selectionId,
  shopifyOrderId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  firstDeliverySchedule: FirstOrderDeliveryScheduleResolution | null;
  selectionId: string;
  shopifyOrderId: string;
  subscriptionContractId: string | null;
}): Promise<AlignFirstOrderBillingResult> => {
  if (!subscriptionContractId) {
    console.log("[BILLING_ALIGNMENT] skipped", {
      reason: "missing_subscription_contract_id",
      selectionId,
      shopifyOrderId,
    });

    return { reason: "missing_subscription_contract_id", status: "skipped" };
  }

  const alignment = resolveFirstOrderBillingAlignment(firstDeliverySchedule);

  if (!alignment) {
    console.log("[BILLING_ALIGNMENT] skipped", {
      reason: "missing_delivery_schedule",
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
    });

    return { reason: "missing_delivery_schedule", status: "skipped" };
  }

  return alignBillingWithDeliverySchedule({
    admin,
    alignedNextBillingDate: alignment.alignedNextBillingDate,
    currentDeliveryDate: alignment.firstDeliveryDate,
    nextDeliveryDate: alignment.nextDeliveryDate,
    selectionId,
    shopifyOrderId,
    subscriptionContractId,
  });
};

export const alignRenewalBillingWithDeliverySchedule = async ({
  admin,
  renewalScheduledDeliveryDate,
  selectionId,
  shopifyOrderId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  renewalScheduledDeliveryDate: DeliveryDateString | null;
  selectionId: string;
  shopifyOrderId: string;
  subscriptionContractId: string | null;
}): Promise<AlignRenewalBillingResult> => {
  if (!subscriptionContractId) {
    console.log("[BILLING_ALIGNMENT] skipped", {
      reason: "missing_subscription_contract_id",
      selectionId,
      shopifyOrderId,
    });

    return { reason: "missing_subscription_contract_id", status: "skipped" };
  }

  if (!renewalScheduledDeliveryDate) {
    console.log("[BILLING_ALIGNMENT] skipped", {
      reason: "missing_renewal_delivery_date",
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
    });

    return { reason: "missing_renewal_delivery_date", status: "skipped" };
  }

  const alignedNextBillingDate = computeNextBillingDateFromCurrentDelivery(
    renewalScheduledDeliveryDate,
  );

  if (!alignedNextBillingDate) {
    console.log("[BILLING_ALIGNMENT] skipped", {
      reason: "missing_aligned_billing_date",
      renewalScheduledDeliveryDate,
      selectionId,
      shopifyOrderId,
      subscriptionContractId,
    });

    return { reason: "missing_aligned_billing_date", status: "skipped" };
  }

  return alignBillingWithDeliverySchedule({
    admin,
    alignedNextBillingDate,
    currentDeliveryDate: renewalScheduledDeliveryDate,
    nextDeliveryDate: computeNextWeeklyDeliveryDate(renewalScheduledDeliveryDate),
    selectionId,
    shopifyOrderId,
    subscriptionContractId,
  });
};

const toReferenceDate = (
  orderCreatedAt: Date | null | undefined,
): DeliveryDateString | null => {
  if (!orderCreatedAt || Number.isNaN(orderCreatedAt.getTime())) {
    return null;
  }

  try {
    return referenceDateFromInstant(orderCreatedAt);
  } catch {
    return null;
  }
};

const isValidPreferredDeliveryWeekday = (
  value: number | null | undefined,
): value is number =>
  value != null &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 6;

export const resolveFirstOrderDeliverySchedule = ({
  lineItemProperties,
  orderCreatedAt,
}: {
  lineItemProperties: LineItemProperty[] | undefined;
  orderCreatedAt: Date | null | undefined;
}): FirstOrderDeliveryScheduleResolution | null => {
  const desiredDeliveryDate =
    getDeliveryDateFromLineItemProperties(lineItemProperties);

  if (!desiredDeliveryDate) {
    return null;
  }

  const referenceDate = toReferenceDate(orderCreatedAt);

  if (!referenceDate) {
    return null;
  }

  const schedule = scheduleDeliveryDate({
    desiredDeliveryDate,
    fromCustomerChoice: true,
    referenceDate,
  });

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    preferredDeliveryWeekday: getWeekday(schedule.scheduledDeliveryDate),
    referenceDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

export const logDeliveryProjection = ({
  effectiveDeliveryDate,
  preferredDeliveryWeekday,
  projectedFromStoredDate,
  selectionId,
  shopifyOrderId,
  wasProjected,
}: {
  effectiveDeliveryDate: DeliveryDateString | null;
  preferredDeliveryWeekday: number | null;
  projectedFromStoredDate: DeliveryDateString | null;
  selectionId?: string;
  shopifyOrderId?: string;
  wasProjected: boolean;
}) => {
  try {
    console.log("[DELIVERY_PROJECTION]", {
      effectiveDeliveryDate,
      preferredDeliveryWeekday,
      projectedFromStoredDate,
      selectionId,
      shopifyOrderId,
      wasProjected,
    });
  } catch {
    // Logger must never throw.
  }
};

export const resolveRenewalDeliveryScheduleFromSelection = ({
  orderCreatedAt,
  selection,
  selectionId,
  shopifyOrderId,
}: {
  orderCreatedAt: Date | null | undefined;
  selection: {
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
  };
  selectionId?: string;
  shopifyOrderId?: string;
}): RenewalDeliveryScheduleResolution | null => {
  const referenceInstant =
    orderCreatedAt && !Number.isNaN(orderCreatedAt.getTime())
      ? orderCreatedAt
      : new Date();

  const referenceDate = toReferenceDate(referenceInstant);

  if (!referenceDate) {
    return null;
  }

  const projection = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
    now: referenceInstant,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
  });

  logDeliveryProjection({
    effectiveDeliveryDate: projection.effectiveDeliveryDate,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
    projectedFromStoredDate: projection.projectedFromStoredDate,
    selectionId,
    shopifyOrderId,
    wasProjected: projection.wasProjected,
  });

  if (!projection.effectiveDeliveryDate) {
    return null;
  }

  return {
    deliveryRescheduleReason: null,
    desiredDeliveryDate: projection.effectiveDeliveryDate,
    referenceDate,
    scheduledDeliveryDate: projection.effectiveDeliveryDate,
  };
};

export const resolveRenewalDeliverySchedule = ({
  orderCreatedAt,
  preferredDeliveryWeekday,
}: {
  orderCreatedAt: Date | null | undefined;
  preferredDeliveryWeekday: number | null | undefined;
}): RenewalDeliveryScheduleResolution | null => {
  if (!isValidPreferredDeliveryWeekday(preferredDeliveryWeekday)) {
    return null;
  }

  const referenceDate = toReferenceDate(orderCreatedAt);

  if (!referenceDate) {
    return null;
  }

  const schedule = computeRenewalDeliveryDate({
    preferredDeliveryWeekday,
    referenceDate,
  });

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    referenceDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

export const logDeliveryScheduleEvent = ({
  deliveryRescheduleReason = null,
  desiredDeliveryDate = null,
  event,
  isRenewal,
  referenceDate = null,
  scheduledDeliveryDate = null,
  shop,
  shopifyOrderId,
}: {
  deliveryRescheduleReason?: DeliveryRescheduleReason | null;
  desiredDeliveryDate?: DeliveryDateString | null;
  event: DeliveryScheduleLogEvent;
  isRenewal: boolean;
  referenceDate?: DeliveryDateString | null;
  scheduledDeliveryDate?: DeliveryDateString | null;
  shop: string;
  shopifyOrderId: string;
}) => {
  try {
    console.log("[DELIVERY]", {
      deliveryRescheduleReason,
      desiredDeliveryDate,
      event,
      isRenewal,
      referenceDate,
      scheduledDeliveryDate,
      shop,
      shopifyOrderId,
    });
  } catch {
    // Logger must never throw.
  }
};
