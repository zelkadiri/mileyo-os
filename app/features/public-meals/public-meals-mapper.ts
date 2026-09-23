/**
 * MealCatalogProduct → PublicMeal mapper.
 *
 * Strips all commerce / Admin identifiers. Never copies product id, variantId,
 * handle, price, selling plans, or inventory.
 */

import { SUBSCRIPTION_OBJECTIVE } from "../../constants/subscriptionObjective";
import type { MealCatalogProduct } from "../../services/subscriptionMealCatalog.server";
import type { PublicMeal } from "./public-meals-types";

/**
 * Display calories: prefer the balanced objective variant, else null.
 * Never exposes which variant was used.
 */
const displayCalories = (product: MealCatalogProduct): number | null => {
  const balanced = product.variants.find(
    (variant) => variant.objective === SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  return balanced?.calories ?? null;
};

export const toPublicMeal = (product: MealCatalogProduct): PublicMeal => {
  const imageUrl = product.imageUrl?.trim() || null;
  const altText = product.imageAlt?.trim() || null;

  return {
    title: product.title,
    image: imageUrl
      ? {
          url: imageUrl,
          altText: altText || null,
        }
      : null,
    description: product.description,
    allergens: [...product.allergenes],
    ingredients: [...product.ingredients],
    badges: [...product.badges],
    calories: displayCalories(product),
  };
};

export const toPublicMeals = (
  products: readonly MealCatalogProduct[],
): PublicMeal[] => products.map(toPublicMeal);
