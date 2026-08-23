/**
 * Generic email foundation types.
 * Domain-specific payment payloads live alongside the shared template registry.
 */

export type EmailRecipient = {
  email: string;
  name?: string;
};

/** Template identifiers known to the email layer. Expand as templates are added. */
export type EmailTemplateName =
  | "test"
  | "payment-failed"
  | "payment-recovered"
  | "subscription-created"
  | "subscription-paused"
  | "meal-selection-confirmed"
  | "meal-selection-reminder"
  | "upcoming-delivery";

/** V1 pause causes for SubscriptionPausedEmail. */
export type SubscriptionPauseCause =
  | "user_voluntary"
  | "payment_final_failure";

/** Display data for SubscriptionCreatedEmail (no business logic). */
export type SubscriptionCreatedEmailData = {
  customerName?: string | null;
  mealsCount?: number | null;
  nextDelivery?: string | null;
  portalUrl?: string | null;
};

/** Display data for SubscriptionPausedEmail (no business logic). */
export type SubscriptionPausedEmailData = {
  customerName?: string | null;
  pauseCause: SubscriptionPauseCause;
  portalUrl?: string | null;
};

/** Display data for MealSelectionConfirmedEmail (no business logic). */
export type MealSelectionConfirmedEmailData = {
  customerName?: string | null;
  deliveryDateLabel: string;
  selectedMeals: string[];
  selectedCount: number;
  mealsCount: number;
  portalUrl?: string | null;
};

/** Display data for MealSelectionReminderEmail (no business logic). */
export type MealSelectionReminderEmailData = {
  customerName?: string | null;
  deliveryDateLabel: string;
  cutoffLabel: string;
  mealsCount: number;
  portalUrl?: string | null;
};

/** Display data for UpcomingDeliveryEmail (no business logic). */
export type UpcomingDeliveryEmailData = {
  customerName?: string | null;
  deliveryDateLabel: string;
  mealsCount: number;
  selectedMeals: string[];
  portalUrl: string;
  supportHref?: string | null;
  supportLabel?: string | null;
};

/** Display data for PaymentFailedEmail (no business logic). */
export type PaymentFailedEmailData = {
  customerName?: string | null;
  failureCount?: number | null;
  nextRetryAt?: string | null;
  recoveryId?: string | null;
  subscriptionContractId?: string | null;
};

/** Display data for PaymentRecoveredEmail (no business logic). */
export type PaymentRecoveredEmailData = {
  customerName?: string | null;
  orderId?: string | null;
  recoveryId?: string | null;
  subscriptionContractId?: string | null;
};

export type EmailPayload<TData = Record<string, unknown>> = {
  /** Optional override; otherwise uses process.env.EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  subject: string;
  template: EmailTemplateName;
  to: EmailRecipient | EmailRecipient[];
  data?: TData;
};

export type SendEmailOptions = {
  idempotencyKey?: string;
};

/** Failure reasons returned by the transport layer (not domain/business rules). */
export type EmailSendFailureReason =
  | "missing_api_key"
  | "missing_sender"
  | "render_error"
  | "send_error"
  | "unknown_template"
  | "invalid_idempotency_key"
  | "invalid_idempotent_request"
  | "concurrent_idempotent_requests"
  | "rate_limit_exceeded"
  | "validation_error";

export type EmailSendSuccess = {
  ok: true;
  id: string;
};

export type EmailSendFailure = {
  ok: false;
  reason: EmailSendFailureReason;
  message: string;
  /** Resend `ErrorResponse.name` when the provider returned a structured error. */
  providerErrorCode?: string;
};

export type EmailSendResult = EmailSendSuccess | EmailSendFailure;

export type EmailRenderResult = {
  html: string;
  text: string;
};
