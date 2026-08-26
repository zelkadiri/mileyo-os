/**
 * SubscriptionBoxChange constants (BOX-CHANGE-2 foundation).
 * Pending intent status machine — no portal / billing wiring here.
 */

export const SUBSCRIPTION_BOX_CHANGE_STATUS = {
  PENDING: "pending",
  APPLYING: "applying",
  APPLIED: "applied",
  CANCELLED: "cancelled",
  FAILED: "failed",
} as const;

export type SubscriptionBoxChangeStatus =
  (typeof SUBSCRIPTION_BOX_CHANGE_STATUS)[keyof typeof SUBSCRIPTION_BOX_CHANGE_STATUS];

export const SUBSCRIPTION_BOX_CHANGE_STATUSES = [
  SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
  SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
  SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
  SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
  SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
] as const;

export const isSubscriptionBoxChangeStatus = (
  value: string,
): value is SubscriptionBoxChangeStatus =>
  (SUBSCRIPTION_BOX_CHANGE_STATUSES as readonly string[]).includes(value);

/** Terminal statuses — no longer eligible as the active pending intent. */
export const TERMINAL_SUBSCRIPTION_BOX_CHANGE_STATUSES = [
  SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
  SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
  SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
] as const;

/**
 * Minimal allowed transitions (BOX-CHANGE-2B CAS).
 * pending → applying | cancelled
 * applying → applied | failed
 * Retry from failed is out of scope until BOX-CHANGE-4.
 */
export const SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS = {
  [SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING]: [
    SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
  ],
  [SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING]: [
    SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
  ],
  [SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED]: [],
  [SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED]: [],
  [SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED]: [],
} as const;

/**
 * Coverage of the portal's currently exposed delivery cycle.
 * Fail-safe: anything other than `unpaid` means box-size must not mutate immediately.
 */
export const CURRENT_DELIVERY_COVERAGE = {
  UNPAID: "unpaid",
  ORDERED: "ordered",
  BILLING_IN_FLIGHT: "billing_in_flight",
  AMBIGUOUS: "ambiguous",
} as const;

export type CurrentDeliveryCoverage =
  (typeof CURRENT_DELIVERY_COVERAGE)[keyof typeof CURRENT_DELIVERY_COVERAGE];

/**
 * Portal success discriminator (BOX-CHANGE-3).
 * Lets BOX-CHANGE-6 show immediate vs next-cycle copy without guessing.
 */
export const BOX_CHANGE_EFFECT = {
  IMMEDIATE: "immediate",
  NEXT_CYCLE: "next_cycle",
} as const;

export type BoxChangeEffect =
  (typeof BOX_CHANGE_EFFECT)[keyof typeof BOX_CHANGE_EFFECT];

export const BOX_CHANGE_RECOVERY_BLOCK_MESSAGE =
  "Un paiement est actuellement en cours de régularisation. Vous pourrez modifier votre box dès que celui-ci sera résolu.";

/** Generic next-cycle success (no meal count) — prefer buildBoxChangePendingSuccessMessage. */
export const BOX_CHANGE_PENDING_SUCCESS_MESSAGE =
  "Votre prochaine box est enregistrée. Votre livraison actuelle reste inchangée. La nouvelle box prendra effet à partir de votre prochain cycle.";

export const BOX_CHANGE_IMMEDIATE_SUCCESS_MESSAGE =
  "Votre box a bien été modifiée.";

export const BOX_CHANGE_IMMEDIATE_PAUSED_SUCCESS_MESSAGE =
  "Votre box a bien été modifiée. Vous pourrez reprendre l’abonnement quand vous le souhaitez.";

/** Client-facing next-cycle success including target meal count. */
export const buildBoxChangePendingSuccessMessage = (toMealsCount: number) =>
  `Votre prochaine box est enregistrée. Votre livraison actuelle reste inchangée. La box ${toMealsCount} repas prendra effet à partir de votre prochain cycle.`;

export const BOX_CHANGE_PENDING_REPLACE_NOTICE =
  "Vous avez déjà une modification prévue pour votre prochaine box. Un nouveau choix remplacera celui-ci.";

export const BOX_CHANGE_NEXT_CYCLE_STEP1_NOTICE =
  "Ce changement ne modifiera pas votre livraison actuelle.";

export const BOX_CHANGE_NEXT_CYCLE_STEP1_TIMING =
  "Votre nouvelle box commencera à partir de votre prochain cycle.";

export const BOX_CHANGE_NEXT_CYCLE_NO_EXTRA_CHARGE =
  "Aucun montant supplémentaire n’est prélevé aujourd’hui.";

