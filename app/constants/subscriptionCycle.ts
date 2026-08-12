/**
 * Future weekly subscription cycle constants (not wired yet).
 *
 * Weekday convention matches the rest of the repo / JS Date#getDay:
 * 0 = Sunday, 6 = Saturday.
 */

export const SUBSCRIPTION_CYCLE_TIMEZONE = "Europe/Paris" as const;

/** Principal billing day — Saturday. */
export const SUBSCRIPTION_CYCLE_BILLING_WEEKDAY = 6;

/** Billing retry days after the principal charge — Sunday, then Monday. */
export const SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS = [0, 1] as const;

/** Meal selection cutoff weekday — Monday. */
export const SUBSCRIPTION_CYCLE_MEAL_CUTOFF_WEEKDAY = 1;
export const SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR = 23;
export const SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE = 59;

/** Allowed delivery weekdays — Thursday, Friday. */
export const SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS = [4, 5] as const;
