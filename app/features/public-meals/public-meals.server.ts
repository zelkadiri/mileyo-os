/**
 * Public "Nos Plats" meal catalog — display-only App Proxy source.
 *
 * Uses Admin GraphQL (unpublished Online Store meals still visible).
 * Collection order: COLLECTION_DEFAULT (theme / merchant order).
 * Cache: process-local TTL keyed by shop + mealCollectionId.
 */

import {
  PUBLIC_MEALS_CACHE_TTL_MS,
  getOrFetchBuilderCatalog,
  publicMealsCacheKey,
} from "../builder/builder-catalog-cache.server";
import { fetchMealCatalogProducts } from "../../services/subscriptionMealCatalog.server";
import { toPublicMeals } from "./public-meals-mapper";
import type { PublicMeal } from "./public-meals-types";

export type PublicMealsAdmin = {
  graphql: (
    query: string,
    options?: {
      variables?: { id: string; sortKey?: "TITLE" | "COLLECTION_DEFAULT" };
    },
  ) => Promise<Response>;
};

/**
 * Live Admin fetch → PublicMeal[]. Uses collection default order
 * (not TITLE) so storefront order matches Liquid collection.products.
 */
export const fetchPublicMeals = async (
  admin: PublicMealsAdmin,
  mealCollectionId: string,
): Promise<PublicMeal[]> => {
  const catalog = await fetchMealCatalogProducts(admin, mealCollectionId, {
    sortKey: "COLLECTION_DEFAULT",
  });
  return toPublicMeals(catalog);
};

/**
 * Cached public meals for storefront App Proxy GET.
 * Keyed by shop + mealCollectionId — never mixes boutiques.
 */
export const fetchCachedPublicMeals = async (
  admin: PublicMealsAdmin,
  mealCollectionId: string,
  shop: string,
): Promise<{ cacheHit: boolean; meals: PublicMeal[] }> => {
  const { cacheHit, value } = await getOrFetchBuilderCatalog({
    fetch: () => fetchPublicMeals(admin, mealCollectionId),
    key: publicMealsCacheKey(shop, mealCollectionId),
    kind: "publicMeals",
    ttlMs: PUBLIC_MEALS_CACHE_TTL_MS,
  });
  return { cacheHit, meals: value };
};
