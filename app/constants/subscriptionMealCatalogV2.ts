/**
 * Meal catalog V2 provisioning constants (Settings only — not wired to builder).
 *
 * 1 Shopify product = 1 recipe.
 * 3 variants = portion versions for weight_loss / balanced / bulk.
 */

import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "./subscriptionObjective";

export {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
};

/** Meal variants are never cart line items — catalog price stays zero. */
export const MEAL_V2_VARIANT_PRICE = "0.00";

export const MEAL_V2_EXPECTED_VARIANT_COUNT = SUBSCRIPTION_OBJECTIVES.length;

export const MEAL_V2_OBJECTIVE_METAFIELD = {
  namespace: "mileyo",
  key: "objective",
  type: "single_line_text_field",
} as const;

export type MealV2VariantSpec = {
  objective: SubscriptionObjective;
  objectiveOptionLabel: string;
  objectiveMetafieldValue: SubscriptionObjective;
  price: string;
};

/** Canonical meal V2 variants in stable order — no macro values. */
export const getMealV2VariantSpecs = (): MealV2VariantSpec[] =>
  SUBSCRIPTION_OBJECTIVES.map((objective) => ({
    objective,
    objectiveOptionLabel: SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective],
    objectiveMetafieldValue: objective,
    price: MEAL_V2_VARIANT_PRICE,
  }));

export const MEAL_V2_VARIANT_SPECS = getMealV2VariantSpecs();

/** Shopify default single-option name for mono-variant legacy products. */
export const SHOPIFY_DEFAULT_OPTION_NAME = "Title";

export const MEAL_V2_CLASSIFICATION = {
  LEGACY_ELIGIBLE: "LEGACY_ELIGIBLE",
  ALREADY_CONFIGURED: "ALREADY_CONFIGURED",
  BLOCKED: "BLOCKED",
} as const;

export type MealV2Classification =
  (typeof MEAL_V2_CLASSIFICATION)[keyof typeof MEAL_V2_CLASSIFICATION];

/** Sanity: ensure labels stay UX-only and distinct from canonical keys. */
export const MEAL_V2_WEIGHT_LOSS_LABEL =
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS];
