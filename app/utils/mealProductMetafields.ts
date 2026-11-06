/**
 * PRODUCT-level meal metafield serialization.
 *
 * Types confirmed read-only on DEV shop mileyo-ok1bszwz.myshopify.com
 * (Admin GraphQL 2025-10 metafieldDefinitions, namespace custom):
 * - ingredients → list.single_line_text_field
 * - allergenes → list.single_line_text_field
 * - badge_1|2|3 → single_line_text_field
 *
 * Deserialization stays in mealMetafields.ts (parseListMetafield /
 * parseAllergenesMetafield / parseMealBadges).
 */

import {
  CUSTOM_MEAL_METAFIELD_NAMESPACE,
  normalizeAllergenKey,
  parseAllergenesMetafield,
  parseListMetafield,
  parseMealBadges,
} from "./mealMetafields";

export const MEAL_PRODUCT_METAFIELD_NAMESPACE = CUSTOM_MEAL_METAFIELD_NAMESPACE;

/** Confirmed Shopify Admin types — never invent alternatives. */
export const MEAL_PRODUCT_METAFIELD_TYPES = {
  ingredients: "list.single_line_text_field",
  allergenes: "list.single_line_text_field",
  badge_1: "single_line_text_field",
  badge_2: "single_line_text_field",
  badge_3: "single_line_text_field",
} as const;

export type MealProductMetafieldKey =
  keyof typeof MEAL_PRODUCT_METAFIELD_TYPES;

export type MealProductMetafieldSetInput = {
  key: MealProductMetafieldKey;
  namespace: typeof MEAL_PRODUCT_METAFIELD_NAMESPACE;
  ownerId: string;
  type: (typeof MEAL_PRODUCT_METAFIELD_TYPES)[MealProductMetafieldKey];
  value: string;
};

export type MealProductMetafieldValues = {
  ingredients: string[];
  allergenes: string[];
  badge1: string | null;
  badge2: string | null;
  badge3: string | null;
};

const splitFreeformList = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Accept JSON array paste (same as parseListMetafield).
  if (trimmed.startsWith("[")) {
    return parseListMetafield(trimmed);
  }

  // Comma or newline separated free text from the form.
  return trimmed
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const uniquePreserveOrder = (
  entries: readonly string[],
  keyFn: (value: string) => string = (value) => value.toLocaleLowerCase("fr-FR"),
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const key = keyFn(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
};

/** Serialize a list metafield value for Shopify metafieldsSet. */
export const serializeMealListMetafieldValue = (
  entries: readonly string[],
): string => JSON.stringify([...entries]);

export const parseIngredientsInput = (raw: string): string[] =>
  uniquePreserveOrder(splitFreeformList(raw));

/**
 * Keep merchant-facing allergen labels (as in live catalog samples),
 * dedupe via the same normalizeAllergenKey used by filters.
 */
export const parseAllergenesInput = (raw: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of splitFreeformList(raw)) {
    const key = normalizeAllergenKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(entry.trim());
  }
  return result;
};

export const parseBadgeInput = (raw: string): string | null => {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
};

export const buildMealProductMetafieldValues = (input: {
  ingredients: string;
  allergenes: string;
  badge1: string;
  badge2: string;
  badge3: string;
}): MealProductMetafieldValues => ({
  ingredients: parseIngredientsInput(input.ingredients),
  allergenes: parseAllergenesInput(input.allergenes),
  badge1: parseBadgeInput(input.badge1),
  badge2: parseBadgeInput(input.badge2),
  badge3: parseBadgeInput(input.badge3),
});

/**
 * Builds PRODUCT metafieldsSet inputs.
 * Empty lists / blank badges are omitted (PATCH semantics — do not clear).
 */
export const buildMealProductMetafieldsSetInputs = (
  productId: string,
  values: MealProductMetafieldValues,
): MealProductMetafieldSetInput[] => {
  const ownerId = productId.trim();
  const metafields: MealProductMetafieldSetInput[] = [];

  if (values.ingredients.length > 0) {
    metafields.push({
      key: "ingredients",
      namespace: MEAL_PRODUCT_METAFIELD_NAMESPACE,
      ownerId,
      type: MEAL_PRODUCT_METAFIELD_TYPES.ingredients,
      value: serializeMealListMetafieldValue(values.ingredients),
    });
  }

  if (values.allergenes.length > 0) {
    metafields.push({
      key: "allergenes",
      namespace: MEAL_PRODUCT_METAFIELD_NAMESPACE,
      ownerId,
      type: MEAL_PRODUCT_METAFIELD_TYPES.allergenes,
      value: serializeMealListMetafieldValue(values.allergenes),
    });
  }

  if (values.badge1) {
    metafields.push({
      key: "badge_1",
      namespace: MEAL_PRODUCT_METAFIELD_NAMESPACE,
      ownerId,
      type: MEAL_PRODUCT_METAFIELD_TYPES.badge_1,
      value: values.badge1,
    });
  }

  if (values.badge2) {
    metafields.push({
      key: "badge_2",
      namespace: MEAL_PRODUCT_METAFIELD_NAMESPACE,
      ownerId,
      type: MEAL_PRODUCT_METAFIELD_TYPES.badge_2,
      value: values.badge2,
    });
  }

  if (values.badge3) {
    metafields.push({
      key: "badge_3",
      namespace: MEAL_PRODUCT_METAFIELD_NAMESPACE,
      ownerId,
      type: MEAL_PRODUCT_METAFIELD_TYPES.badge_3,
      value: values.badge3,
    });
  }

  return metafields;
};

/** Round-trip check against catalog parsers. */
export const assertMealProductMetafieldsRoundTrip = (
  values: MealProductMetafieldValues,
  written: {
    ingredients?: string | null;
    allergenes?: string | null;
    badge1?: string | null;
    badge2?: string | null;
    badge3?: string | null;
  },
): { ok: true } | { ok: false; reasons: string[] } => {
  const reasons: string[] = [];

  if (values.ingredients.length > 0) {
    const parsed = parseListMetafield(written.ingredients);
    if (parsed.join("|") !== values.ingredients.join("|")) {
      reasons.push("ingredients round-trip mismatch");
    }
  }

  if (values.allergenes.length > 0) {
    const expected = parseAllergenesMetafield(
      serializeMealListMetafieldValue(values.allergenes),
    );
    const actual = parseAllergenesMetafield(written.allergenes);
    if (expected.join("|") !== actual.join("|")) {
      reasons.push("allergenes round-trip mismatch");
    }
  }

  const expectedBadges = parseMealBadges(
    values.badge1,
    values.badge2,
    values.badge3,
  );
  const actualBadges = parseMealBadges(
    written.badge1,
    written.badge2,
    written.badge3,
  );
  if (
    expectedBadges.length > 0 &&
    expectedBadges.join("|") !== actualBadges.join("|")
  ) {
    reasons.push("badges round-trip mismatch");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true };
};
