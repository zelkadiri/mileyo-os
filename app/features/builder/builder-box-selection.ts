import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../constants/firstBoxLaunchDiscount";
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

/** Display-only launch pricing for a Box (never billed / never sent to cart). */
export type BuilderLaunchPricing = {
  launchPriceCents: number;
  launchPricePerMealCents: number;
  regularPriceCents: number;
};

/** Parse a Shopify money-like value into integer cents. Invalid → null. */
export const parseBuilderPriceToCents = (
  price: string | number | null | undefined,
): number | null => {
  if (typeof price === "number") {
    if (!Number.isFinite(price) || price < 0) {
      return null;
    }
    return Math.round(price * 100);
  }

  const amount = parseBuilderBoxPriceAmount(price);
  if (amount === null) {
    return null;
  }

  return Math.round(amount * 100);
};

/**
 * UI-only first-box launch pricing.
 *
 * launchPrice = max(0, regular − FIRST_BOX_LAUNCH_DISCOUNT_EUR)
 * launchPricePerMeal = round(launchPrice / mealCount)
 *
 * Does not bill, mutate Shopify, or assert eligibility.
 */
export const getBuilderLaunchPricing = ({
  mealCount,
  regularPrice,
}: {
  mealCount: number | null | undefined;
  regularPrice: string | number | null | undefined;
}): BuilderLaunchPricing | null => {
  if (
    typeof mealCount !== "number" ||
    !Number.isFinite(mealCount) ||
    mealCount <= 0 ||
    !Number.isInteger(mealCount)
  ) {
    return null;
  }

  const regularPriceCents = parseBuilderPriceToCents(regularPrice);
  if (regularPriceCents === null) {
    return null;
  }

  const discountCents = Math.round(FIRST_BOX_LAUNCH_DISCOUNT_EUR * 100);
  const launchPriceCents = Math.max(0, regularPriceCents - discountCents);
  const launchPricePerMealCents = Math.round(launchPriceCents / mealCount);

  return {
    launchPriceCents,
    launchPricePerMealCents,
    regularPriceCents,
  };
};

/** Format integer cents as fr-FR EUR (same currency style as builder client). */
export const formatCentsAsEuroFr = (cents: number): string => {
  if (!Number.isFinite(cents)) {
    return "";
  }

  return new Intl.NumberFormat("fr-FR", {
    currency: "EUR",
    style: "currency",
  }).format(cents / 100);
};

/**
 * Lowest-priced checkout-ready Box for an objective.
 * Launch + recurring labels must both derive from this same variant.
 */
export const getStartingBoxForObjective = (
  boxes: readonly BuilderBoxOption[],
  objective: SubscriptionObjective,
): BuilderBoxOption | null => {
  let minAmount: number | null = null;
  let minBox: BuilderBoxOption | null = null;

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
      minBox = box;
    }
  }

  return minBox;
};

/**
 * Lowest BuilderBoxOption.price for an objective among checkout-ready boxes.
 * Returns the original price string of the minimum option, or null.
 */
export const getStartingPriceForObjective = (
  boxes: readonly BuilderBoxOption[],
  objective: SubscriptionObjective,
): string | null => {
  const box = getStartingBoxForObjective(boxes, objective);
  return box ? box.price.trim() : null;
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

/** Fallback when launch pricing cannot be computed. */
export const formatObjectiveStartingPriceLabel = (
  price: string,
): string | null => {
  const formatted = formatEuroAmountFr(price);
  if (!formatted) {
    return null;
  }

  return `À partir de ${formatted} / semaine`;
};

/** Display-only objective card pricing (same reference Box for both lines). */
export type ObjectiveStartingPriceLabelSet = {
  launchLine: string | null;
  recurringLine: string;
};

export const formatObjectiveLaunchStartingPriceLabel = (
  launchPriceCents: number,
): string =>
  `À partir de ${formatCentsAsEuroFr(launchPriceCents)} la première box*`;

export const formatObjectiveRecurringStartingPriceLabel = (
  regularPriceCents: number,
): string =>
  `Puis à partir de ${formatCentsAsEuroFr(regularPriceCents)} / semaine`;

export const getObjectiveStartingPriceLabels = (
  boxes: readonly BuilderBoxOption[],
): Partial<Record<SubscriptionObjective, ObjectiveStartingPriceLabelSet>> => {
  const labels: Partial<
    Record<SubscriptionObjective, ObjectiveStartingPriceLabelSet>
  > = {};

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    const box = getStartingBoxForObjective(boxes, objective);
    if (!box) {
      continue;
    }

    const launch = getBuilderLaunchPricing({
      mealCount: box.mealCount,
      regularPrice: box.price,
    });

    if (launch) {
      labels[objective] = {
        launchLine: formatObjectiveLaunchStartingPriceLabel(
          launch.launchPriceCents,
        ),
        recurringLine: formatObjectiveRecurringStartingPriceLabel(
          launch.regularPriceCents,
        ),
      };
      continue;
    }

    const fallback = formatObjectiveStartingPriceLabel(box.price);
    if (fallback) {
      labels[objective] = {
        launchLine: null,
        recurringLine: fallback,
      };
    }
  }

  return labels;
};
