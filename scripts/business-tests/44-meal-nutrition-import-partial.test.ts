/**
 * Business regression — 14C-D partial Excel nutrition import.
 *
 * Unfilled template rows ignored; partial macros still error; Apply on validRows.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEAL_NUTRITION_EXPORT_HEADERS,
  MEAL_NUTRITION_LEGACY_EXPORT_HEADERS,
} from "../../app/utils/mealNutritionExport";
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

const headerLine = (headers: readonly string[]) =>
  headers.map((h) => `"${h}"`).join(",");

const legacyHeaderLine = headerLine(MEAL_NUTRITION_LEGACY_EXPORT_HEADERS);
const newHeaderLine = headerLine(MEAL_NUTRITION_EXPORT_HEADERS);

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
  schema: "legacy" | "new" = "legacy",
) => {
  const base = [
    variantId,
    "Poulet riz",
    "Équilibré",
    objective,
    macros.calories ?? "",
    macros.proteins ?? "",
    macros.carbs ?? "",
    macros.fat ?? "",
  ];
  if (schema === "new") {
    base.push("", "", "", "");
  }
  base.push(macros.portionGrams ?? "");
  return base.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
};

const filledLine = (variantId: string, schema: "legacy" | "new" = "legacy") =>
  identityLine(
    variantId,
    "balanced",
    {
      calories: "450",
      proteins: "38.5",
      carbs: "35",
      fat: "12",
      portionGrams: "350",
    },
    schema,
  );

const runSuite = () => {
  const ctx = createBusinessTestContext("44-meal-nutrition-import-partial");

  ctx.scenario("A. Export complet non rempli — tout ignoré, pas d'erreur (legacy)");
  const allUnfilled = [
    legacyHeaderLine,
    identityLine("gid://shopify/ProductVariant/1"),
    identityLine("gid://shopify/ProductVariant/2", "weight_loss"),
    identityLine("gid://shopify/ProductVariant/3", "bulk"),
  ].join("\n");
  const unfilledPreview = previewMealNutritionImportCsv(allUnfilled);
  ctx.assertTrue("unfilled ok", unfilledPreview.ok);
  ctx.assertEqual("ignored all three", unfilledPreview.ignoredRowCount, 3);
  ctx.assertEqual("no valid", unfilledPreview.validRowCount, 0);
  ctx.assertEqual("no issues", unfilledPreview.issues.length, 0);

  ctx.scenario("A2. Export complet non rempli — new schema");
  const allUnfilledNew = [
    newHeaderLine,
    identityLine("gid://shopify/ProductVariant/1", "balanced", {}, "new"),
    identityLine("gid://shopify/ProductVariant/2", "weight_loss", {}, "new"),
  ].join("\n");
  const unfilledNewPreview = previewMealNutritionImportCsv(allUnfilledNew);
  ctx.assertTrue("new unfilled ok", unfilledNewPreview.ok);
  ctx.assertEqual("new ignored two", unfilledNewPreview.ignoredRowCount, 2);

  ctx.scenario("B. Une ligne remplie + plusieurs vides");
  const mixed = [
    legacyHeaderLine,
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
    legacyHeaderLine,
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

  ctx.scenario("D. New schema — seulement nouveau champ sans macros historiques => erreur");
  const saltOnlyLine = [
    newHeaderLine,
    [
      "gid://shopify/ProductVariant/30",
      "Poulet riz",
      "Équilibré",
      "balanced",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "0.5",
      "",
    ]
      .map((value) => `"${value}"`)
      .join(","),
  ].join("\n");
  const saltOnlyPreview = previewMealNutritionImportCsv(saltOnlyLine);
  ctx.assertFalse("salt only not ok", saltOnlyPreview.ok);
  ctx.assertEqual("salt only no valid", saltOnlyPreview.validRowCount, 0);
  ctx.assertEqual("salt only not ignored", saltOnlyPreview.ignoredRowCount, 0);
  ctx.assertTrue(
    "salt only missing calories",
    saltOnlyPreview.issues.some((issue) => issue.code === "invalid_calories"),
  );

  ctx.scenario("E. New schema — nouveaux champs vides, macros historiques remplies => ok");
  const emptyNewFields = [
    newHeaderLine,
    filledLine("gid://shopify/ProductVariant/40", "new"),
  ].join("\n");
  const emptyNewPreview = previewMealNutritionImportCsv(emptyNewFields);
  ctx.assertTrue("empty new fields ok", emptyNewPreview.ok);
  ctx.assertEqual("empty new fields one valid", emptyNewPreview.validRowCount, 1);
  ctx.assertNull("empty new saturatedFat null", emptyNewPreview.validRows[0]?.saturatedFat);

  ctx.scenario("F. Apply / UI — validRows > 0 sans exiger preview.ok");
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
