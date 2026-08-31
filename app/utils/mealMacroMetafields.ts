/**
 * Variant-level meal macro metafield parsers (custom namespace).
 *
 * Distinct from product-level helpers in mealMetafields.ts used by the legacy builder.
 */

const POSITIVE_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;

const parsePositiveNumericMetafield = (
  value: string | null | undefined,
): number | null => {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed || !POSITIVE_NUMBER_PATTERN.test(trimmed)) return null;

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Nutrition fields where 0 is valid (saturated fat, sugars, fiber, salt). */
const parseNonNegativeNumericMetafield = (
  value: string | null | undefined,
): number | null => {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed || !POSITIVE_NUMBER_PATTERN.test(trimmed)) return null;

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const parseVariantCaloriesMetafield = parsePositiveNumericMetafield;

export const parseVariantProteinsMetafield = parsePositiveNumericMetafield;

export const parseVariantCarbsMetafield = parsePositiveNumericMetafield;

export const parseVariantFatMetafield = parsePositiveNumericMetafield;

export const parseVariantSaturatedFatMetafield = parseNonNegativeNumericMetafield;

export const parseVariantSugarsMetafield = parseNonNegativeNumericMetafield;

export const parseVariantFiberMetafield = parseNonNegativeNumericMetafield;

export const parseVariantSaltMetafield = parseNonNegativeNumericMetafield;

export const parseVariantPortionGramsMetafield = parsePositiveNumericMetafield;
