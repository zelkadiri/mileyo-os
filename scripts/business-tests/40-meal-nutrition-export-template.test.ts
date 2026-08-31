/**
 * Business regression — 14B meal nutrition export template.
 *
 * Pure CSV flatten + embedded-safe Settings Form POST + Blob download.
 * No Shopify write, no import, no Prisma mutation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  buildMealNutritionExportCsvContent,
  flattenMealCatalogToExportRows,
  MEAL_NUTRITION_EXPORT_FILENAME,
  MEAL_NUTRITION_EXPORT_HEADERS,
  MEAL_NUTRITION_LEGACY_EXPORT_HEADERS,
  type MealNutritionExportCatalogProduct,
} from "../../app/utils/mealNutritionExport";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const sampleCatalog = (): MealNutritionExportCatalogProduct[] => [
  {
    title: "Poulet riz",
    variants: [
      {
        variantId: "gid://shopify/ProductVariant/101",
        variantTitle: "Perte de poids",
        objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
        calories: 420,
        proteins: 40,
        carbs: 30,
        fat: 10,
        saturatedFat: 2.4,
        sugars: 5,
        fiber: 3,
        salt: 0.5,
        portionGrams: 350,
      },
      {
        variantId: "gid://shopify/ProductVariant/102",
        variantTitle: "Équilibré",
        objective: null,
        calories: null,
        proteins: null,
        carbs: null,
        fat: null,
        portionGrams: null,
      },
    ],
  },
  {
    title: "Saumon quinoa",
    variants: [
      {
        variantId: "gid://shopify/ProductVariant/201",
        variantTitle: "Prise de masse",
        objective: SUBSCRIPTION_OBJECTIVE.BULK,
        calories: 600,
        proteins: 45.5,
        carbs: 50,
        fat: 18,
        portionGrams: 400,
      },
      {
        variantId: "   ",
        variantTitle: "Sans id",
        objective: null,
        calories: 1,
        proteins: 1,
        carbs: 1,
        fat: 1,
        portionGrams: 1,
      },
    ],
  },
];

const runSuite = () => {
  const ctx = createBusinessTestContext("40-meal-nutrition-export-template");

  ctx.scenario("A. Headers CSV — ordre exact du contrat import");
  ctx.assertEqual(
    "headers count",
    MEAL_NUTRITION_EXPORT_HEADERS.length,
    13,
  );
  ctx.assertEqual(
    "headers order",
    MEAL_NUTRITION_EXPORT_HEADERS.join("|"),
    [
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
    ].join("|"),
  );
  ctx.assertEqual(
    "legacy headers count",
    MEAL_NUTRITION_LEGACY_EXPORT_HEADERS.length,
    9,
  );
  ctx.assertEqual(
    "legacy headers order",
    MEAL_NUTRITION_LEGACY_EXPORT_HEADERS.join("|"),
    [
      "variantId",
      "productTitle",
      "variantTitle",
      "objective",
      "calories",
      "proteins",
      "carbs",
      "fat",
      "portionGrams",
    ].join("|"),
  );
  ctx.assertEqual(
    "filename",
    MEAL_NUTRITION_EXPORT_FILENAME,
    "mileyo-meal-nutrition-template.csv",
  );

  ctx.scenario("B. Flatten products × variants — variantId obligatoire");
  const rows = flattenMealCatalogToExportRows(sampleCatalog());
  ctx.assertEqual("row count skips blank variantId", rows.length, 3);
  ctx.assertEqual(
    "first variantId",
    rows[0]?.variantId,
    "gid://shopify/ProductVariant/101",
  );
  ctx.assertEqual("first productTitle", rows[0]?.productTitle, "Poulet riz");
  ctx.assertEqual(
    "first objective key",
    rows[0]?.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "second product still flattened",
    rows[2]?.variantId,
    "gid://shopify/ProductVariant/201",
  );
  ctx.assertTrue(
    "blank variantId excluded",
    rows.every((row) => row.variantId.trim().length > 0),
  );

  ctx.scenario("C. Macros existantes conservées — null → cellule vide");
  ctx.assertEqual("preserved calories", rows[0]?.calories, 420);
  ctx.assertEqual("preserved saturatedFat", rows[0]?.saturatedFat, 2.4);
  ctx.assertEqual("preserved sugars", rows[0]?.sugars, 5);
  ctx.assertEqual("preserved fiber", rows[0]?.fiber, 3);
  ctx.assertEqual("preserved salt", rows[0]?.salt, 0.5);
  ctx.assertEqual("preserved proteins decimal", rows[2]?.proteins, 45.5);
  ctx.assertNull("null calories kept", rows[1]?.calories);
  ctx.assertNull("null saturatedFat kept", rows[1]?.saturatedFat);
  ctx.assertEqual("null objective → empty string", rows[1]?.objective, "");

  const csv = buildMealNutritionExportCsvContent(sampleCatalog());
  const lines = csv.split("\n");
  ctx.assertEqual(
    "header line",
    lines[0],
    MEAL_NUTRITION_EXPORT_HEADERS.map((h) => `"${h}"`).join(","),
  );
  ctx.assertTrue(
    "data row has variantId",
    (lines[1] ?? "").includes("gid://shopify/ProductVariant/101"),
  );
  const balancedLine = lines.find((line) =>
    line.includes("gid://shopify/ProductVariant/102"),
  );
  ctx.assertTrue("balanced row present", Boolean(balancedLine));
  ctx.assertEqual(
    "null macros as empty quoted cells",
    balancedLine,
    '"gid://shopify/ProductVariant/102","Poulet riz","Équilibré","","","","","","","","","",""',
  );
  ctx.assertTrue(
    "existing macros in CSV",
    (lines[1] ?? "").includes('"420"') && (lines[1] ?? "").includes('"40"'),
  );
  ctx.assertTrue(
    "new fields in CSV when present",
    (lines[1] ?? "").includes('"2.4"') &&
      (lines[1] ?? "").includes('"0.5"'),
  );
  ctx.assertTrue("blank variantId not in CSV", !csv.includes("Sans id"));

  ctx.scenario("D. Wiring Settings — Form POST embedded-safe + Blob");
  const render = readRepoFile("app/features/settings/settings-render.tsx");
  const actions = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const server = readRepoFile(
    "app/features/settings/settings-meal-nutrition-export.server.ts",
  );
  const exportUtil = readRepoFile("app/utils/mealNutritionExport.ts");
  const catalogService = readRepoFile(
    "app/services/subscriptionMealCatalog.server.ts",
  );
  const settingsCatalog = readRepoFile(
    "app/features/settings/settings-catalog.server.ts",
  );

  ctx.assertTrue(
    "section Nutrition (export + import)",
    render.includes('heading="Nutrition"'),
  );
  ctx.assertTrue(
    "export block label",
    render.includes("Export nutrition CSV"),
  );
  ctx.assertTrue(
    "button label",
    render.includes("Exporter template nutrition"),
  );
  ctx.assertTrue(
    "no href download navigation",
    !render.includes('href="/app/settings/nutrition-export"') &&
      !render.includes("nutrition-export"),
  );
  ctx.assertTrue(
    "form post intent",
    render.includes('value="exportMealNutritionTemplate"') &&
      render.includes('method="post"'),
  );
  ctx.assertTrue(
    "client Blob download helper used",
    render.includes("downloadMealNutritionCsv") &&
      exportUtil.includes("downloadMealNutritionCsv") &&
      exportUtil.includes("createObjectURL"),
  );
  const nutritionIdx = render.indexOf('heading="Nutrition"');
  const maintenanceIdx = render.indexOf(
    'heading="Maintenance / Configuration avancée"',
  );
  const repasIdx = render.indexOf("<strong>Catalogue Repas V2</strong>");
  const boxIdx = render.indexOf("<strong>Catalogue Box V2</strong>");
  ctx.assertTrue(
    "Nutrition before Maintenance",
    nutritionIdx >= 0 && maintenanceIdx > nutritionIdx,
  );
  ctx.assertTrue(
    "Catalogue Repas V2 inside Maintenance after Nutrition",
    repasIdx > nutritionIdx,
  );
  ctx.assertTrue(
    "Catalogue Box V2 after Catalogue Repas V2 in Maintenance",
    repasIdx >= 0 && boxIdx > repasIdx,
  );

  ctx.assertTrue(
    "actions wire export intent",
    actions.includes("EXPORT_MEAL_NUTRITION_TEMPLATE_INTENT") &&
      actions.includes("buildMealNutritionExportActionResult"),
  );
  ctx.assertTrue(
    "server uses fetchMealCatalogProducts only",
    server.includes("fetchMealCatalogProducts") &&
      !server.includes("getCollectionProducts") &&
      !server.includes("setupV2MealCatalog"),
  );
  ctx.assertTrue(
    "missing collection error in action result",
    server.includes("MEAL_NUTRITION_EXPORT_MISSING_COLLECTION_MESSAGE") &&
      server.includes("ok: false"),
  );
  ctx.assertTrue(
    "action returns csv string not Content-Disposition navigation",
    server.includes("csv,") &&
      !server.includes("Content-Disposition") &&
      !server.includes("text/csv"),
  );
  ctx.assertTrue(
    "catalog source still subscriptionMealCatalog",
    catalogService.includes("fetchMealCatalogProducts"),
  );
  ctx.assertTrue(
    "settings preview still first: 20 / variants first: 1",
    settingsCatalog.includes("products(first: 20") &&
      settingsCatalog.includes("variants(first: 1)"),
  );

  let nutritionExportRouteExists = true;
  try {
    readRepoFile("app/routes/app.settings.nutrition-export.tsx");
  } catch {
    nutritionExportRouteExists = false;
  }
  ctx.assertFalse(
    "legacy nutrition-export route removed",
    nutritionExportRouteExists,
  );

  ctx.scenario("E. Pas d’import / pas de mutation métier dans cet export");
  ctx.assertTrue(
    "no applyMealNutrition in export util",
    !exportUtil.includes("applyMealNutrition"),
  );
  ctx.assertTrue(
    "export server has no metafieldsSet",
    !server.includes("metafieldsSet"),
  );

  return finishSuite("40-meal-nutrition-export-template", ctx);
};

process.exitCode = runSuite();
