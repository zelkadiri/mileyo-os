/**
 * Business regression — 14C-B1 meal nutrition CSV import catalog preview.
 *
 * Catalog identity + objective + before/after diffs. No Shopify writes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { MEAL_NUTRITION_EXPORT_HEADERS } from "../../app/utils/mealNutritionExport";
import {
  enrichMealNutritionImportPreviewWithCatalog,
  indexMealNutritionCatalogVariants,
  previewMealNutritionImportCsv,
} from "../../app/utils/mealNutritionCsv";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const headerLine = MEAL_NUTRITION_EXPORT_HEADERS.map((h) => `"${h}"`).join(",");

const validDataLine = (
  variantId: string,
  overrides: Partial<{
    calories: string;
    proteins: string;
    carbs: string;
    fat: string;
    portionGrams: string;
    objective: string;
    productTitle: string;
    variantTitle: string;
  }> = {},
) =>
  [
    variantId,
    overrides.productTitle ?? "Poulet riz",
    overrides.variantTitle ?? "Équilibré",
    overrides.objective ?? "balanced",
    overrides.calories ?? "450",
    overrides.proteins ?? "38.5",
    overrides.carbs ?? "35",
    overrides.fat ?? "12",
    overrides.portionGrams ?? "350",
  ]
    .map((value) => `"${String(value).replace(/"/g, '""')}"`)
    .join(",");

const sampleCatalog = () => [
  {
    title: "Poulet riz",
    variants: [
      {
        variantId: "gid://shopify/ProductVariant/101",
        variantTitle: "Équilibré",
        objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
        calories: 400,
        proteins: 30,
        carbs: 40,
        fat: 10,
        portionGrams: 320,
      },
      {
        variantId: "gid://shopify/ProductVariant/102",
        variantTitle: "Perte de poids",
        objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
        calories: null,
        proteins: null,
        carbs: null,
        fat: null,
        portionGrams: null,
      },
    ],
  },
];

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "42-meal-nutrition-import-catalog-preview",
  );

  ctx.scenario("A. variant_not_found");
  const unknownCsv = [
    headerLine,
    validDataLine("gid://shopify/ProductVariant/999"),
  ].join("\n");
  const unknownFormat = previewMealNutritionImportCsv(unknownCsv);
  const unknownPreview = enrichMealNutritionImportPreviewWithCatalog(
    unknownFormat,
    indexMealNutritionCatalogVariants(sampleCatalog()),
  );
  ctx.assertFalse("unknown not ok", unknownPreview.ok);
  ctx.assertEqual("no valid after catalog", unknownPreview.validRowCount, 0);
  ctx.assertEqual("no diffs", unknownPreview.diffs.length, 0);
  ctx.assertTrue(
    "variant_not_found",
    unknownPreview.issues.some((issue) => issue.code === "variant_not_found"),
  );

  ctx.scenario("B. objective_mismatch");
  const mismatchCsv = [
    headerLine,
    validDataLine("gid://shopify/ProductVariant/101", {
      objective: "bulk",
    }),
  ].join("\n");
  const mismatchPreview = enrichMealNutritionImportPreviewWithCatalog(
    previewMealNutritionImportCsv(mismatchCsv),
    indexMealNutritionCatalogVariants(sampleCatalog()),
  );
  ctx.assertFalse("mismatch not ok", mismatchPreview.ok);
  ctx.assertTrue(
    "objective_mismatch",
    mismatchPreview.issues.some(
      (issue) => issue.code === "objective_mismatch",
    ),
  );
  ctx.assertEqual("no diffs on mismatch", mismatchPreview.diffs.length, 0);

  ctx.scenario("C. Diff before/after correct");
  const okCsv = [
    headerLine,
    validDataLine("gid://shopify/ProductVariant/101", {
      calories: "450",
      proteins: "38.5",
      carbs: "35",
      fat: "12",
      portionGrams: "350",
    }),
    validDataLine("gid://shopify/ProductVariant/102", {
      objective: "weight_loss",
      variantTitle: "Perte de poids",
      calories: "420",
      proteins: "40",
      carbs: "30",
      fat: "10",
      portionGrams: "300",
    }),
  ].join("\n");
  const okPreview = enrichMealNutritionImportPreviewWithCatalog(
    previewMealNutritionImportCsv(okCsv),
    indexMealNutritionCatalogVariants(sampleCatalog()),
  );
  ctx.assertTrue("catalog preview ok", okPreview.ok);
  ctx.assertEqual("two diffs", okPreview.diffs.length, 2);
  const first = okPreview.diffs[0];
  ctx.assertEqual("diff productTitle", first?.productTitle, "Poulet riz");
  ctx.assertEqual("diff variantTitle", first?.variantTitle, "Équilibré");
  ctx.assertEqual("diff objective", first?.objective, "balanced");
  ctx.assertEqual("before calories", first?.before.calories, 400);
  ctx.assertEqual("after calories", first?.after.calories, 450);
  ctx.assertEqual("before proteins", first?.before.proteins, 30);
  ctx.assertEqual("after proteins", first?.after.proteins, 38.5);
  const second = okPreview.diffs[1];
  ctx.assertNull("before null calories", second?.before.calories ?? null);
  ctx.assertEqual("after from csv", second?.after.calories, 420);

  ctx.scenario("D. Wiring Settings — catalogue + preview sans écriture");
  const importServer = readRepoFile(
    "app/features/settings/settings-meal-nutrition-import.server.ts",
  );
  const csvUtil = readRepoFile("app/utils/mealNutritionCsv.ts");
  const render = readRepoFile("app/features/settings/settings-render.tsx");

  ctx.assertTrue(
    "server fetches meal catalog",
    importServer.includes("fetchMealCatalogProducts") &&
      importServer.includes("enrichMealNutritionImportPreviewWithCatalog"),
  );
  const previewBuilderBody = importServer.slice(
    importServer.indexOf("export const buildMealNutritionImportPreviewActionResult"),
    importServer.indexOf("export const buildMealNutritionImportApplyActionResult"),
  );
  ctx.assertTrue(
    "preview path has no metafieldsSet / apply writer call",
    !csvUtil.includes("metafieldsSet") &&
      !csvUtil.includes("applyMealNutritionMetafields") &&
      !previewBuilderBody.includes("await applyMealNutritionMetafields") &&
      !previewBuilderBody.includes("metafieldsSet"),
  );
  ctx.assertTrue(
    "UI shows modifications prêtes + Avant/Après + issue codes",
    render.includes("Modifications prêtes") &&
      render.includes("Aperçu des modifications") &&
      render.includes("non renseigné") &&
      render.includes("<strong>Avant</strong>") &&
      render.includes("<strong>Après</strong>") &&
      render.includes("issue.code"),
  );

  return finishSuite("42-meal-nutrition-import-catalog-preview", ctx);
};

process.exitCode = runSuite();
