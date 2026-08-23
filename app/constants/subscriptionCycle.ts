/**
 * Weekly subscription cycle constants.
 *
 * Weekday convention matches the rest of the repo / JS Date#getDay:
 * 0 = Sunday, 6 = Saturday.
 *
 * Meal cutoff weekday/hour/minute are wired into portal meal-selection cutoff.
 * Billing Saturday alignment uses the billing weekday constants separately.
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

/** Meal selection reminder send window — Sunday from 10:00 Europe/Paris. */
export const MEAL_SELECTION_REMINDER_WINDOW_START_HOUR = 10;
export const MEAL_SELECTION_REMINDER_WINDOW_START_MINUTE = 0;

/** Upcoming delivery email send window — J-2 / J-1 from 09:00 Europe/Paris. */
export const UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR = 9;
export const UPCOMING_DELIVERY_EMAIL_WINDOW_START_MINUTE = 0;

/** Allowed delivery weekdays — Thursday, Friday. */
export const SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS = [4, 5] as const;
