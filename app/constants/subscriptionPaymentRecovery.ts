export const RECOVERY_STATUS = {
  EMAIL_SEND_FAILED: "email_send_failed",
  FINAL_FAILED: "final_failed",
  PAYMENT_METHOD_UPDATE_NEEDED: "payment_method_update_needed",
  PROCESSING: "processing",
  RECOVERED: "recovered",
  RETRY_SCHEDULED: "retry_scheduled",
} as const;

export type RecoveryStatus =
  (typeof RECOVERY_STATUS)[keyof typeof RECOVERY_STATUS];

export const MAX_RECOVERY_FAILURES = 3;

export const PAYMENT_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const ACTIVE_RECOVERY_STATUSES = [
  RECOVERY_STATUS.PROCESSING,
  RECOVERY_STATUS.RETRY_SCHEDULED,
  RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
  RECOVERY_STATUS.EMAIL_SEND_FAILED,
] as const;

export const isOpenRecoveryStatus = (status: string) =>
  (ACTIVE_RECOVERY_STATUSES as readonly string[]).includes(status);

export type PaymentUpdateUnavailableReason =
  | "missing_payment_method"
  | "unsupported"
  | null;
