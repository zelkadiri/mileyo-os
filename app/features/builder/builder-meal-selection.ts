/**
 * Pure meal V2 selection helpers for the subscription builder.
 * Identity = variantId. Filtering uses canonical SubscriptionObjective only.
 */

import type { SubscriptionObjective } from "../../constants/subscriptionObjective";
import type {
  MealCatalogProduct,
  MealCatalogVariant,
} from "../../services/subscriptionMealCatalog.server";
import type { BuilderMealOption } from "./builder-types";

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

const objectivePairKey = (productId: string, objective: SubscriptionObjective) =>
  `${productId}::${objective}`;

/**
 * Flatten meal catalog products into builder-ready options.
 * Invalid variantId / null objective → excluded.
 * Duplicate objectives on the same product → that product+objective pair excluded.
 */
export const toBuilderMealOptions = (
  products: readonly MealCatalogProduct[],
): BuilderMealOption[] => {
  const candidates: {
    product: MealCatalogProduct;
    variant: MealCatalogVariant & { objective: SubscriptionObjective };
  }[] = [];

  for (const product of products) {
    if (isBlank(product.id)) {
      continue;
    }

    for (const variant of product.variants) {
      if (isBlank(variant.variantId) || variant.objective === null) {
        continue;
      }

      candidates.push({
        product,
        variant: {
          ...variant,
          objective: variant.objective,
        },
      });
    }
  }

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = objectivePairKey(
      candidate.product.id,
      candidate.variant.objective,
    );
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const options: BuilderMealOption[] = [];

  for (const candidate of candidates) {
    const key = objectivePairKey(
      candidate.product.id,
      candidate.variant.objective,
    );
    if ((counts.get(key) ?? 0) !== 1) {
      continue;
    }

    options.push({
      allergenes: candidate.product.allergenes,
      badges: candidate.product.badges,
      calories: candidate.variant.calories,
      carbs: candidate.variant.carbs,
      fat: candidate.variant.fat,
      imageAlt: candidate.product.imageAlt,
      imageUrl: candidate.product.imageUrl,
      ingredients: candidate.product.ingredients,
      objective: candidate.variant.objective,
      portionGrams: candidate.variant.portionGrams,
      productId: candidate.product.id,
      proteins: candidate.variant.proteins,
      title: candidate.product.title,
      variantId: candidate.variant.variantId.trim(),
    });
  }

  return options;
};

export const getMealsForObjective = (
  meals: readonly BuilderMealOption[],
  objective: SubscriptionObjective | null | undefined,
): BuilderMealOption[] => {
  if (!objective) {
    return [];
  }

  return meals.filter((meal) => meal.objective === objective);
};

export const findMealByVariantId = (
  meals: readonly BuilderMealOption[],
  variantId: string | null | undefined,
): BuilderMealOption | null => {
  if (!variantId) {
    return null;
  }

  return meals.find((meal) => meal.variantId === variantId) ?? null;
};

export const getSelectedMealsTotal = (
  selectedMeals: Readonly<Record<string, number>>,
): number =>
  Object.values(selectedMeals).reduce((total, quantity) => {
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      return total;
    }
    return total + quantity;
  }, 0);

export const incrementSelectedMealQuantity = (
  selectedMeals: Readonly<Record<string, number>>,
  variantId: string,
  requiredMeals: number,
): Record<string, number> => {
  const next = { ...selectedMeals };
  const total = getSelectedMealsTotal(next);
  if (total >= requiredMeals) {
    return next;
  }

  next[variantId] = (next[variantId] ?? 0) + 1;
  return next;
};

export const decrementSelectedMealQuantity = (
  selectedMeals: Readonly<Record<string, number>>,
  variantId: string,
): Record<string, number> => {
  const next = { ...selectedMeals };
  const current = next[variantId] ?? 0;
  const updated = Math.max(0, current - 1);
  if (updated === 0) {
    delete next[variantId];
  } else {
    next[variantId] = updated;
  }
  return next;
};

/** Build public Plat N properties from selectedMeals indexed by variantId. */
export const buildMealPlatProperties = (
  meals: readonly BuilderMealOption[],
  selectedMeals: Readonly<Record<string, number>>,
): Record<string, string> => {
  const properties: Record<string, string> = {};
  let propertyIndex = 1;

  for (const meal of meals) {
    const quantity = selectedMeals[meal.variantId] ?? 0;
    if (quantity <= 0) {
      continue;
    }

    for (let index = 0; index < quantity; index += 1) {
      properties[`Plat ${propertyIndex}`] = meal.title;
      propertyIndex += 1;
    }
  }

  return properties;
};

export const countUniqueProductIds = (
  meals: readonly BuilderMealOption[],
): number => new Set(meals.map((meal) => meal.productId)).size;
