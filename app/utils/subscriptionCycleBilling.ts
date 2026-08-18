/**
 * Weekly subscription-cycle billing helpers (Saturday / Sunday / Monday).
 *
 * Sunday/Monday retries are used by payment recovery scheduling.
 * These functions must not replace delivery-relative J-2 helpers in
 * `deliveryDate.ts`. They are not imported by the billing worker,
 * webhooks, or portal resume.
 */
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../constants/deliverySchedule";
import {
  SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS,
  SUBSCRIPTION_CYCLE_BILLING_WEEKDAY,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../constants/subscriptionCycle";
import {
  addCalendarDays,
  getWeekday,
  parisWallClockToInstant,
  referenceDateFromInstant,
} from "./deliveryDate";

export type SubscriptionCycleRetryNumber = 1 | 2;

const assertValidInstant = (instant: Date, label: string) => {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid ${label}: expected a valid Date.`);
  }
};

const wallClockForCycle = ({
  date,
  timezone,
}: {
  date: ReturnType<typeof referenceDateFromInstant>;
  timezone: string;
}) =>
  parisWallClockToInstant({
    date,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone,
  });

/**
 * Next occurrence of `weekday` at 00:05 Europe/Paris.
 * If the reference instant is already at or after that slot, returns the following week.
 */
export const computeNextSubscriptionCycleWeekdayAt = (
  reference: Date,
  weekday: number,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): Date => {
  assertValidInstant(reference, "reference instant");

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error(`Unsupported subscription cycle weekday: ${weekday}`);
  }

  const todayParis = referenceDateFromInstant(reference, timezone);
  const daysUntil = (weekday - getWeekday(todayParis) + 7) % 7;
  let targetDate = addCalendarDays(todayParis, daysUntil);
  let targetInstant = wallClockForCycle({ date: targetDate, timezone });

  if (targetInstant.getTime() <= reference.getTime()) {
    targetDate = addCalendarDays(targetDate, 7);
    targetInstant = wallClockForCycle({ date: targetDate, timezone });
  }

  return targetInstant;
};

/** Next Saturday 00:05 Europe/Paris after the reference instant. */
export const computeNextSubscriptionCycleBillingAt = (
  reference: Date,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): Date =>
  computeNextSubscriptionCycleWeekdayAt(
    reference,
    SUBSCRIPTION_CYCLE_BILLING_WEEKDAY,
    timezone,
  );

/**
 * Next payment-retry slot after the reference instant.
 *
 * Retry 1 → Sunday 00:05 Paris.
 * Retry 2 → Monday 00:05 Paris.
 */
export const computeNextSubscriptionCycleRetryAt = (
  reference: Date,
  retryNumber: SubscriptionCycleRetryNumber,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): Date => {
  const weekday = SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS[retryNumber - 1];

  if (weekday === undefined) {
    throw new Error(
      `Unsupported subscription cycle retry number: ${retryNumber}`,
    );
  }

  return computeNextSubscriptionCycleWeekdayAt(reference, weekday, timezone);
};
