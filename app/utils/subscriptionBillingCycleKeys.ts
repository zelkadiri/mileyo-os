/**
 * Canonical billing-cycle identity: Shopify subscription contract + cycleIndex.
 *
 * Keys must NOT embed:
 * - UTC calendar day of cron execution (legacy daily bug)
 * - mutable nextBillingDate instants
 * - Paris Saturday anchors alone (can diverge from Shopify cycleIndex)
 *
 * Saturday helpers remain only for legacy audit / migration tooling.
 */
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../constants/subscriptionCycle";
import {
  addCalendarDays,
  getWeekday,
  referenceDateFromInstant,
  type DeliveryDateString,
} from "./deliveryDate";

const assertPositiveCycleIndex = (cycleIndex: number) => {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 1) {
    throw new Error(`Invalid Shopify billing cycleIndex: ${cycleIndex}`);
  }
};

/** Durable claim key — unique per selection + Shopify cycleIndex. */
export const buildBillingCycleKeyFromShopifyCycle = (
  selectionId: string,
  cycleIndex: number,
) => {
  assertPositiveCycleIndex(cycleIndex);
  return `mileyo_cycle_${selectionId}_c${cycleIndex}`;
};

/** Stable Shopify idempotency key for the first attempt on a cycle. */
export const buildAutoBillingIdempotencyKeyFromShopifyCycle = (
  selectionId: string,
  cycleIndex: number,
) => {
  assertPositiveCycleIndex(cycleIndex);
  return `mileyo_auto_${selectionId}_c${cycleIndex}`;
};

/**
 * @deprecated Prefer buildBillingCycleKeyFromShopifyCycle. Kept for recovery rows
 * that historically stored date-based keys — do not use for new charges.
 */
export const buildBillingCycleKey = (
  selectionId: string,
  dueBillingDate: Date | null,
) => {
  if (!dueBillingDate || Number.isNaN(dueBillingDate.getTime())) {
    return `mileyo_cycle_${selectionId}_unknown`;
  }
  const anchor = resolveSubscriptionBillingCycleAnchorDate(dueBillingDate);
  return `mileyo_cycle_${selectionId}_${anchor}`;
};

/**
 * @deprecated Prefer buildAutoBillingIdempotencyKeyFromShopifyCycle.
 */
export const buildAutoBillingIdempotencyKey = (
  selectionId: string,
  dueBillingDate: Date,
) => {
  if (!(dueBillingDate instanceof Date) || Number.isNaN(dueBillingDate.getTime())) {
    throw new Error(
      "Invalid dueBillingDate for auto billing idempotency key.",
    );
  }
  const anchor = resolveSubscriptionBillingCycleAnchorDate(dueBillingDate);
  return `mileyo_auto_${selectionId}_${anchor}`;
};

/** Legacy PROD keys (UTC day of cron) — historical reconcile only. */
export const buildLegacyDailyAutoBillingIdempotencyKey = (
  selectionId: string,
  utcDayIso: string,
) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDayIso)) {
    throw new Error(`Invalid legacy UTC day for billing key: ${utcDayIso}`);
  }
  return `mileyo_auto_${selectionId}_${utcDayIso}`;
};

export const buildRecoveryBillingIdempotencyKey = (
  selectionId: string,
  billingCycleKey: string,
  attemptNumber: number,
) => {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`Invalid recovery attempt number: ${attemptNumber}`);
  }
  return `mileyo_recovery_${selectionId}_${billingCycleKey}_a${attemptNumber}`;
};

/** Paris Saturday floor — legacy / display only. */
export const resolveSubscriptionBillingCycleAnchorDate = (
  dueBillingDate: Date,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): DeliveryDateString => {
  if (!(dueBillingDate instanceof Date) || Number.isNaN(dueBillingDate.getTime())) {
    throw new Error("Invalid dueBillingDate for billing cycle anchor.");
  }
  const parisDate = referenceDateFromInstant(dueBillingDate, timezone);
  const daysSinceSaturday = (getWeekday(parisDate) + 1) % 7;
  return addCalendarDays(parisDate, -daysSinceSaturday);
};

export const extractShopifyCycleIndexFromBillingKey = (
  key: string,
): number | null => {
  const match = key.match(/_c(\d+)(?:_a\d+)?$/);
  if (!match?.[1]) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 ? index : null;
};
