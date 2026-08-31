/**
 * Business regression — meal nutrition display formatting (null-safe FR labels + table).
 *
 * Formatters only: no UI render, no Shopify fetch, no Prisma.
 */
import {
  computeMealNutritionPer100g,
  formatMealNutrition,
  formatMealNutritionTable,
} from "../../app/utils/mealNutritionFormat";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const runSuite = () => {
  const ctx = createBusinessTestContext("38-meal-nutrition-format");

  ctx.scenario("A. Toutes les valeurs présentes (labels badge)");
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

  ctx.scenario("D. Valeurs non affichables historiques (0 / négatif / NaN)");
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

  ctx.scenario("E. Calcul Pour 100 g");
  ctx.assertEqual(
    "fat 20g / 400g => 5g per 100g",
    computeMealNutritionPer100g(20, 400),
    5,
  );
  ctx.assertEqual(
    "calories 800 / 400 => 200 per 100g",
    computeMealNutritionPer100g(800, 400),
    200,
  );
  ctx.assertEqual(
    "salt 0 / 400 => 0 per 100g",
    computeMealNutritionPer100g(0, 400),
    0,
  );
  ctx.assertNull(
    "null value => null per100g",
    computeMealNutritionPer100g(null, 400),
  );
  ctx.assertNull(
    "null portion => null per100g",
    computeMealNutritionPer100g(20, null),
  );
  ctx.assertNull(
    "zero portion => null per100g",
    computeMealNutritionPer100g(20, 0),
  );
  ctx.assertNull(
    "negative portion => null per100g",
    computeMealNutritionPer100g(20, -10),
  );

  ctx.scenario("F. Tableau — ordre, 0 valide, null omis");
  const table = formatMealNutritionTable({
    calories: 800,
    proteins: 40,
    carbs: 50,
    fat: 20,
    saturatedFat: 8,
    sugars: 6,
    fiber: 10,
    salt: 0,
    portionGrams: 400,
  });
  ctx.assertTrue("table has rows", table.hasRows);
  ctx.assertEqual("portion label 400 g", table.portionLabel, "400 g");
  ctx.assertEqual(
    "table order",
    table.rows.map((row) => row.key).join("|"),
    "fat|saturatedFat|carbs|sugars|proteins|fiber|salt|calories",
  );
  ctx.assertEqual("fat per portion", table.rows[0]?.perPortion, "20 g");
  ctx.assertEqual("fat per 100g", table.rows[0]?.per100g, "5 g");
  ctx.assertEqual("calories per portion", table.rows[7]?.perPortion, "800 kcal");
  ctx.assertEqual("calories per 100g", table.rows[7]?.per100g, "200 kcal");
  ctx.assertEqual("salt zero per portion", table.rows[6]?.perPortion, "0 g");
  ctx.assertEqual("salt zero per 100g", table.rows[6]?.per100g, "0 g");
  ctx.assertTrue(
    "saturatedFat secondary",
    table.rows.find((row) => row.key === "saturatedFat")?.secondary === true,
  );
  ctx.assertTrue(
    "sugars secondary",
    table.rows.find((row) => row.key === "sugars")?.secondary === true,
  );

  const nullSaltTable = formatMealNutritionTable({
    calories: 450,
    proteins: 38,
    carbs: 35,
    fat: 12,
    saturatedFat: null,
    sugars: null,
    fiber: null,
    salt: null,
    portionGrams: 350,
  });
  ctx.assertFalse(
    "null salt omitted from rows",
    nullSaltTable.rows.some((row) => row.key === "salt"),
  );
  ctx.assertFalse(
    "null sugars omitted from rows",
    nullSaltTable.rows.some((row) => row.key === "sugars"),
  );

  const noPortionTable = formatMealNutritionTable({
    calories: 450,
    proteins: 38,
    carbs: 35,
    fat: 12,
    salt: 0,
    portionGrams: null,
  });
  ctx.assertTrue(
    "no portion still has rows",
    noPortionTable.hasRows,
  );
  ctx.assertTrue(
    "no portion => all per100g null",
    noPortionTable.rows.every((row) => row.per100g === null),
  );
  ctx.assertNull("no NaN in per100g fat", noPortionTable.rows[0]?.per100g);
  ctx.assertEqual(
    "salt 0 still shown without portion",
    noPortionTable.rows.find((row) => row.key === "salt")?.perPortion,
    "0 g",
  );

  return finishSuite("38-meal-nutrition-format", ctx);
};

process.exitCode = runSuite();
