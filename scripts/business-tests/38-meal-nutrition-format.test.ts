/**
 * Business regression — meal nutrition display formatting (null-safe FR labels).
 *
 * Formatters only: no UI render, no Shopify fetch, no Prisma.
 */
import { formatMealNutrition } from "../../app/utils/mealNutritionFormat";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const runSuite = () => {
  const ctx = createBusinessTestContext("38-meal-nutrition-format");

  ctx.scenario("A. Toutes les valeurs présentes");
  const full = formatMealNutrition({
    calories: 450,
    proteins: 38,
    carbs: 35,
    fat: 12,
    portionGrams: 350,
  });
  ctx.assertEqual("calories label", full.calories, "450 kcal");
  ctx.assertEqual("proteins label", full.proteins, "38 g protéines");
  ctx.assertEqual("carbs label", full.carbs, "35 g glucides");
  ctx.assertEqual("fat label", full.fat, "12 g lipides");
  ctx.assertEqual("portion label", full.portionGrams, "350 g");
  ctx.assertEqual("lines length is 5", full.lines.length, 5);
  ctx.assertEqual(
    "lines order",
    full.lines.join("|"),
    "450 kcal|38 g protéines|35 g glucides|12 g lipides|350 g",
  );

  ctx.scenario("B. Valeurs partielles — aucune chaîne vide / null affichée");
  const partial = formatMealNutrition({
    calories: 450,
    proteins: null,
    carbs: null,
    fat: 10,
    portionGrams: null,
  });
  ctx.assertEqual("partial calories", partial.calories, "450 kcal");
  ctx.assertNull("partial proteins omitted", partial.proteins);
  ctx.assertNull("partial carbs omitted", partial.carbs);
  ctx.assertEqual("partial fat", partial.fat, "10 g lipides");
  ctx.assertNull("partial portion omitted", partial.portionGrams);
  ctx.assertEqual("partial lines length is 2", partial.lines.length, 2);
  ctx.assertEqual(
    "partial lines content",
    partial.lines.join("|"),
    "450 kcal|10 g lipides",
  );
  ctx.assertTrue(
    "no empty string in lines",
    partial.lines.every((line) => line.length > 0),
  );
  ctx.assertTrue(
    "no literal null in lines",
    partial.lines.every((line) => !line.includes("null")),
  );

  ctx.scenario("C. Toutes les valeurs null — structure vide exploitable");
  const empty = formatMealNutrition({
    calories: null,
    proteins: null,
    carbs: null,
    fat: null,
    portionGrams: null,
  });
  ctx.assertNull("empty calories", empty.calories);
  ctx.assertNull("empty proteins", empty.proteins);
  ctx.assertNull("empty carbs", empty.carbs);
  ctx.assertNull("empty fat", empty.fat);
  ctx.assertNull("empty portion", empty.portionGrams);
  ctx.assertEqual("empty lines length is 0", empty.lines.length, 0);

  ctx.scenario("D. Valeurs non affichables (0 / négatif / NaN)");
  const invalid = formatMealNutrition({
    calories: 0,
    proteins: -5,
    carbs: Number.NaN,
    fat: 12.5,
    portionGrams: null,
  });
  ctx.assertNull("zero calories omitted", invalid.calories);
  ctx.assertNull("negative proteins omitted", invalid.proteins);
  ctx.assertNull("NaN carbs omitted", invalid.carbs);
  ctx.assertEqual("decimal fat FR", invalid.fat, "12,5 g lipides");
  ctx.assertEqual("invalid lines length is 1", invalid.lines.length, 1);

  return finishSuite("38-meal-nutrition-format", ctx);
};

process.exitCode = runSuite();
