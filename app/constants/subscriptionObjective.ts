/**
 * Subscription meal objective constants.
 *
 * Source of truth metafield: mileyo.objective on PRODUCTVARIANT.
 * Shopify option labels are UX-only — never used for business filtering.
 */

export const SUBSCRIPTION_OBJECTIVE = {
  WEIGHT_LOSS: "weight_loss",
  BALANCED: "balanced",
  BULK: "bulk",
} as const;

export type SubscriptionObjective =
  (typeof SUBSCRIPTION_OBJECTIVE)[keyof typeof SUBSCRIPTION_OBJECTIVE];

export const SUBSCRIPTION_OBJECTIVES = [
  SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  SUBSCRIPTION_OBJECTIVE.BALANCED,
  SUBSCRIPTION_OBJECTIVE.BULK,
] as const;

/** Shared Shopify product option name for objective variants (Box + Meals). */
export const SUBSCRIPTION_OBJECTIVE_OPTION_NAME = "Objectif";

/** Shared Shopify option value labels (FR) — mapped via mileyo.objective, never by label. */
export const SUBSCRIPTION_OBJECTIVE_OPTION_LABEL: Record<
  SubscriptionObjective,
  string
> = {
  [SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]: "Perte de poids",
  [SUBSCRIPTION_OBJECTIVE.BALANCED]: "Équilibré",
  [SUBSCRIPTION_OBJECTIVE.BULK]: "Prise de masse",
};
