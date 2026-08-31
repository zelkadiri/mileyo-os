/**
 * Meal nutrition import foundation — pure types, validation, and metafield mapping.
 *
 * Future Excel rows will map to MealNutritionImportRow.
 * Shopify writes stay in mealNutritionImport.server.ts (PRODUCTVARIANT only).
 */

export const MEAL_NUTRITION_METAFIELD_NAMESPACE = "custom" as const;

/** Always written for a valid import row. */
export const MEAL_NUTRITION_METAFIELD_KEYS = [
  "calories",
  "proteins",
  "carbs",
  "fat",
  "portion_grams",
] as const;

/** Written only when the CSV cell is non-empty (PATCH semantics). */
export const MEAL_NUTRITION_OPTIONAL_METAFIELD_KEYS = [
  "saturated_fat",
  "sugars",
  "fiber",
  "salt",
] as const;

export type MealNutritionMetafieldKey =
  | (typeof MEAL_NUTRITION_METAFIELD_KEYS)[number]
  | (typeof MEAL_NUTRITION_OPTIONAL_METAFIELD_KEYS)[number];

/** Row shape aligned with the Excel nutrition import (legacy + new schema). */
export type MealNutritionImportRow = {
  variantId: string;
  productTitle?: string;
  objective?: string;
  calories: number;
  proteins: number;
  carbs: number;
  fat: number;
  saturatedFat: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  portionGrams: number;
};

export type MealNutritionImportIssueCode =
  | "missing_variant_id"
  | "invalid_calories"
  | "invalid_proteins"
  | "invalid_carbs"
  | "invalid_fat"
  | "invalid_saturated_fat"
  | "invalid_sugars"
  | "invalid_fiber"
  | "invalid_salt"
  | "invalid_portion_grams"
  | "invalid_headers"
  | "duplicate_variant_id"
  | "empty_file"
  | "parse_error"
  /** Reserved for later: Shopify catalog lookup. */
  | "variant_not_found"
  /** Reserved for later: mileyo.objective mismatch. */
  | "objective_mismatch";

export type MealNutritionImportIssue = {
  code: MealNutritionImportIssueCode;
  message: string;
  rowIndex: number;
};

export type MealNutritionImportValidationResult = {
  issues: MealNutritionImportIssue[];
  ok: boolean;
  validRows: MealNutritionImportRow[];
};

export type MealNutritionMetafieldSetInput = {
  key: MealNutritionMetafieldKey;
  namespace: typeof MEAL_NUTRITION_METAFIELD_NAMESPACE;
  ownerId: string;
  type: "number_integer" | "number_decimal";
  value: string;
};

/** Values that would be written for one variant (dry-run + apply). */
export type MealNutritionWritePlan = {
  metafields: MealNutritionMetafieldSetInput[];
  productTitle?: string;
  objective?: string;
  variantId: string;
};

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isPositiveInteger = (value: unknown): value is number =>
  isPositiveNumber(value) && Number.isInteger(value);

const isValidOptionalNutritionValue = (value: number | null): boolean =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value >= 0);

/**
 * Pure row validation.
 * Catalog / objective / dry-run-diff checks are reserved (issue codes above).
 */
export const validateMealNutritionImportRows = (
  rows: readonly MealNutritionImportRow[],
): MealNutritionImportValidationResult => {
  const issues: MealNutritionImportIssue[] = [];
  const validRows: MealNutritionImportRow[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) {
      continue;
    }

    const rowIssues: MealNutritionImportIssue[] = [];

    if (!row.variantId?.trim()) {
      rowIssues.push({
        code: "missing_variant_id",
        message: "variantId manquant.",
        rowIndex,
      });
    }

    if (!isPositiveInteger(row.calories)) {
      rowIssues.push({
        code: "invalid_calories",
        message: "calories doit être un entier > 0.",
        rowIndex,
      });
    }

    if (!isPositiveNumber(row.proteins)) {
      rowIssues.push({
        code: "invalid_proteins",
        message: "proteins doit être un nombre > 0.",
        rowIndex,
      });
    }

    if (!isPositiveNumber(row.carbs)) {
      rowIssues.push({
        code: "invalid_carbs",
        message: "carbs doit être un nombre > 0.",
        rowIndex,
      });
    }

    if (!isPositiveNumber(row.fat)) {
      rowIssues.push({
        code: "invalid_fat",
        message: "fat doit être un nombre > 0.",
        rowIndex,
      });
    }

    if (!isValidOptionalNutritionValue(row.saturatedFat)) {
      rowIssues.push({
        code: "invalid_saturated_fat",
        message: "saturatedFat doit être un nombre >= 0 ou vide.",
        rowIndex,
      });
    }

    if (!isValidOptionalNutritionValue(row.sugars)) {
      rowIssues.push({
        code: "invalid_sugars",
        message: "sugars doit être un nombre >= 0 ou vide.",
        rowIndex,
      });
    }

    if (!isValidOptionalNutritionValue(row.fiber)) {
      rowIssues.push({
        code: "invalid_fiber",
        message: "fiber doit être un nombre >= 0 ou vide.",
        rowIndex,
      });
    }

    if (!isValidOptionalNutritionValue(row.salt)) {
      rowIssues.push({
        code: "invalid_salt",
        message: "salt doit être un nombre >= 0 ou vide.",
        rowIndex,
      });
    }

    if (!isPositiveInteger(row.portionGrams)) {
      rowIssues.push({
        code: "invalid_portion_grams",
        message: "portionGrams doit être un entier > 0.",
        rowIndex,
      });
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      continue;
    }

    validRows.push({
      ...row,
      variantId: row.variantId.trim(),
      productTitle: row.productTitle?.trim() || undefined,
      objective: row.objective?.trim() || undefined,
    });
  }

  return {
    issues,
    ok: issues.length === 0,
    validRows,
  };
};

/** Builds PRODUCTVARIANT metafieldsSet inputs — never PRODUCT owners. */
export const buildMealNutritionMetafieldsSetInputs = (
  row: MealNutritionImportRow,
): MealNutritionMetafieldSetInput[] => {
  const ownerId = row.variantId.trim();

  const metafields: MealNutritionMetafieldSetInput[] = [
    {
      key: "calories",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_integer",
      value: String(row.calories),
    },
    {
      key: "proteins",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.proteins),
    },
    {
      key: "carbs",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.carbs),
    },
    {
      key: "fat",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.fat),
    },
    {
      key: "portion_grams",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_integer",
      value: String(row.portionGrams),
    },
  ];

  if (row.saturatedFat !== null) {
    metafields.push({
      key: "saturated_fat",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.saturatedFat),
    });
  }

  if (row.sugars !== null) {
    metafields.push({
      key: "sugars",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.sugars),
    });
  }

  if (row.fiber !== null) {
    metafields.push({
      key: "fiber",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.fiber),
    });
  }

  if (row.salt !== null) {
    metafields.push({
      key: "salt",
      namespace: MEAL_NUTRITION_METAFIELD_NAMESPACE,
      ownerId,
      type: "number_decimal",
      value: String(row.salt),
    });
  }

  return metafields;
};

export const buildMealNutritionWritePlans = (
  rows: readonly MealNutritionImportRow[],
): MealNutritionWritePlan[] =>
  rows.map((row) => ({
    metafields: buildMealNutritionMetafieldsSetInputs(row),
    productTitle: row.productTitle,
    objective: row.objective,
    variantId: row.variantId.trim(),
  }));
