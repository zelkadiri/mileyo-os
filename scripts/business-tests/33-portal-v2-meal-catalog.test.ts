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
  const portalStyles = readSource("app/features/portal/portal-styles.ts");
  const catalog = buildCatalog();
  const renderMealGridSource = portalClient.slice(
    portalClient.indexOf("function renderMealGrid"),
    portalClient.indexOf("function updateEditor"),
  );
  const renderBoxChangeMealGridSource = portalClient.slice(
    portalClient.indexOf("function renderBoxChangeMealGrid"),
    portalClient.indexOf("function updateSelectedBoxLabels"),
  );

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

  ctx.scenario("E. Mapper conserve les macros nutritionnelles");
  const mappedCatalog = toPortalMealsFromBuilder(catalog);
  ctx.assertTrue(
    "filled macros are copied to PortalMeal",
    mappedCatalog.length === catalog.length &&
      mappedCatalog.every((meal, index) => {
        const source = catalog[index];
        return (
          source != null &&
          meal.calories === source.calories &&
          meal.proteins === source.proteins &&
          meal.carbs === source.carbs &&
          meal.fat === source.fat &&
          meal.portionGrams === source.portionGrams &&
          meal.id === meal.variantId
        );
      }),
  );
  ctx.assertTrue(
    "rich meal fields are copied to PortalMeal",
    mappedCatalog.every((meal, index) => {
      const source = catalog[index];
      return (
        source != null &&
        meal.badges === source.badges &&
        meal.allergenes === source.allergenes &&
        meal.ingredients === source.ingredients
      );
    }),
  );
  ctx.assertEqual(
    "filled calories preserved",
    mappedCatalog[0]?.calories,
    400,
  );
  ctx.assertEqual(
    "filled proteins preserved",
    mappedCatalog[0]?.proteins,
    30,
  );
  ctx.assertEqual(
    "filled carbs preserved",
    mappedCatalog[0]?.carbs,
    40,
  );
  ctx.assertEqual("filled fat preserved", mappedCatalog[0]?.fat, 10);
  ctx.assertEqual(
    "filled portionGrams preserved",
    mappedCatalog[0]?.portionGrams,
    350,
  );

  const distinctMacros = buildMeal(
    "Dahl lentilles",
    SUBSCRIPTION_OBJECTIVE.BALANCED,
    "bal-macros",
  );
  distinctMacros.calories = 512;
  distinctMacros.proteins = 28.5;
  distinctMacros.carbs = 61;
  distinctMacros.fat = 14;
  distinctMacros.portionGrams = 420;
  distinctMacros.badges = ["Végétarien", "Sans gluten"];
  distinctMacros.allergenes = ["Gluten", "Lait"];
  distinctMacros.ingredients = ["Lentilles", "Épices"];
  const [mappedDistinct] = toPortalMealsFromBuilder([distinctMacros]);
  ctx.assertEqual(
    "distinct calories copied",
    mappedDistinct?.calories,
    512,
  );
  ctx.assertEqual(
    "distinct proteins copied",
    mappedDistinct?.proteins,
    28.5,
  );
  ctx.assertEqual("distinct carbs copied", mappedDistinct?.carbs, 61);
  ctx.assertEqual("distinct fat copied", mappedDistinct?.fat, 14);
  ctx.assertEqual(
    "distinct portionGrams copied",
    mappedDistinct?.portionGrams,
    420,
  );
  ctx.assertEqual(
    "distinct badges copied",
    mappedDistinct?.badges.join("|"),
    "Végétarien|Sans gluten",
  );
  ctx.assertEqual(
    "distinct allergenes copied",
    mappedDistinct?.allergenes.join("|"),
    "Gluten|Lait",
  );
  ctx.assertEqual(
    "distinct ingredients copied",
    mappedDistinct?.ingredients.join("|"),
    "Lentilles|Épices",
  );
  ctx.assertEqual(
    "distinct identity stays variantId",
    mappedDistinct?.id,
    distinctMacros.variantId,
  );

  const nullMacros = buildMeal(
    "Sans macros",
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    "wl-null",
  );
  nullMacros.calories = null;
  nullMacros.proteins = null;
  nullMacros.carbs = null;
  nullMacros.fat = null;
  nullMacros.portionGrams = null;
  const [mappedNull] = toPortalMealsFromBuilder([nullMacros]);
  ctx.assertTrue(
    "null macros stay null on PortalMeal",
    mappedNull?.calories === null &&
      mappedNull?.proteins === null &&
      mappedNull?.carbs === null &&
      mappedNull?.fat === null &&
      mappedNull?.portionGrams === null,
  );

  ctx.scenario("F. Affichage nutrition cartes repas");
  ctx.assertTrue(
    "runtime formatter présent dans portal client",
    portalClient.includes('from "../../utils/mealNutritionFormat"') &&
      portalClient.includes("mealNutritionFormatRuntimeScript") &&
      portalClient.includes("${mealNutritionFormatRuntimeScript}"),
  );
  ctx.assertTrue(
    "helper interne utilise formatMealNutrition",
    portalClient.includes("function appendMealNutritionBadge") &&
      portalClient.includes("function openMealNutritionModal") &&
      portalClient.includes("formatMealNutrition({") &&
      portalClient.includes("calories: meal.calories") &&
      portalClient.includes("proteins: meal.proteins") &&
      portalClient.includes("carbs: meal.carbs") &&
      portalClient.includes("fat: meal.fat") &&
      portalClient.includes("portionGrams: meal.portionGrams") &&
      portalClient.includes("nutrition.lines.length") &&
      portalClient.includes("nutrition.calories"),
  );
  ctx.assertTrue(
    "renderMealGrid utilise formatMealNutrition via le helper",
    renderMealGridSource.includes("appendMealCardMedia(card, meal)"),
  );
  ctx.assertTrue(
    "renderBoxChangeMealGrid utilise formatMealNutrition via le helper",
    renderBoxChangeMealGridSource.includes(
      "appendMealCardMedia(mealCard, meal)",
    ),
  );
  ctx.assertTrue(
    "media nutrition avant titre dans renderMealGrid",
    /appendMealCardMedia\(card, meal\)[\s\S]*title\.textContent = meal\.title[\s\S]*variant\.textContent = meal\.variantTitle/.test(
      renderMealGridSource,
    ),
  );
  ctx.assertTrue(
    "media nutrition avant titre dans renderBoxChangeMealGrid",
    /appendMealCardMedia\(mealCard, meal\)[\s\S]*title\.textContent = meal\.title[\s\S]*variant\.textContent = meal\.variantTitle/.test(
      renderBoxChangeMealGridSource,
    ),
  );
  ctx.assertTrue(
    "modal nutrition présente",
    portalRender.includes('id="meal-nutrition-modal"') &&
      portalRender.includes("Informations nutritionnelles") &&
      portalClient.includes('className = "meal-nutrition-badge"') &&
      portalClient.includes('className = "meal-card-media"') &&
      portalStyles.includes(".meal-nutrition-modal") &&
      portalStyles.includes(".meal-nutrition-badge") &&
      portalStyles.includes(".meal-card-media"),
  );
  ctx.assertFalse(
    "pas de bouton i legacy",
    portalClient.includes('className = "meal-nutrition-info"') ||
      portalClient.includes("function appendMealNutritionInfoButton") ||
      portalStyles.includes(".meal-nutrition-info"),
  );
  ctx.assertFalse(
    "pas de nutrition inline permanente sur les cartes",
    portalClient.includes('className = "meal-nutrition"'),
  );
  ctx.assertFalse(
    "aucune concaténation kcal manuelle",
    portalClient.includes('meal.calories + " kcal"'),
  );
  ctx.assertFalse(
    "aucune concaténation protéines manuelle",
    portalClient.includes('meal.proteins + " g') ||
      portalClient.includes('" g protéines"'),
  );
  ctx.assertFalse(
    "aucune concaténation glucides / lipides manuelle",
    portalClient.includes('meal.carbs + " g') ||
      portalClient.includes('meal.fat + " g') ||
      portalClient.includes('" g glucides"') ||
      portalClient.includes('" g lipides"'),
  );
  ctx.assertFalse(
    "aucune concaténation portion manuelle",
    portalClient.includes('meal.portionGrams + " g"'),
  );
  ctx.assertTrue(
    "identité picker inchangée",
    portalClient.includes("function mealKey(meal)") &&
      portalClient.includes("meal.variantId || meal.id"),
  );
  ctx.assertTrue(
    "filtre objectif inchangé",
    portalClient.includes("function mealsForSelection(selection)") &&
      portalClient.includes("meal.objective === selection.objective"),
  );

  return finishSuite("33-portal-v2-meal-catalog", ctx);
};

process.exitCode = runSuite();
