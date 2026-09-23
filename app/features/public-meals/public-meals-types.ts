/**
 * Display-only public meal DTO for the Shopify theme (Nos Plats).
 *
 * Intentionally omits all commerce identifiers and checkout affordances:
 * productId, variantId, handle, price, sellingPlanId, inventory, URLs, GIDs.
 */

export type PublicMealImage = {
  url: string;
  altText: string | null;
};

/**
 * Theme-facing meal card. Fields match what our Admin meal catalog actually
 * carries today (no short_description / category / preparation_time metafields).
 *
 * `description` is plain text (Shopify Admin strips HTML). Theme must render
 * via textContent / Liquid escape — never raw HTML / innerHTML.
 *
 * `calories` is a display hint from the balanced objective variant when present.
 */
export type PublicMeal = {
  title: string;
  image: PublicMealImage | null;
  description: string | null;
  allergens: string[];
  ingredients: string[];
  badges: string[];
  calories: number | null;
};

export type PublicMealsSuccessBody = {
  meals: PublicMeal[];
};

export type PublicMealsErrorBody = {
  error: string;
};
