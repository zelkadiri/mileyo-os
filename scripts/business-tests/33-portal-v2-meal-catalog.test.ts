/**
 * Business regression — portal V2 meal catalog filtered by objective.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { getMealsForObjective } from "../../app/features/builder/builder-meal-selection";
import type { BuilderMealOption } from "../../app/features/builder/builder-types";
import {
  getPortalMealsForObjective,
  toPortalMealsFromBuilder,
} from "../../app/features/portal/portal-catalog.server";
import { validateMealSelection } from "../../app/features/portal/portal-formatters";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const buildMeal = (
  title: string,
  objective: BuilderMealOption["objective"],
  variantSuffix: string,
): BuilderMealOption => ({
  allergenes: [],
  badges: [],
  calories: 400,
  carbs: 40,
  fat: 10,
  imageAlt: title,
  imageUrl: null,
  ingredients: [],
  objective,
  portionGrams: 350,
  productId: `gid://shopify/Product/${title}`,
  proteins: 30,
  title,
  variantId: `gid://shopify/ProductVariant/${variantSuffix}`,
});

const buildCatalog = (): BuilderMealOption[] => [
  buildMeal("Poulet tikka", SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "wl-1"),
  buildMeal("Poulet tikka", SUBSCRIPTION_OBJECTIVE.BALANCED, "bal-1"),
  buildMeal("Poulet tikka", SUBSCRIPTION_OBJECTIVE.BULK, "bulk-1"),
  buildMeal("Saumon", SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "wl-2"),
  buildMeal("Saumon", SUBSCRIPTION_OBJECTIVE.BULK, "bulk-2"),
  buildMeal("Boulgour", SUBSCRIPTION_OBJECTIVE.BALANCED, "bal-2"),
];

const runSuite = () => {
  const ctx = createBusinessTestContext("33-portal-v2-meal-catalog");
  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalActions = readSource("app/features/portal/portal-actions.server.ts");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalCatalog = readSource("app/features/portal/portal-catalog.server.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const portalFormatters = readSource("app/features/portal/portal-formatters.ts");
  const catalog = buildCatalog();

  ctx.scenario("A. Portail branché sur le catalogue plats V2");
  ctx.assertTrue(
    "portal data uses fetchPortalMealOptions",
    portalData.includes("fetchPortalMealOptions"),
  );
  ctx.assertTrue(
    "portal catalog reuses fetchBuilderMealOptions",
    portalCatalog.includes("fetchBuilderMealOptions") &&
      portalCatalog.includes("getMealsForObjective"),
  );
  ctx.assertTrue(
    "actions use fetchBuilderMealOptions",
    portalActions.includes("fetchBuilderMealOptions") &&
      portalActions.includes("getPortalMealsForObjective"),
  );
  ctx.assertFalse(
    "portal data does not use V1 getCollectionProducts",
    portalData.includes("getCollectionProducts") ||
      portalData.includes("toPortalMeals("),
  );
  ctx.assertFalse(
    "portal catalog dropped V1 first-variant query",
    portalCatalog.includes("PortalMealProducts") ||
      portalCatalog.includes("variants(first: 1)") ||
      portalCatalog.includes("export const getCollectionProducts") ||
      portalCatalog.includes("export const toPortalMeals "),
  );
  ctx.assertFalse(
    "portal actions no longer call toPortalMeals V1",
    portalActions.includes("toPortalMeals(") ||
      portalActions.includes("getCollectionProducts"),
  );

  ctx.scenario("B. Filtre objectif — une variante par recette");
  const weightLoss = getPortalMealsForObjective(
    catalog,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual("weight_loss meal count", weightLoss.length, 2);
  ctx.assertEqual(
    "weight_loss titles",
    weightLoss.map((meal) => meal.title).join("|"),
    "Poulet tikka|Saumon",
  );
  ctx.assertTrue(
    "weight_loss ids are variantIds",
    weightLoss.every(
      (meal) =>
        meal.id === meal.variantId &&
        meal.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
  );
  ctx.assertEqual(
    "weight_loss poulet variant",
    weightLoss.find((meal) => meal.title === "Poulet tikka")?.variantId,
    "gid://shopify/ProductVariant/wl-1",
  );

  const bulk = getPortalMealsForObjective(catalog, SUBSCRIPTION_OBJECTIVE.BULK);
  ctx.assertEqual("bulk meal count", bulk.length, 2);
  ctx.assertEqual(
    "bulk poulet uses bulk variant",
    bulk.find((meal) => meal.title === "Poulet tikka")?.variantId,
    "gid://shopify/ProductVariant/bulk-1",
  );
  ctx.assertTrue(
    "bulk list stays on bulk",
    bulk.every((meal) => meal.objective === SUBSCRIPTION_OBJECTIVE.BULK),
  );
  ctx.assertEqual(
    "null objective yields no meals",
    getPortalMealsForObjective(catalog, null).length,
    0,
  );
  ctx.assertEqual(
    "helper delegates to getMealsForObjective",
    getMealsForObjective(catalog, SUBSCRIPTION_OBJECTIVE.BALANCED).length,
    2,
  );

  ctx.scenario("C. Identité picker = variantId");
  ctx.assertTrue(
    "portal meals map id to variantId",
    portalCatalog.includes("id: meal.variantId") &&
      portalCatalog.includes("variantId: meal.variantId"),
  );
  ctx.assertTrue(
    "client uses meal.variantId",
    portalClient.includes("meal.variantId") &&
      portalClient.includes("function mealKey(meal)"),
  );
  ctx.assertTrue(
    "client filters meals by selection.objective",
    portalClient.includes("function mealsForSelection(selection)") &&
      portalClient.includes("meal.objective === selection.objective"),
  );
  ctx.assertTrue(
    "render maps initial quantities per objective",
    portalRender.includes("meal.objective === selection.objective"),
  );

  ctx.scenario("D. Validation serveur rejette un plat hors objectif");
  const portalMeals = toPortalMealsFromBuilder(catalog);
  const valid = validateMealSelection({
    meals: weightLoss,
    mealsCount: 2,
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    quantities: {
      "gid://shopify/ProductVariant/wl-1": 1,
      "gid://shopify/ProductVariant/wl-2": 1,
    },
  });
  ctx.assertTrue("same-objective selection accepted", "titles" in valid);
  if ("titles" in valid) {
    ctx.assertEqual(
      "persisted titles stay JSON titles",
      valid.titles.join("|"),
      "Poulet tikka|Saumon",
    );
  }

  const offObjective = validateMealSelection({
    meals: weightLoss,
    mealsCount: 1,
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    quantities: {
      "gid://shopify/ProductVariant/bulk-1": 1,
    },
  });
  ctx.assertTrue(
    "bulk variant rejected for weight_loss",
    "error" in offObjective,
  );

  const unfilteredOffObjective = validateMealSelection({
    meals: portalMeals,
    mealsCount: 1,
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    quantities: {
      "gid://shopify/ProductVariant/bulk-1": 1,
    },
  });
  ctx.assertTrue(
    "unfiltered catalog still rejects other objective",
    "error" in unfilteredOffObjective,
  );

  ctx.assertTrue(
    "actions pass objective into validateMealSelection",
    portalFormatters.includes("meal.objective !== objective") &&
      portalActions.includes("objective: currentBox.objective") &&
      portalActions.includes("objective,"),
  );

  return finishSuite("33-portal-v2-meal-catalog", ctx);
};

process.exitCode = runSuite();