export const BOX_CHANGE_PENDING_CARD_COPY =
  "Votre livraison actuelle reste inchangée. Cette nouvelle box sera utilisée à partir de votre prochain cycle.";

export const buildBoxChangeDowngradeNotice = ({
  currentMealsCount,
  targetMealsCount,
}: {
  currentMealsCount: number;
  targetMealsCount: number;
}) =>
  `Votre livraison actuelle reste à ${currentMealsCount} repas. Votre box passera à ${targetMealsCount} repas à partir de votre prochain cycle.`;

export const buildCurrentMealEditorPendingNotice = (pendingMealsCount: number) =>
  `Votre prochaine box passera à ${pendingMealsCount} repas. Les changements effectués ici concernent uniquement votre livraison actuelle.`;

export const buildBoxChangeFutureMealsTitle = (targetMealsCount: number) =>
  `Choisissez les ${targetMealsCount} plats de votre prochaine box`;

export const buildBoxChangeFutureMealsNotice = (currentMealsCount: number) =>
  `Vos ${currentMealsCount} plats de la livraison actuelle ne seront pas modifiés.`;

/**
 * Match between pending.effectiveBillingDate and the cycle the billing worker is due to charge
 * (selection.nextBillingDate). Strict instant equality — no string compare.
 */
export const PENDING_BILLING_DATE_MATCH = {
  MATCH: "match",
  FUTURE: "future",
  STALE: "stale",
  MISSING: "missing",
} as const;

export type PendingBillingDateMatch =
  (typeof PENDING_BILLING_DATE_MATCH)[keyof typeof PENDING_BILLING_DATE_MATCH];

/**
 * Outcomes of apply-before-billing (BOX-CHANGE-4 / 5).
 *
 * Billing is fail-closed: only outcomes in BILLING_ALLOWED_BOX_CHANGE_OUTCOMES
 * may call triggerSubscriptionBillingAttempt. Everything else blocks.
 */
export const APPLY_PENDING_BOX_CHANGE_OUTCOME = {
  /** No relevant pending/applying/failed — historical billing path. */
  NO_PENDING: "no_pending",
  /** Pending targets a later cycle — current cycle may bill. */
  SKIPPED_FUTURE: "skipped_future",
  /** Matching pending applied; selection/contract coherent. */
  APPLIED: "applied",
  /** Stale effectiveBillingDate — never bill the old box. */
  BLOCKED_STALE: "blocked_stale",
  /** selection.nextBillingDate missing — cannot prove cycle coherence. */
  BLOCKED_MISSING_BILLING_DATE: "blocked_missing_billing_date",
  /** Claim CAS lost to another worker — loser must not bill. */
  BLOCKED_CLAIM_LOST: "blocked_claim_lost",
  /** Transient / ambiguous Shopify state — keep applying, retry later. */
  BLOCKED_RETRYABLE: "blocked_retryable",
  /** Shopify contract on an unexpected third variant. */
  BLOCKED_UNEXPECTED_CONTRACT_VARIANT: "blocked_unexpected_contract_variant",
  /** Existing failed row for this (or past) cycle — ops intervention. */
  BLOCKED_FAILED_CHANGE: "blocked_failed_change",
  /** Apply attempt just marked failed (terminal target error). */
  FAILED_TERMINAL: "failed_terminal",
} as const;

export type ApplyPendingBoxChangeOutcome =
  (typeof APPLY_PENDING_BOX_CHANGE_OUTCOME)[keyof typeof APPLY_PENDING_BOX_CHANGE_OUTCOME];

/** Explicit allowlist — unknown outcomes must never fall through to billing. */
export const BILLING_ALLOWED_BOX_CHANGE_OUTCOMES = [
  APPLY_PENDING_BOX_CHANGE_OUTCOME.NO_PENDING,
  APPLY_PENDING_BOX_CHANGE_OUTCOME.SKIPPED_FUTURE,
  APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
] as const;

export type BillingAllowedBoxChangeOutcome =
  (typeof BILLING_ALLOWED_BOX_CHANGE_OUTCOMES)[number];

export const isBillingAllowedBoxChangeOutcome = (
  outcome: string,
): outcome is BillingAllowedBoxChangeOutcome =>
  (BILLING_ALLOWED_BOX_CHANGE_OUTCOMES as readonly string[]).includes(outcome);

/** Statuses that can still affect the billing gate for a selection. */
export const BILLING_RELEVANT_BOX_CHANGE_STATUSES = [
  SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
  SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
  SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
] as const;
