/**
 * Business regression — 14C-D partial Excel nutrition import.
 *
 * Unfilled template rows ignored; partial macros still error; Apply on validRows.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MEAL_NUTRITION_EXPORT_HEADERS } from "../../app/utils/mealNutritionExport";
import {
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

const identityLine = (
  variantId: string,
  objective = "balanced",
  macros: Partial<{
    calories: string;
    proteins: string;
    carbs: string;
    fat: string;
    portionGrams: string;
  }> = {},
) =>
  [
    variantId,
    "Poulet riz",
    "Équilibré",
    objective,
    macros.calories ?? "",
    macros.proteins ?? "",
    macros.carbs ?? "",
    macros.fat ?? "",
    macros.portionGrams ?? "",
  ]
    .map((value) => `"${String(value).replace(/"/g, '""')}"`)
    .join(",");

const filledLine = (variantId: string) =>
  identityLine(variantId, "balanced", {
    calories: "450",
    proteins: "38.5",
    carbs: "35",
    fat: "12",
    portionGrams: "350",
  });

const runSuite = () => {
  const ctx = createBusinessTestContext("44-meal-nutrition-import-partial");

  ctx.scenario("A. Export complet non rempli — tout ignoré, pas d’erreur");
  const allUnfilled = [
    headerLine,
    identityLine("gid://shopify/ProductVariant/1"),
    identityLine("gid://shopify/ProductVariant/2", "weight_loss"),
    identityLine("gid://shopify/ProductVariant/3", "bulk"),
  ].join("\n");
  const unfilledPreview = previewMealNutritionImportCsv(allUnfilled);
  ctx.assertTrue("unfilled ok", unfilledPreview.ok);
  ctx.assertEqual("ignored all three", unfilledPreview.ignoredRowCount, 3);
  ctx.assertEqual("no valid", unfilledPreview.validRowCount, 0);
  ctx.assertEqual("no issues", unfilledPreview.issues.length, 0);

  ctx.scenario("B. Une ligne remplie + plusieurs vides");
  const mixed = [
    headerLine,
    identityLine("gid://shopify/ProductVariant/10"),
    filledLine("gid://shopify/ProductVariant/11"),
    identityLine("gid://shopify/ProductVariant/12"),
  ].join("\n");
  const mixedPreview = previewMealNutritionImportCsv(mixed);
  ctx.assertTrue("mixed format ok", mixedPreview.ok);
  ctx.assertEqual("one valid", mixedPreview.validRowCount, 1);
  ctx.assertEqual("two ignored", mixedPreview.ignoredRowCount, 2);
  ctx.assertEqual(
    "valid variant",
    mixedPreview.validRows[0]?.variantId,
    "gid://shopify/ProductVariant/11",
  );

  ctx.scenario("C. Ligne partielle invalide reste bloquante");
  const partial = [
    headerLine,
    identityLine("gid://shopify/ProductVariant/20", "balanced", {
      calories: "500",
      proteins: "",
      carbs: "30",
      fat: "10",
      portionGrams: "350",
    }),
    filledLine("gid://shopify/ProductVariant/21"),
  ].join("\n");
  const partialPreview = previewMealNutritionImportCsv(partial);
  ctx.assertFalse("partial not fully ok", partialPreview.ok);
  ctx.assertEqual("one valid beside partial", partialPreview.validRowCount, 1);
  ctx.assertTrue(
    "invalid_proteins on partial",
    partialPreview.issues.some((issue) => issue.code === "invalid_proteins"),
  );
  ctx.assertEqual("no ignored among these", partialPreview.ignoredRowCount, 0);

  ctx.scenario("D. Apply / UI — validRows > 0 sans exiger preview.ok");
  const importServer = readRepoFile(
    "app/features/settings/settings-meal-nutrition-import.server.ts",
  );
  const render = readRepoFile("app/features/settings/settings-render.tsx");
  const applyBody = importServer.slice(
    importServer.indexOf(
      "export const buildMealNutritionImportApplyActionResult",
    ),
  );

  ctx.assertTrue(
    "apply gates on validRows.length only",
    applyBody.includes("preview.validRows.length === 0") &&
      !applyBody.includes("!preview.ok ||"),
  );
  ctx.assertTrue(
    "UI Apply without preview.ok",
    render.includes("validRowCount > 0") &&
      render.includes("nutritionImportCsvText") &&
      render.includes("Appliquer les modifications") &&
      !render.includes(
        "nutritionImportPreview.ok &&\n              actionData.nutritionImportPreview.validRowCount",
      ),
  );
  ctx.assertTrue(
    "UI shows ignored rows counter",
    render.includes("Lignes ignorées") &&
      render.includes("ignoredRowCount"),
  );
  ctx.assertTrue(
    "csv util exports ignorable helper",
    readRepoFile("app/utils/mealNutritionCsv.ts").includes(
      "isIgnorableUnfilledNutritionRow",
    ),
  );

  return finishSuite("44-meal-nutrition-import-partial", ctx);
};

process.exitCode = runSuite();
