/**
 * Business regression — 14C-A meal nutrition CSV import preview.
 *
 * Parse + validate + Settings wiring. No Shopify metafieldsSet / apply.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEAL_NUTRITION_EXPORT_HEADERS,
  MEAL_NUTRITION_LEGACY_EXPORT_HEADERS,
} from "../../app/utils/mealNutritionExport";
import {
  parseMealNutritionCsv,
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

const headerLine = (headers: readonly string[]) =>
  headers.map((h) => `"${h}"`).join(",");

const legacyHeaderLine = headerLine(MEAL_NUTRITION_LEGACY_EXPORT_HEADERS);
const newHeaderLine = headerLine(MEAL_NUTRITION_EXPORT_HEADERS);

const validLegacyDataLine = (
  variantId: string,
  overrides: Partial<{
    calories: string;
    proteins: string;
    carbs: string;
    fat: string;
    portionGrams: string;
    objective: string;
  }> = {},
) =>
  [
    variantId,
    "Poulet riz",
    "Équilibré",
    overrides.objective ?? "balanced",
    overrides.calories ?? "450",
    overrides.proteins ?? "38.5",
    overrides.carbs ?? "35",
    overrides.fat ?? "12",
    overrides.portionGrams ?? "350",
  ]
    .map((value) => `"${String(value).replace(/"/g, '""')}"`)
    .join(",");

const validNewDataLine = (
  variantId: string,
  overrides: Partial<{
    calories: string;
    proteins: string;
    carbs: string;
    fat: string;
    saturatedFat: string;
    sugars: string;
    fiber: string;
    salt: string;
    portionGrams: string;
    objective: string;
  }> = {},
) =>
  [
    variantId,
    "Poulet riz",
    "Équilibré",
    overrides.objective ?? "balanced",
    overrides.calories ?? "450",
    overrides.proteins ?? "38.5",
    overrides.carbs ?? "35",
    overrides.fat ?? "12",
    overrides.saturatedFat ?? "",
    overrides.sugars ?? "",
    overrides.fiber ?? "",
    overrides.salt ?? "",
    overrides.portionGrams ?? "350",
  ]
    .map((value) => `"${String(value).replace(/"/g, '""')}"`)
    .join(",");

const runSuite = () => {
  const ctx = createBusinessTestContext("41-meal-nutrition-import-preview");

  ctx.scenario("A. Parsing CSV quoté + BOM");
  const withBom = `\uFEFF${newHeaderLine}\n${validNewDataLine("gid://shopify/ProductVariant/1")}`;
  const matrix = parseMealNutritionCsv(withBom);
  ctx.assertEqual(
    "header cells",
    matrix[0]?.join("|"),
    MEAL_NUTRITION_EXPORT_HEADERS.join("|"),
  );
  ctx.assertEqual("data variantId", matrix[1]?.[0], "gid://shopify/ProductVariant/1");

  const quotedComma = `${newHeaderLine}\n"gid://shopify/ProductVariant/2","Plat, spécial","Équilibré","balanced","450","38.5","35","12","","","","","350"`;
  const parsedComma = parseMealNutritionCsv(quotedComma);
  ctx.assertEqual("comma inside quotes", parsedComma[1]?.[1], "Plat, spécial");

  ctx.scenario("A2. Excel FR — séparateur point-virgule");
  const headerLineSemicolon = MEAL_NUTRITION_EXPORT_HEADERS.map(
    (h) => `"${h}"`,
  ).join(";");
  const semicolonCsv = [
    headerLineSemicolon,
    [
      "gid://shopify/ProductVariant/3",
      "Poulet riz",
      "Équilibré",
      "balanced",
      "450",
      "38,5",
      "35",
      "12",
      "",
      "",
      "",
      "",
      "350",
    ]
      .map((value) => `"${value}"`)
      .join(";"),
  ].join("\n");
  const parsedSemicolon = parseMealNutritionCsv(semicolonCsv);
  ctx.assertEqual(
    "semicolon headers",
    parsedSemicolon[0]?.join("|"),
    MEAL_NUTRITION_EXPORT_HEADERS.join("|"),
  );
  ctx.assertEqual(
    "semicolon variantId",
    parsedSemicolon[1]?.[0],
    "gid://shopify/ProductVariant/3",
  );
  const semicolonPreview = previewMealNutritionImportCsv(semicolonCsv);
  ctx.assertTrue("semicolon format preview ok", semicolonPreview.ok);
  ctx.assertEqual("semicolon schema new", semicolonPreview.csvSchema, "new");
  ctx.assertEqual(
    "semicolon decimal proteins",
    semicolonPreview.validRows[0]?.proteins,
    38.5,
  );

  ctx.scenario("B. Dual schema — legacy 9 colonnes accepté");
  const legacyCsv = [
    legacyHeaderLine,
    validLegacyDataLine("gid://shopify/ProductVariant/legacy1"),
  ].join("\n");
  const legacyPreview = previewMealNutritionImportCsv(legacyCsv);
  ctx.assertTrue("legacy preview ok", legacyPreview.ok);
  ctx.assertEqual("legacy schema", legacyPreview.csvSchema, "legacy");
  ctx.assertEqual("legacy valid count", legacyPreview.validRowCount, 1);
  ctx.assertNull("legacy saturatedFat null", legacyPreview.validRows[0]?.saturatedFat);
  ctx.assertNull("legacy salt null", legacyPreview.validRows[0]?.salt);

  ctx.scenario("B2. Dual schema — new 13 colonnes accepté");
  const newCsv = [
    newHeaderLine,
    validNewDataLine("gid://shopify/ProductVariant/new1", {
      saturatedFat: "2.4",
      sugars: "5",
      fiber: "3",
      salt: "0.5",
    }),
  ].join("\n");
  const newPreview = previewMealNutritionImportCsv(newCsv);
  ctx.assertTrue("new preview ok", newPreview.ok);
  ctx.assertEqual("new schema", newPreview.csvSchema, "new");
  ctx.assertEqual("new saturatedFat", newPreview.validRows[0]?.saturatedFat, 2.4);
  ctx.assertEqual("new salt", newPreview.validRows[0]?.salt, 0.5);

  ctx.scenario("C. Headers invalides — mauvais nombre de colonnes");
  const badHeaders = previewMealNutritionImportCsv(
    `"variantId","calories"\n"gid://shopify/ProductVariant/1","450"`,
  );
  ctx.assertFalse("invalid headers not ok", badHeaders.ok);
  ctx.assertTrue(
    "invalid_headers issue",
    badHeaders.issues.some((issue) => issue.code === "invalid_headers"),
  );

  const tenColsHeader = headerLine([
    "variantId",
    "productTitle",
    "variantTitle",
    "objective",
    "calories",
    "proteins",
    "carbs",
    "fat",
    "saturatedFat",
    "portionGrams",
  ]);
  const tenColsData = [
    "gid://shopify/ProductVariant/10",
    "Poulet riz",
    "Équilibré",
    "balanced",
    "450",
    "38.5",
    "35",
    "12",
    "2.4",
    "350",
  ]
    .map((value) => `"${value}"`)
    .join(",");
  const tenCols = previewMealNutritionImportCsv(
    `${tenColsHeader}\n${tenColsData}`,
  );
  ctx.assertFalse("10 columns rejected", tenCols.ok);
  ctx.assertTrue(
    "10 columns invalid_headers",
    tenCols.issues.some((issue) => issue.code === "invalid_headers"),
  );

  const elevenCols = previewMealNutritionImportCsv(
    `${headerLine([
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
      "portionGrams",
    ])}\n${validLegacyDataLine("gid://shopify/ProductVariant/11")}`,
  );
  ctx.assertFalse("11 columns rejected", elevenCols.ok);
  ctx.assertTrue(
    "11 columns invalid_headers",
    elevenCols.issues.some((issue) => issue.code === "invalid_headers"),
  );

  const twelveCols = previewMealNutritionImportCsv(
    `${headerLine([
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
      "portionGrams",
    ])}\n${validLegacyDataLine("gid://shopify/ProductVariant/12")}`,
  );
  ctx.assertFalse("12 columns rejected", twelveCols.ok);
  ctx.assertTrue(
    "12 columns invalid_headers",
    twelveCols.issues.some((issue) => issue.code === "invalid_headers"),
  );

  const wrongOrder = previewMealNutritionImportCsv(
    `${headerLine([
      "variantId",
      "productTitle",
      "variantTitle",
      "objective",
      "calories",
      "proteins",
      "carbs",
      "fat",
      "portionGrams",
      "saturatedFat",
      "sugars",
      "fiber",
      "salt",
    ])}\n${validNewDataLine("gid://shopify/ProductVariant/wrong")}`,
  );
  ctx.assertFalse("wrong order rejected", wrongOrder.ok);
  ctx.assertTrue(
    "wrong order invalid_headers",
    wrongOrder.issues.some((issue) => issue.code === "invalid_headers"),
  );

  const badHeadersSemicolon = previewMealNutritionImportCsv(
    `"variantId";"calories"\n"gid://shopify/ProductVariant/1";"450"`,
  );
  ctx.assertFalse("invalid headers semicolon not ok", badHeadersSemicolon.ok);
  ctx.assertTrue(
    "invalid_headers semicolon issue",
    badHeadersSemicolon.issues.some(
      (issue) => issue.code === "invalid_headers",
    ),
  );

  ctx.scenario("D. Valeurs invalides + lignes vides ignorées");
  const mixed = [
    newHeaderLine,
    validNewDataLine("gid://shopify/ProductVariant/10"),
    `"","","","","","","","","","","","",""`,
    validNewDataLine("gid://shopify/ProductVariant/11", { calories: "0" }),
    "",
  ].join("\n");
  const mixedPreview = previewMealNutritionImportCsv(mixed);
  ctx.assertEqual("rowCount skips empty", mixedPreview.rowCount, 2);
  ctx.assertTrue("skipped empty > 0", mixedPreview.skippedEmptyRowCount >= 1);
  ctx.assertEqual("one valid row", mixedPreview.validRowCount, 1);
  ctx.assertFalse("mixed not fully ok", mixedPreview.ok);
  ctx.assertTrue(
    "invalid_calories",
    mixedPreview.issues.some((issue) => issue.code === "invalid_calories"),
  );

  ctx.scenario("E. Doublons variantId");
  const dupes = [
    newHeaderLine,
    validNewDataLine("gid://shopify/ProductVariant/99"),
    validNewDataLine("gid://shopify/ProductVariant/99", { calories: "500" }),
  ].join("\n");
  const dupePreview = previewMealNutritionImportCsv(dupes);
  ctx.assertFalse("duplicates not ok", dupePreview.ok);
  ctx.assertEqual("duplicates excluded from valid", dupePreview.validRowCount, 0);
  ctx.assertTrue(
    "duplicate_variant_id",
    dupePreview.issues.some((issue) => issue.code === "duplicate_variant_id"),
  );

  ctx.scenario("F. Preview OK — aucune écriture Shopify dans le code");
  const okCsv = [
    newHeaderLine,
    validNewDataLine("gid://shopify/ProductVariant/101"),
    validNewDataLine("gid://shopify/ProductVariant/102", {
      objective: "weight_loss",
      calories: "420",
    }),
  ].join("\n");
  const okPreview = previewMealNutritionImportCsv(okCsv);
  ctx.assertTrue("preview ok", okPreview.ok);
  ctx.assertEqual("two valid", okPreview.validRowCount, 2);
  ctx.assertEqual("issues empty", okPreview.issues.length, 0);
  ctx.assertEqual("format preview has empty diffs", okPreview.diffs.length, 0);
  ctx.assertEqual("validEntries length", okPreview.validEntries.length, 2);

  const csvUtil = readRepoFile("app/utils/mealNutritionCsv.ts");
  const importServer = readRepoFile(
    "app/features/settings/settings-meal-nutrition-import.server.ts",
  );
  const actions = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const render = readRepoFile("app/features/settings/settings-render.tsx");
  const applyService = readRepoFile(
    "app/services/mealNutritionImport.server.ts",
  );

  ctx.assertTrue(
    "preview util has no metafieldsSet",
    !csvUtil.includes("metafieldsSet") &&
      !csvUtil.includes("applyMealNutritionMetafields"),
  );
  ctx.assertTrue(
    "import settings server preview has no metafieldsSet",
    !importServer.includes("metafieldsSet"),
  );
  ctx.assertTrue(
    "preview intent wired",
    actions.includes("PREVIEW_MEAL_NUTRITION_IMPORT_INTENT") &&
      actions.includes("buildMealNutritionImportPreviewActionResult"),
  );
  const previewBuilderBody = importServer.slice(
    importServer.indexOf("export const buildMealNutritionImportPreviewActionResult"),
    importServer.indexOf("export const buildMealNutritionImportApplyActionResult"),
  );
  ctx.assertTrue(
    "preview action builder does not call apply writer",
    previewBuilderBody.includes("buildMealNutritionImportPreviewActionResult") &&
      !previewBuilderBody.includes("await applyMealNutritionMetafields"),
  );
  ctx.assertTrue(
    "section Import nutrition after Export",
    render.indexOf('heading="Export nutrition"') >= 0 &&
      render.indexOf('heading="Import nutrition"') >
        render.indexOf('heading="Export nutrition"') &&
      render.indexOf('heading="Catalogue Box V2"') >
        render.indexOf('heading="Import nutrition"'),
  );
  ctx.assertTrue(
    "multipart + Analyser button present",
    render.includes('encType="multipart/form-data"') &&
      render.includes("Analyser") &&
      render.includes('value="previewMealNutritionImport"'),
  );
  ctx.assertTrue(
    "writer service still exists but unused by preview path",
    applyService.includes("applyMealNutritionMetafields"),
  );
  ctx.assertTrue(
    "reserved catalog codes remain in foundation",
    readRepoFile("app/utils/mealNutritionImport.ts").includes(
      "variant_not_found",
    ) &&
      readRepoFile("app/utils/mealNutritionImport.ts").includes(
        "objective_mismatch",
      ),
  );

  return finishSuite("41-meal-nutrition-import-preview", ctx);
};

process.exitCode = runSuite();
