/**
 * Business regression — PRODUCTVARIANT metafield definitions (13E-A2a).
 *
 * Definitions only: no variant value writes, no selling plans, no live Shopify.
 */
import {
  CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT,
  CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT,
  isMetafieldDefinitionAlreadyExistsError,
  PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION,
  toMetafieldDefinitionCreateOutcome,
  VARIANT_MEAL_COUNT_METAFIELD_DEFINITION,
  VARIANT_OBJECTIVE_METAFIELD_DEFINITION,
} from "../../app/features/settings/settings-metafields.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const LEGACY_SAVE_BOX_MEAL_COUNTS_INTENT = "saveBoxMealCounts";
const LEGACY_SETUP_SELLING_PLANS_INTENT = "setupWeeklySellingPlans";
const LEGACY_CREATE_PRODUCT_MEAL_COUNT_INTENT =
  "createMealCountMetafieldDefinition";

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "14-settings-variant-metafield-definitions",
  );

  ctx.scenario("A. Objective definition PRODUCTVARIANT");
  ctx.assertEqual(
    "objective namespace is mileyo",
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION.namespace,
    "mileyo",
  );
  ctx.assertEqual(
    "objective key is objective",
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION.key,
    "objective",
  );
  ctx.assertEqual(
    "objective ownerType is PRODUCTVARIANT",
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION.ownerType,
    "PRODUCTVARIANT",
  );
  ctx.assertEqual(
    "objective type is single_line_text_field",
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION.type,
    "single_line_text_field",
  );

  ctx.scenario("B. Meal count variant definition PRODUCTVARIANT");
  ctx.assertEqual(
    "variant meal_count namespace is mileyo",
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.namespace,
    "mileyo",
  );
  ctx.assertEqual(
    "variant meal_count key is meal_count",
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.key,
    "meal_count",
  );
  ctx.assertEqual(
    "variant meal_count ownerType is PRODUCTVARIANT",
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.ownerType,
    "PRODUCTVARIANT",
  );
  ctx.assertEqual(
    "variant meal_count type is number_integer",
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.type,
    "number_integer",
  );

  ctx.scenario("C. Coexistence legacy PRODUCT meal_count");
  ctx.assertEqual(
    "legacy meal_count namespace is mileyo",
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION.namespace,
    "mileyo",
  );
  ctx.assertEqual(
    "legacy meal_count key is meal_count",
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION.key,
    "meal_count",
  );
  ctx.assertEqual(
    "legacy meal_count ownerType is PRODUCT",
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION.ownerType,
    "PRODUCT",
  );
  ctx.assertEqual(
    "legacy and variant meal_count share key",
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION.key,
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.key,
  );
  ctx.assertTrue(
    "legacy PRODUCT and variant PRODUCTVARIANT coexist",
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION.ownerType === "PRODUCT" &&
      VARIANT_MEAL_COUNT_METAFIELD_DEFINITION.ownerType === "PRODUCTVARIANT",
  );

  ctx.scenario("D. Distinct V2 definition intents");
  const objectiveIntent: string =
    CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT;
  const mealCountVariantIntent: string =
    CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT;
  ctx.assertTrue(
    "V2 intents are distinct",
    objectiveIntent !== mealCountVariantIntent,
  );
  ctx.assertTrue(
    "objective intent is not saveBoxMealCounts",
    objectiveIntent !== LEGACY_SAVE_BOX_MEAL_COUNTS_INTENT,
  );
  ctx.assertTrue(
    "meal_count variant intent is not saveBoxMealCounts",
    mealCountVariantIntent !== LEGACY_SAVE_BOX_MEAL_COUNTS_INTENT,
  );
  ctx.assertTrue(
    "objective intent is not setupWeeklySellingPlans",
    objectiveIntent !== LEGACY_SETUP_SELLING_PLANS_INTENT,
  );
  ctx.assertTrue(
    "meal_count variant intent is not setupWeeklySellingPlans",
    mealCountVariantIntent !== LEGACY_SETUP_SELLING_PLANS_INTENT,
  );
  ctx.assertTrue(
    "objective intent is not legacy product meal_count definition",
    objectiveIntent !== LEGACY_CREATE_PRODUCT_MEAL_COUNT_INTENT,
  );
  ctx.assertTrue(
    "meal_count variant intent is not legacy product meal_count definition",
    mealCountVariantIntent !== LEGACY_CREATE_PRODUCT_MEAL_COUNT_INTENT,
  );
  ctx.assertEqual(
    "objective intent name",
    objectiveIntent,
    "createVariantObjectiveMetafieldDefinition",
  );
  ctx.assertEqual(
    "meal_count variant intent name",
    mealCountVariantIntent,
    "createVariantMealCountMetafieldDefinition",
  );

  ctx.scenario("F. Idempotence TAKEN = soft success");
  ctx.assertTrue(
    "TAKEN code is already-exists",
    isMetafieldDefinitionAlreadyExistsError({
      code: "TAKEN",
      message: "Key is taken",
    }),
  );
  ctx.assertFalse(
    "unrelated code is not already-exists",
    isMetafieldDefinitionAlreadyExistsError({
      code: "INVALID",
      message: "Invalid",
    }),
  );
  ctx.assertFalse(
    "message-only error is not treated as already-exists",
    isMetafieldDefinitionAlreadyExistsError({
      message: "already exists",
    }),
  );

  const takenOnly = toMetafieldDefinitionCreateOutcome([
    { code: "TAKEN", message: "Key is taken" },
  ]);
  ctx.assertTrue("TAKEN-only alreadyExisted", takenOnly.alreadyExisted);
  ctx.assertEqual("TAKEN-only has no blocking errors", takenOnly.errors.length, 0);

  const realError = toMetafieldDefinitionCreateOutcome([
    { code: "INVALID", message: "Bad input" },
  ]);
  ctx.assertFalse("real error not alreadyExisted", realError.alreadyExisted);
  ctx.assertEqual("real error surfaced", realError.errors[0], "Bad input");

  const mixed = toMetafieldDefinitionCreateOutcome([
    { code: "TAKEN", message: "Key is taken" },
    { code: "INVALID", message: "Bad input" },
  ]);
  ctx.assertFalse("mixed errors not soft success", mixed.alreadyExisted);
  ctx.assertEqual("mixed keeps blocking error only", mixed.errors.length, 1);
  ctx.assertEqual("mixed blocking message", mixed.errors[0], "Bad input");

  return finishSuite("14-settings-variant-metafield-definitions", ctx);
};

process.exitCode = runSuite();
