/**
 * Business regression — 14C-C meal nutrition CSV import Apply.
 *
 * Apply revalidates server-side then calls applyMealNutritionMetafields.
 * Preview alone must never write.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMealNutritionWritePlans,
  validateMealNutritionImportRows,
} from "../../app/utils/mealNutritionImport";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = () => {
  const ctx = createBusinessTestContext("43-meal-nutrition-import-apply");

  ctx.scenario("A. Preview wiring never calls writer");
  const importServer = readRepoFile(
    "app/features/settings/settings-meal-nutrition-import.server.ts",
  );
  const actions = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const render = readRepoFile("app/features/settings/settings-render.tsx");
  const writer = readRepoFile(
    "app/services/mealNutritionImport.server.ts",
  );

  const previewBuilderBody = importServer.slice(
    importServer.indexOf(
      "export const buildMealNutritionImportPreviewActionResult",
    ),
    importServer.indexOf(
      "export const buildMealNutritionImportApplyActionResult",
    ),
  );
  const applyBuilderBody = importServer.slice(
    importServer.indexOf(
      "export const buildMealNutritionImportApplyActionResult",
    ),
  );
  ctx.assertTrue(
    "preview section has no applyMealNutritionMetafields call",
    !previewBuilderBody.includes("await applyMealNutritionMetafields"),
  );
  ctx.assertTrue(
    "apply builder awaits writer",
    applyBuilderBody.includes("await applyMealNutritionMetafields"),
  );
  ctx.assertTrue(
    "preview intent distinct from apply",
    importServer.includes("PREVIEW_MEAL_NUTRITION_IMPORT_INTENT") &&
      importServer.includes("APPLY_MEAL_NUTRITION_IMPORT_INTENT") &&
      actions.includes("APPLY_MEAL_NUTRITION_IMPORT_INTENT") &&
      actions.includes("buildMealNutritionImportApplyActionResult"),
  );

  ctx.scenario("B. Apply revalidates then writes via existing writer only");
  ctx.assertTrue(
    "apply rebuilds business preview before write",
    importServer.includes("runMealNutritionBusinessPreview") &&
      importServer.includes("buildMealNutritionImportApplyActionResult"),
  );
  ctx.assertTrue(
    "apply calls applyMealNutritionMetafields with validRows",
    importServer.includes("applyMealNutritionMetafields") &&
      importServer.includes("preview.validRows"),
  );
  ctx.assertTrue(
    "apply refuses when no validRows",
    importServer.includes("preview.validRows.length === 0") &&
      importServer.includes("validation refusée avant écriture"),
  );
  ctx.assertTrue(
    "writer remains metafieldsSet ProductVariant custom.*",
    writer.includes("applyMealNutritionMetafields") &&
      writer.includes("metafieldsSet") &&
      writer.includes('namespace: metafield.namespace') &&
      writer.includes("buildMealNutritionWritePlans"),
  );
  ctx.assertTrue(
    "writer batches metafieldsSet to Shopify 25 limit",
    writer.includes("SHOPIFY_METAFIELDS_SET_MAX_INPUT") &&
      writer.includes("chunkMealNutritionWritePlans") &&
      writer.includes("appliedVariantCount"),
  );
  ctx.assertTrue(
    "apply uses writer appliedVariantCount (not raw validRows length alone)",
    applyBuilderBody.includes("writeResult.appliedVariantCount") &&
      applyBuilderBody.includes("writeResult.errors"),
  );
  ctx.assertTrue(
    "no second writer invented in settings import",
    !importServer.includes("metafieldsSet(") &&
      importServer.includes('from "../../services/mealNutritionImport.server"'),
  );

  ctx.scenario("C. UI Apply gated + success / Shopify errors");
  ctx.assertTrue(
    "Apply button label + intent",
    render.includes("Appliquer les modifications") &&
      render.includes('value="applyMealNutritionImport"') &&
      render.includes("nutritionCsvText"),
  );
  ctx.assertTrue(
    "Apply only when validRowCount and csv retained",
    render.includes("validRowCount > 0") &&
      render.includes("nutritionImportCsvText"),
  );
  ctx.assertTrue(
    "success copy Import terminé",
    render.includes("Import terminé") &&
      render.includes("nutritionImportAppliedCount"),
  );
  ctx.assertTrue(
    "Shopify write errors surfaced",
    importServer.includes("erreurs Shopify lors de l’écriture") &&
      render.includes("écriture"),
  );

  ctx.scenario("D. Foundation write plans still required for apply path");
  const plans = buildMealNutritionWritePlans([
    {
      variantId: "gid://shopify/ProductVariant/1",
      calories: 450,
      proteins: 38,
      carbs: 35,
      fat: 12,
      saturatedFat: null,
      sugars: null,
      fiber: null,
      salt: null,
      portionGrams: 350,
    },
  ]);
  ctx.assertEqual("one write plan", plans.length, 1);
  ctx.assertEqual("five metafields legacy row", plans[0]?.metafields.length, 5);
  const fullPlans = buildMealNutritionWritePlans([
    {
      variantId: "gid://shopify/ProductVariant/2",
      calories: 450,
      proteins: 38,
      carbs: 35,
      fat: 12,
      saturatedFat: 2.4,
      sugars: 5,
      fiber: 3,
      salt: 0.5,
      portionGrams: 350,
    },
  ]);
  ctx.assertEqual("nine metafields full row", fullPlans[0]?.metafields.length, 9);
  const rejected = validateMealNutritionImportRows([
    {
      variantId: "gid://shopify/ProductVariant/missing",
      calories: 0,
      proteins: 1,
      carbs: 1,
      fat: 1,
      saturatedFat: null,
      sugars: null,
      fiber: null,
      salt: null,
      portionGrams: 1,
    },
  ]);
  ctx.assertFalse("invalid macros blocked before write", rejected.ok);

  return finishSuite("43-meal-nutrition-import-apply", ctx);
};

process.exitCode = runSuite();
