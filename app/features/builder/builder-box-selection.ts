import {
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import type { BuilderBoxOption } from "./builder-types";

/** Client-side objective filter — match canonical objective values only. */
export const filterBuilderBoxesByObjective = (
  boxes: readonly BuilderBoxOption[],
  objective: SubscriptionObjective | null | undefined,
): BuilderBoxOption[] => {
  if (!objective) {
    return [];
  }

  return boxes.filter((box) => box.objective === objective);
};

export const shouldResetBoxOnObjectiveChange = (
  selectedBox: BuilderBoxOption | null | undefined,
  nextObjective: SubscriptionObjective | null | undefined,
): boolean =>
  Boolean(
    selectedBox &&
      nextObjective &&
      selectedBox.objective !== nextObjective,
  );

export type BuilderBoxSelectionReset = {
  selectedBox: null;
  requiredMeals: 0;
  selectedMeals: Record<string, never>;
  mealsRendered: false;
};

export const createBuilderBoxSelectionReset = (): BuilderBoxSelectionReset => ({
  selectedBox: null,
  requiredMeals: 0,
  selectedMeals: {},
  mealsRendered: false,
});

export const isBuilderBoxCtaEnabled = (
  selectedBox: BuilderBoxOption | null | undefined,
): boolean => Boolean(selectedBox?.sellingPlanId && selectedBox.mealCount > 0);

export const findBuilderBoxByVariantId = (
  boxes: readonly BuilderBoxOption[],
  variantId: string | null | undefined,
): BuilderBoxOption | null => {
  if (!variantId) {
    return null;
  }

  return boxes.find((box) => box.variantId === variantId) ?? null;
};

/** Parse Shopify Money-like strings for comparison only — invalid → null. */
export const parseBuilderBoxPriceAmount = (
  price: string | null | undefined,
): number | null => {
  if (price == null) {
    return null;
  }

  const trimmed = price.trim().replace(",", ".");
  if (!trimmed) {
    return null;
  }

  const amount = Number.parseFloat(trimmed);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return amount;
};

/**
 * Lowest BuilderBoxOption.price for an objective among checkout-ready boxes.
 * Returns the original price string of the minimum option, or null.
 */
export const getStartingPriceForObjective = (
  boxes: readonly BuilderBoxOption[],
  objective: SubscriptionObjective,
): string | null => {
  let minAmount: number | null = null;
  let minPrice: string | null = null;

  for (const box of boxes) {
    if (box.objective !== objective) {
      continue;
    }

    const amount = parseBuilderBoxPriceAmount(box.price);
    if (amount === null) {
      continue;
    }

    if (minAmount === null || amount < minAmount) {
      minAmount = amount;
      minPrice = box.price.trim();
    }
  }

  return minPrice;
};

export const getStartingPricesByObjective = (
  boxes: readonly BuilderBoxOption[],
): Partial<Record<SubscriptionObjective, string>> => {
  const prices: Partial<Record<SubscriptionObjective, string>> = {};

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    const price = getStartingPriceForObjective(boxes, objective);
    if (price !== null) {
      prices[objective] = price;
    }
  }

  return prices;
};

/** French EUR display — whole euros without trailing ,00 when possible. */
export const formatEuroAmountFr = (price: string): string | null => {
  const amount = parseBuilderBoxPriceAmount(price);
  if (amount === null) {
    return null;
  }

  const cents = Math.round(amount * 100);
  const hasFraction = cents % 100 !== 0;

  return new Intl.NumberFormat("fr-FR", {
    currency: "EUR",
    maximumFractionDigits: 2,
    minimumFractionDigits: hasFraction ? 2 : 0,
    style: "currency",
  }).format(amount);
};

export const formatObjectiveStartingPriceLabel = (
  price: string,
): string | null => {
  const formatted = formatEuroAmountFr(price);
  if (!formatted) {
    return null;
  }

  return `À partir de ${formatted}/semaine`;
};

export const getObjectiveStartingPriceLabels = (
  boxes: readonly BuilderBoxOption[],
): Partial<Record<SubscriptionObjective, string>> => {
  const labels: Partial<Record<SubscriptionObjective, string>> = {};

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    const price = getStartingPriceForObjective(boxes, objective);
    if (!price) {
      continue;
    }

    const label = formatObjectiveStartingPriceLabel(price);
    if (label) {
      labels[objective] = label;
    }
  }

  return labels;
};
