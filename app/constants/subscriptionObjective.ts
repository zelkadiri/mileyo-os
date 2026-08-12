/**
 * Subscription meal objective constants (not wired to the builder yet).
 *
 * Source of truth metafield: mileyo.objective on PRODUCTVARIANT.
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
