/**
 * Delivery date → Saturday billing-cycle resolver.
 *
 * Maps a Thursday/Friday delivery calendar date to the Saturday 00:05
 * Europe/Paris slot that pays that box. Does not use "next Saturday from now".
 *
 * Wired into first-order, renewal, and portal-resume billing alignment.
 * Not imported by the billing worker, recovery, cron, or webhooks.
 */
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../constants/deliverySchedule";
import {
  SUBSCRIPTION_CYCLE_BILLING_WEEKDAY,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../constants/subscriptionCycle";
import {
  addCalendarDays,
  computeNextWeeklyDeliveryDate,
  getWeekday,
  parseDeliveryDate,
  parisWallClockToInstant,
  type DeliveryDateString,
} from "./deliveryDate";

const cycleInstantForCalendarDate = (
  date: DeliveryDateString,
  timezone: string,
) =>
  parisWallClockToInstant({
    date,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone,
  });

/**
 * Calendar Saturday strictly before `deliveryDate` (Europe/Paris civil date).
 * Thursday 20 Aug → Saturday 15 Aug. Friday 21 Aug → Saturday 15 Aug.
 */
export const resolveBillingCycleCalendarDateForDelivery = (
  deliveryDate: string | null | undefined,
): DeliveryDateString | null => {
  const parsed = parseDeliveryDate(deliveryDate);

  if (!parsed) {
    return null;
  }

  const daysSinceSaturday =
    (getWeekday(parsed) - SUBSCRIPTION_CYCLE_BILLING_WEEKDAY + 7) % 7;
  const daysBack = daysSinceSaturday === 0 ? 7 : daysSinceSaturday;

  return addCalendarDays(parsed, -daysBack);
};

/** Saturday 00:05 Paris that pays this delivery. */
export const resolveBillingCycleDateForDelivery = (
  deliveryDate: string | null | undefined,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): Date | null => {
  const saturdayDate = resolveBillingCycleCalendarDateForDelivery(deliveryDate);

  if (!saturdayDate) {
    return null;
  }

  return cycleInstantForCalendarDate(saturdayDate, timezone);
};

/**
 * Saturday 00:05 Paris that pays the next weekly delivery after a paid box.
 * Thursday 20 Aug paid → Saturday 22 Aug (box of Thursday 27).
 */
export const resolveNextBillingCycleAfterDelivery = (
  deliveryDate: string | null | undefined,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): Date | null => {
  const parsed = parseDeliveryDate(deliveryDate);

  if (!parsed) {
    return null;
  }

  return resolveBillingCycleDateForDelivery(
    computeNextWeeklyDeliveryDate(parsed),
    timezone,
  );
};

/**
 * P0-1 fail-closed: after a paid first checkout, local/Shopify NBD must not be
 * earlier than the Saturday that pays the *second* box (first legitimate renewal).
 *
 * Uses the first-checkout scheduled delivery date (BoxOrder for selection.shopifyOrderId,
 * isSubscriptionRenewal=false) — not an arbitrary BoxOrder and not delivery-day alone.
 * Misaligned residual NBD stays blocked until reconciliation advances NBD.
 */
export const evaluateFirstCheckoutDeliveryBillingGuard = ({
  firstCheckoutScheduledDeliveryDate,
  nextBillingDate,
  timezone = SUBSCRIPTION_CYCLE_TIMEZONE,
}: {
  firstCheckoutScheduledDeliveryDate: string;
  nextBillingDate: Date;
  timezone?: string;
}):
  | { ok: true; earliestLegitimateRenewalAt: Date }
  | {
      ok: false;
      reason: string;
      earliestLegitimateRenewalAt: Date | null;
    } => {
  if (Number.isNaN(nextBillingDate.getTime())) {
    return {
      earliestLegitimateRenewalAt: null,
      ok: false,
      reason: "nextBillingDate invalide — facturation bloquée (garde 1ère livraison).",
    };
  }

  const earliestLegitimateRenewalAt = resolveNextBillingCycleAfterDelivery(
    firstCheckoutScheduledDeliveryDate,
    timezone,
  );

  if (!earliestLegitimateRenewalAt) {
    return {
      earliestLegitimateRenewalAt: null,
      ok: false,
      reason:
        "Impossible de dériver le premier renouvellement légitime depuis la 1ère livraison — réconciliation requise.",
    };
  }

  if (nextBillingDate.getTime() < earliestLegitimateRenewalAt.getTime()) {
    return {
      earliestLegitimateRenewalAt,
      ok: false,
      reason: `NBD ${nextBillingDate.toISOString()} antérieure au premier renouvellement légitime ${earliestLegitimateRenewalAt.toISOString()} (1ère livraison payée ${firstCheckoutScheduledDeliveryDate}) — alignement/réconciliation requis, pas de débit.`,
    };
  }

  return { earliestLegitimateRenewalAt, ok: true };
};

const isSameInstant = (left: Date, right: Date) =>
  left.getTime() === right.getTime();

/**
 * schedule_only resume billing: keep a future cycle date already on the
 * contract, otherwise use the Saturday that pays `targetDeliveryDate`,
 * then the next cycle Saturday if that slot is already past.
 */
export const resolveScheduleOnlyResumeBillingDate = ({
  existingNextBillingDate,
  now,
  targetDeliveryDate,
  timezone = SUBSCRIPTION_CYCLE_TIMEZONE,
}: {
  existingNextBillingDate?: Date | null;
  now: Date;
  targetDeliveryDate: string;
  timezone?: string;
}): Date | null => {
  const cycleForTarget = resolveBillingCycleDateForDelivery(
    targetDeliveryDate,
    timezone,
  );
  const nextCycle = resolveNextBillingCycleAfterDelivery(
    targetDeliveryDate,
    timezone,
  );

  if (existingNextBillingDate && existingNextBillingDate.getTime() > now.getTime()) {
    if (
      (cycleForTarget && isSameInstant(existingNextBillingDate, cycleForTarget)) ||
      (nextCycle && isSameInstant(existingNextBillingDate, nextCycle))
    ) {
      return existingNextBillingDate;
    }
  }

  if (cycleForTarget && cycleForTarget.getTime() > now.getTime()) {
    return cycleForTarget;
  }

  if (nextCycle && nextCycle.getTime() > now.getTime()) {
    return nextCycle;
  }

  return null;
};
