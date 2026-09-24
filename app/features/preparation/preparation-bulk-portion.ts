import { SUBSCRIPTION_OBJECTIVE } from "../../constants/subscriptionObjective";
import type { MealCatalogProduct } from "../../services/subscriptionMealCatalog.server";
import type { PreparationMealTotal } from "./preparation-types";

/**
 * Build exact-title → bulk portionGrams lookup from a meal catalog snapshot.
 *
 * Ambiguous titles (multiple products with the same exact title) map to null.
 * Missing bulk variant or null/invalid portionGrams → null.
 */
export const buildBulkPortionGramsByMealTitle = (
  products: readonly MealCatalogProduct[],
): Map<string, number | null> => {
  const productsByTitle = new Map<string, MealCatalogProduct[]>();

  for (const product of products) {
    const matches = productsByTitle.get(product.title) ?? [];
    matches.push(product);
    productsByTitle.set(product.title, matches);
  }

  const lookup = new Map<string, number | null>();

  for (const [title, matches] of productsByTitle) {
    if (matches.length !== 1) {
      lookup.set(title, null);
      continue;
    }

    const bulkVariant = matches[0]?.variants.find(
      (variant) => variant.objective === SUBSCRIPTION_OBJECTIVE.BULK,
    );

    lookup.set(title, bulkVariant?.portionGrams ?? null);
  }

  return lookup;
};

/** Attach live bulk portion grams after aggregation — never invents values. */
export const enrichMealTotalsWithBulkPortionGrams = (
  mealTotals: readonly PreparationMealTotal[],
  bulkPortionGramsByTitle: ReadonlyMap<string, number | null>,
): PreparationMealTotal[] =>
  mealTotals.map((meal) => {
    if (meal.objectiveQuantities.bulk <= 0) {
      return { ...meal, bulkPortionGrams: null };
    }

    return {
      ...meal,
      bulkPortionGrams: bulkPortionGramsByTitle.has(meal.mealTitle)
        ? (bulkPortionGramsByTitle.get(meal.mealTitle) ?? null)
        : null,
    };
  });

/** CSV cell: numeric grams, or empty when bulk=0 / unresolved. Never writes 0 for unknown. */
export const formatBulkPortionGramsCsvCell = (
  mealTotal: PreparationMealTotal,
): number | "" => {
  if (mealTotal.objectiveQuantities.bulk <= 0) {
    return "";
  }

  if (mealTotal.bulkPortionGrams == null) {
    return "";
  }

  return mealTotal.bulkPortionGrams;
};
