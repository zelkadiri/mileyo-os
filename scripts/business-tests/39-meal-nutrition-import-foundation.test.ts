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
  saturatedFat: null,
  sugars: null,
  fiber: null,
  salt: null,
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

  ctx.scenario("E. Nouveaux champs optionnels — null sans write");
  const nullOptional = buildMealNutritionMetafieldsSetInputs(validRow());
  ctx.assertEqual("legacy row five metafields", nullOptional.length, 5);
  ctx.assertFalse(
    "no saturated_fat when null",
    nullOptional.some((entry) => entry.key === "saturated_fat"),
  );
  ctx.assertFalse(
    "no sugars when null",
    nullOptional.some((entry) => entry.key === "sugars"),
  );
  ctx.assertFalse(
    "no fiber when null",
    nullOptional.some((entry) => entry.key === "fiber"),
  );
  ctx.assertFalse(
    "no salt when null",
    nullOptional.some((entry) => entry.key === "salt"),
  );

  ctx.scenario("F. Nouveaux champs — zéro accepté et écrit");
  const zeroOptional = buildMealNutritionMetafieldsSetInputs(
    validRow({
      saturatedFat: 0,
      sugars: 0,
      fiber: 0,
      salt: 0,
    }),
  );
  ctx.assertEqual("zero optional row nine metafields", zeroOptional.length, 9);
  ctx.assertEqual(
    "saturated_fat zero written",
    zeroOptional.find((entry) => entry.key === "saturated_fat")?.value,
    "0",
  );
  ctx.assertEqual(
    "sugars zero written",
    zeroOptional.find((entry) => entry.key === "sugars")?.value,
    "0",
  );
  ctx.assertEqual(
    "fiber zero written",
    zeroOptional.find((entry) => entry.key === "fiber")?.value,
    "0",
  );
  ctx.assertEqual(
    "salt zero written",
    zeroOptional.find((entry) => entry.key === "salt")?.value,
    "0",
  );
  const zeroValidation = validateMealNutritionImportRows([
    validRow({ saturatedFat: 0, sugars: 0, fiber: 0, salt: 0 }),
  ]);
  ctx.assertTrue("zero optional validation ok", zeroValidation.ok);

  ctx.scenario("G. Nouveaux champs — négatif / invalide rejetés");
  const invalidOptional = validateMealNutritionImportRows([
    validRow({
      saturatedFat: -1,
      sugars: Number.NaN,
      fiber: -0.5,
      salt: Number.NaN,
    }),
  ]);
  ctx.assertFalse("invalid optional not ok", invalidOptional.ok);
  ctx.assertTrue(
    "invalid_saturated_fat",
    invalidOptional.issues.some((issue) => issue.code === "invalid_saturated_fat"),
  );
  ctx.assertTrue(
    "invalid_sugars",
    invalidOptional.issues.some((issue) => issue.code === "invalid_sugars"),
  );
  ctx.assertTrue(
    "invalid_fiber",
    invalidOptional.issues.some((issue) => issue.code === "invalid_fiber"),
  );
  ctx.assertTrue(
    "invalid_salt",
    invalidOptional.issues.some((issue) => issue.code === "invalid_salt"),
  );

  ctx.scenario("H. Row complète 4 nouveaux champs — 9 metafields anti-swap");
  const fullOptional = buildMealNutritionMetafieldsSetInputs(
    validRow({
      saturatedFat: 1.1,
      sugars: 2.2,
      fiber: 7.7,
      salt: 0.4,
    }),
  );
  ctx.assertEqual("full optional nine metafields", fullOptional.length, 9);
  ctx.assertEqual(
    "saturated_fat maps 1.1",
    fullOptional.find((entry) => entry.key === "saturated_fat")?.value,
    "1.1",
  );
  ctx.assertEqual(
    "sugars maps 2.2",
    fullOptional.find((entry) => entry.key === "sugars")?.value,
    "2.2",
  );
  ctx.assertEqual(
    "fiber maps 7.7",
    fullOptional.find((entry) => entry.key === "fiber")?.value,
    "7.7",
  );
  ctx.assertEqual(
    "salt maps 0.4",
    fullOptional.find((entry) => entry.key === "salt")?.value,
    "0.4",
  );

  return finishSuite("39-meal-nutrition-import-foundation", ctx);
};

process.exitCode = runSuite();
