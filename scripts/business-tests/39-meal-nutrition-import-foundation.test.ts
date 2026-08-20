/**
 * Business regression — 14A meal nutrition import foundation.
 *
 * Pure validation + metafield mapping only. No Shopify / Prisma / UI.
 */
import {
  buildMealNutritionMetafieldsSetInputs,
  buildMealNutritionWritePlans,
  MEAL_NUTRITION_METAFIELD_KEYS,
  MEAL_NUTRITION_METAFIELD_NAMESPACE,
  validateMealNutritionImportRows,
  type MealNutritionImportRow,
} from "../../app/utils/mealNutritionImport";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const validRow = (
  overrides: Partial<MealNutritionImportRow> = {},
): MealNutritionImportRow => ({
  variantId: "gid://shopify/ProductVariant/1001",
  productTitle: "Plat test",
  objective: "balanced",
  calories: 450,
  proteins: 38.5,
  carbs: 35,
  fat: 12,
  portionGrams: 350,
  ...overrides,
});

const runSuite = () => {
  const ctx = createBusinessTestContext("39-meal-nutrition-import-foundation");

  ctx.scenario("A. Validation — valeurs positives acceptées");
  const ok = validateMealNutritionImportRows([validRow()]);
  ctx.assertTrue("valid row ok", ok.ok);
  ctx.assertEqual("validRows length", ok.validRows.length, 1);
  ctx.assertEqual("no issues", ok.issues.length, 0);
  ctx.assertEqual(
    "trimmed variantId",
    ok.validRows[0]?.variantId,
    "gid://shopify/ProductVariant/1001",
  );

  ctx.scenario("B. Validation — rejet valeurs nulles / zéro / manquantes");
  const rejected = validateMealNutritionImportRows([
    validRow({
      variantId: "   ",
      calories: 0,
      proteins: 0,
      carbs: -1,
      fat: Number.NaN,
      portionGrams: 0,
    }),
  ]);
  ctx.assertFalse("invalid row not ok", rejected.ok);
  ctx.assertEqual("validRows empty", rejected.validRows.length, 0);
  ctx.assertTrue(
    "missing_variant_id",
    rejected.issues.some((issue) => issue.code === "missing_variant_id"),
  );
  ctx.assertTrue(
    "invalid_calories",
    rejected.issues.some((issue) => issue.code === "invalid_calories"),
  );
  ctx.assertTrue(
    "invalid_proteins",
    rejected.issues.some((issue) => issue.code === "invalid_proteins"),
  );
  ctx.assertTrue(
    "invalid_carbs",
    rejected.issues.some((issue) => issue.code === "invalid_carbs"),
  );
  ctx.assertTrue(
    "invalid_fat",
    rejected.issues.some((issue) => issue.code === "invalid_fat"),
  );
  ctx.assertTrue(
    "invalid_portion_grams",
    rejected.issues.some((issue) => issue.code === "invalid_portion_grams"),
  );

  ctx.scenario("C. Mapping metafields — PRODUCTVARIANT custom.* uniquement");
  const metafields = buildMealNutritionMetafieldsSetInputs(validRow());
  ctx.assertEqual("five metafields", metafields.length, 5);
  ctx.assertEqual(
    "keys order",
    metafields.map((entry) => entry.key).join("|"),
    MEAL_NUTRITION_METAFIELD_KEYS.join("|"),
  );
  ctx.assertTrue(
    "all custom namespace",
    metafields.every(
      (entry) => entry.namespace === MEAL_NUTRITION_METAFIELD_NAMESPACE,
    ),
  );
  ctx.assertTrue(
    "ownerId is variantId",
    metafields.every(
      (entry) => entry.ownerId === "gid://shopify/ProductVariant/1001",
    ),
  );
  ctx.assertEqual(
    "calories type",
    metafields.find((entry) => entry.key === "calories")?.type,
    "number_integer",
  );
  ctx.assertEqual(
    "proteins type",
    metafields.find((entry) => entry.key === "proteins")?.type,
    "number_decimal",
  );
  ctx.assertEqual(
    "portion_grams value",
    metafields.find((entry) => entry.key === "portion_grams")?.value,
    "350",
  );
  ctx.assertEqual(
    "proteins value preserves decimal",
    metafields.find((entry) => entry.key === "proteins")?.value,
    "38.5",
  );

  const plans = buildMealNutritionWritePlans([validRow(), validRow({
    variantId: "gid://shopify/ProductVariant/1002",
    calories: 600,
  })]);
  ctx.assertEqual("write plans count", plans.length, 2);
  ctx.assertEqual(
    "second plan calories",
    plans[1]?.metafields.find((entry) => entry.key === "calories")?.value,
    "600",
  );

  ctx.scenario("D. Calories / portion non-entiers rejetés");
  const nonInteger = validateMealNutritionImportRows([
    validRow({ calories: 420.5, portionGrams: 350.2 }),
  ]);
  ctx.assertFalse("non-integer macros rejected", nonInteger.ok);
  ctx.assertTrue(
    "invalid calories decimal",
    nonInteger.issues.some((issue) => issue.code === "invalid_calories"),
  );
  ctx.assertTrue(
    "invalid portion decimal",
    nonInteger.issues.some((issue) => issue.code === "invalid_portion_grams"),
  );

  return finishSuite("39-meal-nutrition-import-foundation", ctx);
};

process.exitCode = runSuite();
