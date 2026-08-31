/**
 * Meal nutrition export template — pure flatten + CSV.
 *
 * One row per meal variant. Same column contract as future import
 * (see MealNutritionImportRow). Never invents macro values.
 */

export const MEAL_NUTRITION_EXPORT_FILENAME =
  "mileyo-meal-nutrition-template.csv";

/** Current export + new import schema — 13 columns. */
export const MEAL_NUTRITION_EXPORT_HEADERS = [
  "variantId",
  "productTitle",
  "variantTitle",
  "objective",
  "calories",
  "proteins",
  "carbs",
  "fat",
  "saturatedFat",
  "sugars",
  "fiber",
  "salt",
  "portionGrams",
] as const;

/** Legacy import schema — 9 columns (historical Excel templates). */
export const MEAL_NUTRITION_LEGACY_EXPORT_HEADERS = [
  "variantId",
  "productTitle",
  "variantTitle",
  "objective",
  "calories",
  "proteins",
  "carbs",
  "fat",
  "portionGrams",
] as const;

/** Minimal catalog shape — compatible with MealCatalogProduct. */
export type MealNutritionExportCatalogVariant = {
  variantId: string;
  variantTitle: string;
  objective: string | null;
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  saturatedFat?: number | null;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
  portionGrams: number | null;
};

export type MealNutritionExportCatalogProduct = {
  title: string;
  variants: readonly MealNutritionExportCatalogVariant[];
};

export type MealNutritionExportRow = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  objective: string;
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  saturatedFat: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  portionGrams: number | null;
};

const escapeCsvValue = (value: unknown) => {
  const stringValue = value == null ? "" : String(value);

  return `"${stringValue.replace(/"/g, '""')}"`;
};

/** Flattens catalog products × variants. Skips rows without variantId. */
export const flattenMealCatalogToExportRows = (
  products: readonly MealNutritionExportCatalogProduct[],
): MealNutritionExportRow[] => {
  const rows: MealNutritionExportRow[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const variantId = variant.variantId?.trim() ?? "";
      if (!variantId) {
        continue;
      }

      rows.push({
        variantId,
        productTitle: product.title,
        variantTitle: variant.variantTitle,
        objective: variant.objective ?? "",
        calories: variant.calories,
        proteins: variant.proteins,
        carbs: variant.carbs,
        fat: variant.fat,
        saturatedFat: variant.saturatedFat ?? null,
        sugars: variant.sugars ?? null,
        fiber: variant.fiber ?? null,
        salt: variant.salt ?? null,
        portionGrams: variant.portionGrams,
      });
    }
  }

  return rows;
};

export const buildMealNutritionExportCsvRow = (
  row: MealNutritionExportRow,
) => [
  row.variantId,
  row.productTitle,
  row.variantTitle,
  row.objective,
  row.calories,
  row.proteins,
  row.carbs,
  row.fat,
  row.saturatedFat,
  row.sugars,
  row.fiber,
  row.salt,
  row.portionGrams,
];

export const buildMealNutritionExportCsvContent = (
  products: readonly MealNutritionExportCatalogProduct[],
) => {
  const dataRows = flattenMealCatalogToExportRows(products).map(
    buildMealNutritionExportCsvRow,
  );
  const rows = [MEAL_NUTRITION_EXPORT_HEADERS, ...dataRows];

  return rows
    .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
    .join("\n");
};

/** Client-side Blob download — same pattern as orders/preparation exports. */
export const downloadMealNutritionCsv = (
  csv: string,
  filename: string = MEAL_NUTRITION_EXPORT_FILENAME,
) => {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
