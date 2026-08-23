/**
 * EmailEvent outbox constants (EMAIL-6B).
 * Status / type strings only — no send, retry policy, or domain coupling.
 */

export const EMAIL_EVENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type EmailEventStatus =
  (typeof EMAIL_EVENT_STATUS)[keyof typeof EMAIL_EVENT_STATUS];

export const EMAIL_EVENT_STATUSES = [
  EMAIL_EVENT_STATUS.PENDING,
  EMAIL_EVENT_STATUS.PROCESSING,
  EMAIL_EVENT_STATUS.SENT,
  EMAIL_EVENT_STATUS.FAILED,
  EMAIL_EVENT_STATUS.CANCELLED,
] as const;

export const isEmailEventStatus = (
  value: string,
): value is EmailEventStatus =>
  (EMAIL_EVENT_STATUSES as readonly string[]).includes(value);

/** Known transactional event types. Migration onto outbox is gradual. */
export const EMAIL_EVENT_TYPE = {
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_RECOVERED: "payment_recovered",
  SUBSCRIPTION_CREATED: "subscription_created",
  SUBSCRIPTION_PAUSED: "subscription_paused",
  MEAL_SELECTION_CONFIRMED: "meal_selection_confirmed",
  MEAL_SELECTION_REMINDER: "meal_selection_reminder",
  UPCOMING_DELIVERY: "upcoming_delivery",
} as const;

export type EmailEventType =
  (typeof EMAIL_EVENT_TYPE)[keyof typeof EMAIL_EVENT_TYPE];

export const EMAIL_EVENT_TYPES = [
  EMAIL_EVENT_TYPE.PAYMENT_FAILED,
  EMAIL_EVENT_TYPE.PAYMENT_RECOVERED,
  EMAIL_EVENT_TYPE.SUBSCRIPTION_CREATED,
  EMAIL_EVENT_TYPE.SUBSCRIPTION_PAUSED,
  EMAIL_EVENT_TYPE.MEAL_SELECTION_CONFIRMED,
  EMAIL_EVENT_TYPE.MEAL_SELECTION_REMINDER,
  EMAIL_EVENT_TYPE.UPCOMING_DELIVERY,
] as const;

export const isEmailEventType = (value: string): value is EmailEventType =>
  (EMAIL_EVENT_TYPES as readonly string[]).includes(value);

/** Max claim attempts before terminal failure (V1). attemptCount increments on claim only. */
export const EMAIL_EVENT_MAX_ATTEMPTS = 5;
