/**
 * Persistent per-cycle billing reservation (P0 anti-double-charge).
 * UNIQUE(selectionId, billingCycleKey) is the durable lock — not wall-clock windows.
 */
export const BILLING_CYCLE_CLAIM_STATUS = {
  CLAIMED: "claimed",
  SUBMITTED: "submitted",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  /** Shopify outcome unknown (timeout/crash after create) — never create a new charge. */
  UNCERTAIN: "uncertain",
} as const;

export type BillingCycleClaimStatus =
  (typeof BILLING_CYCLE_CLAIM_STATUS)[keyof typeof BILLING_CYCLE_CLAIM_STATUS];

export const BILLING_CYCLE_CLAIM_SOURCE = {
  ADMIN: "admin",
  CRON: "cron",
  RECOVERY: "recovery",
  RESUME: "resume",
  WEBHOOK: "webhook",
} as const;

export type BillingCycleClaimSource =
  (typeof BILLING_CYCLE_CLAIM_SOURCE)[keyof typeof BILLING_CYCLE_CLAIM_SOURCE];

export const TERMINAL_PAID_CYCLE_CLAIM_STATUSES: readonly BillingCycleClaimStatus[] =
  [
    BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
    BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
  ];
