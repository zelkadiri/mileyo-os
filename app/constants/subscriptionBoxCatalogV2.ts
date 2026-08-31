/**
 * Box Mileyo V2 catalog constants (provisioning only — not wired to builder).
 *
 * Seed prices are initial values used only when creating an empty catalog.
 * Shopify variant.price remains the source of truth after creation.
 */

import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "./subscriptionObjective";

export const BOX_V2_PRODUCT_TITLE = "Box Mileyo V2";
export const BOX_V2_PRODUCT_HANDLE = "box-mileyo-v2";
/** Initial product status on first create only — live shops may publish to ACTIVE. */
export const BOX_V2_PRODUCT_STATUS = "DRAFT" as const;

export const BOX_V2_MEAL_COUNTS = [8, 10, 12, 16, 20, 24] as const;

export type BoxV2MealCount = (typeof BOX_V2_MEAL_COUNTS)[number];

export const BOX_V2_MEAL_COUNT_OPTION_NAME = "Nombre de repas";
/** @deprecated Prefer SUBSCRIPTION_OBJECTIVE_OPTION_NAME — kept for Box V2 callers. */
export const BOX_V2_OBJECTIVE_OPTION_NAME = SUBSCRIPTION_OBJECTIVE_OPTION_NAME;

export const BOX_V2_MEAL_COUNT_OPTION_LABEL: Record<BoxV2MealCount, string> = {
  8: "8 repas",
  10: "10 repas",
  12: "12 repas",
  16: "16 repas",
  20: "20 repas",
  24: "24 repas",
};

/** @deprecated Prefer SUBSCRIPTION_OBJECTIVE_OPTION_LABEL — kept for Box V2 callers. */
export const BOX_V2_OBJECTIVE_OPTION_LABEL = SUBSCRIPTION_OBJECTIVE_OPTION_LABEL;

/**
 * Seed base prices in minor units (cents).
 * Used only when creating an empty catalog — Shopify remains the source of truth.
 */
export const SEED_V2_BASE_PRICE_CENTS_BY_MEAL_COUNT: Record<
  BoxV2MealCount,
  number
> = {
  8: 7600,
  10: 9600,
  12: 12500,
  16: 15800,
  20: 18000,
  24: 20000,
};

/**
 * Seed objective offsets in cents (exact two-decimal Shopify money strings).
 * Used only when creating an empty catalog — Shopify remains the source of truth.
 */
export const SEED_V2_OBJECTIVE_PRICE_OFFSET_CENTS: Record<
  SubscriptionObjective,
  number
> = {
  [SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]: 11,
  [SUBSCRIPTION_OBJECTIVE.BALANCED]: 22,
  [SUBSCRIPTION_OBJECTIVE.BULK]: 33,
};

/** Euro amounts for docs — derived from cents, not used for Shopify writes. */
export const SEED_V2_BASE_PRICE_BY_MEAL_COUNT: Record<
  BoxV2MealCount,
  number
> = {
  8: 76,
  10: 96,
  12: 125,
  16: 158,
  20: 180,
  24: 200,
};

export const SEED_V2_OBJECTIVE_PRICE_OFFSET: Record<
  SubscriptionObjective,
  number
> = {
  [SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]: 0.11,
  [SUBSCRIPTION_OBJECTIVE.BALANCED]: 0.22,
  [SUBSCRIPTION_OBJECTIVE.BULK]: 0.33,
};

export type BoxV2VariantSpec = {
  mealCount: BoxV2MealCount;
  objective: SubscriptionObjective;
  mealCountOptionLabel: string;
  objectiveOptionLabel: string;
  /** Seed Shopify Money string for empty-catalog create only. */
  price: string;
  objectiveMetafieldValue: SubscriptionObjective;
  mealCountMetafieldValue: string;
};

const formatShopifyMoneyFromCents = (cents: number): string => {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Invalid seed V2 price cents: ${cents}`);
  }

  const euros = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${euros}.${String(remainder).padStart(2, "0")}`;
};

/** Seed variant price for empty-catalog create — not a runtime source of truth. */
export const getSeedV2VariantPrice = (
  mealCount: BoxV2MealCount,
  objective: SubscriptionObjective,
): string => {
  const baseCents = SEED_V2_BASE_PRICE_CENTS_BY_MEAL_COUNT[mealCount];
  const offsetCents = SEED_V2_OBJECTIVE_PRICE_OFFSET_CENTS[objective];
  return formatShopifyMoneyFromCents(baseCents + offsetCents);
};

/**
 * Cartesian product of meal counts × objectives in stable provisioning order.
 */
export const getBoxV2VariantSpecs = (): BoxV2VariantSpec[] => {
  const specs: BoxV2VariantSpec[] = [];

  for (const mealCount of BOX_V2_MEAL_COUNTS) {
    for (const objective of SUBSCRIPTION_OBJECTIVES) {
      specs.push({
        mealCount,
        objective,
        mealCountOptionLabel: BOX_V2_MEAL_COUNT_OPTION_LABEL[mealCount],
        objectiveOptionLabel: BOX_V2_OBJECTIVE_OPTION_LABEL[objective],
        price: getSeedV2VariantPrice(mealCount, objective),
        objectiveMetafieldValue: objective,
        mealCountMetafieldValue: String(mealCount),
      });
    }
  }

  return specs;
};
