export const MILEYO_MEAL_COUNT_METAFIELD_NAMESPACE = "mileyo";
export const MILEYO_MEAL_COUNT_METAFIELD_KEY = "meal_count";

const MIN_MEAL_COUNT = 1;
const MAX_MEAL_COUNT = 100;

/** Parses `mileyo.meal_count` metafield values into a positive integer or null. */
export const parseMealCountMetafield = (
  value: string | null | undefined,
): number | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (
    !Number.isFinite(parsed) ||
    parsed < MIN_MEAL_COUNT ||
    parsed > MAX_MEAL_COUNT
  ) {
    return null;
  }

  return parsed;
};

export const isValidMealCountInput = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  return parseMealCountMetafield(trimmed) !== null;
};

export const warnMissingMealCountMetafield = (
  productId: string,
  title: string,
) => {
  console.warn(
    "[meal_count] Box product missing valid mileyo.meal_count metafield",
    { productId, title },
  );
};
