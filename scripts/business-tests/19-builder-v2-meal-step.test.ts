/**
 * Business regression — builder V2 meal step filtered by objective (13F-B).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { toBuilderMealOptions } from "../../app/features/builder/builder-catalog.server";
import {
  buildMealPlatProperties,
  countUniqueProductIds,
  decrementSelectedMealQuantity,
  findMealByVariantId,
  getMealsForObjective,
  getSelectedMealsTotal,
  incrementSelectedMealQuantity,
  toBuilderMealOptions as toBuilderMealOptionsFromSelection,
} from "../../app/features/builder/builder-meal-selection";
import {
  createBuilderBoxSelectionReset,
  shouldResetBoxOnObjectiveChange,
} from "../../app/features/builder/builder-box-selection";
import type { MealCatalogProduct } from "../../app/services/subscriptionMealCatalog.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const PRODUCT_A = "gid://shopify/Product/1001";
const PRODUCT_B = "gid://shopify/Product/1002";

const buildThreeVariantProduct = (
  overrides: Partial<MealCatalogProduct> = {},
): MealCatalogProduct => ({
  id: PRODUCT_A,
  title: "Poulet curry",
  imageAlt: "Poulet curry",
  imageUrl: "https://cdn.example/poulet.jpg",
  allergenes: ["gluten"],
  badges: ["Poulet"],
  ingredients: ["poulet", "curry"],
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/wl",
      variantTitle: "Perte de poids",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      calories: null,
      proteins: null,
      carbs: null,
      fat: null,
      portionGrams: null,
    },
    {
      variantId: "gid://shopify/ProductVariant/bal",
      variantTitle: "Équilibré",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      calories: 425,
      proteins: 40,
      carbs: 35,
      fat: 12,
      portionGrams: 380,
    },
    {
      variantId: "gid://shopify/ProductVariant/bulk",
      variantTitle: "Prise de masse",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      calories: null,
      proteins: null,
      carbs: null,
      fat: null,
      portionGrams: null,
    },
  ],
  ...overrides,
});

const runSuite = () => {
  const ctx = createBusinessTestContext("19-builder-v2-meal-step");

  ctx.scenario("A. Adapter — 3 variants → 3 BuilderMealOption");
  const options = toBuilderMealOptions([buildThreeVariantProduct()]);
  ctx.assertEqual("options length 3", options.length, 3);
  ctx.assertEqual("title is product title", options[0]?.title, "Poulet curry");
  ctx.assertEqual(
    "all titles are product title",
    options.every((option) => option.title === "Poulet curry"),
    true,
  );
  ctx.assertEqual(
    "weight_loss variantId",
    options.find((option) => option.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS)
      ?.variantId,
    "gid://shopify/ProductVariant/wl",
  );
  ctx.assertEqual(
    "balanced objective",
    options.find((option) => option.variantId === "gid://shopify/ProductVariant/bal")
      ?.objective,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertNull(
    "nullable calories allowed",
    options.find((option) => option.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS)
      ?.calories ?? null,
  );
  ctx.assertEqual(
    "balanced calories transported",
    options.find((option) => option.objective === SUBSCRIPTION_OBJECTIVE.BALANCED)
      ?.calories,
    425,
  );
  ctx.assertEqual(
    "adapter re-exported from catalog",
    toBuilderMealOptionsFromSelection,
    toBuilderMealOptions,
  );

  ctx.scenario("B. Adapter exclusions");
  const withNullObjective = toBuilderMealOptions([
    buildThreeVariantProduct({
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/ok",
          variantTitle: "OK",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/null-obj",
          variantTitle: "No objective",
          objective: null,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "",
          variantTitle: "Blank id",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
      ],
    }),
  ]);
  ctx.assertEqual("null objective excluded", withNullObjective.length, 1);
  ctx.assertEqual(
    "kept weight_loss only",
    withNullObjective[0]?.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );

  ctx.scenario("C. Duplicate objective — no first-wins");
  const duplicateWeightLoss = toBuilderMealOptions([
    buildThreeVariantProduct({
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/wl-1",
          variantTitle: "WL 1",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/wl-2",
          variantTitle: "WL 2",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/bal",
          variantTitle: "Balanced",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/bulk",
          variantTitle: "Bulk",
          objective: SUBSCRIPTION_OBJECTIVE.BULK,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
      ],
    }),
  ]);
  ctx.assertEqual(
    "duplicate weight_loss excluded",
    getMealsForObjective(duplicateWeightLoss, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS)
      .length,
    0,
  );
  ctx.assertEqual(
    "balanced still usable",
    getMealsForObjective(duplicateWeightLoss, SUBSCRIPTION_OBJECTIVE.BALANCED)
      .length,
    1,
  );
  ctx.assertEqual(
    "bulk still usable",
    getMealsForObjective(duplicateWeightLoss, SUBSCRIPTION_OBJECTIVE.BULK).length,
    1,
  );

  const duplicateBalanced = toBuilderMealOptions([
    buildThreeVariantProduct({
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/wl",
          variantTitle: "WL",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/bal-1",
          variantTitle: "B1",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/bal-2",
          variantTitle: "B2",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
      ],
    }),
  ]);
  ctx.assertEqual(
    "duplicate balanced excluded only",
    getMealsForObjective(duplicateBalanced, SUBSCRIPTION_OBJECTIVE.BALANCED).length,
    0,
  );
  ctx.assertEqual(
    "weight_loss kept when balanced duplicated",
    getMealsForObjective(duplicateBalanced, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS)
      .length,
    1,
  );

  ctx.scenario("D. Filter by canonical objective");
  const catalog = toBuilderMealOptions([
    buildThreeVariantProduct(),
    buildThreeVariantProduct({
      id: PRODUCT_B,
      title: "Saumon",
      imageAlt: "Saumon",
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/s-wl",
          variantTitle: "WL",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/s-bal",
          variantTitle: "Bal",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/s-bulk",
          variantTitle: "Bulk",
          objective: SUBSCRIPTION_OBJECTIVE.BULK,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
      ],
    }),
  ]);
  ctx.assertEqual("catalog has 6 options", catalog.length, 6);
  const weightLoss = getMealsForObjective(
    catalog,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  const balanced = getMealsForObjective(catalog, SUBSCRIPTION_OBJECTIVE.BALANCED);
  const bulk = getMealsForObjective(catalog, SUBSCRIPTION_OBJECTIVE.BULK);
  ctx.assertEqual("weight_loss count", weightLoss.length, 2);
  ctx.assertEqual("balanced count", balanced.length, 2);
  ctx.assertEqual("bulk count", bulk.length, 2);
  ctx.assertTrue(
    "weight_loss only weight_loss",
    weightLoss.every(
      (meal) => meal.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
  );
  ctx.assertFalse(
    "filter never uses FR label",
    weightLoss.some((meal) => meal.title.includes("Perte de poids")),
  );
  ctx.assertEqual(
    "one card per recipe for weight_loss",
    countUniqueProductIds(weightLoss),
    2,
  );

  ctx.scenario("E. Missing objective — no fallback");
  const incomplete = toBuilderMealOptions([
    buildThreeVariantProduct({
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/wl",
          variantTitle: "WL",
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
        {
          variantId: "gid://shopify/ProductVariant/bal",
          variantTitle: "Bal",
          objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
          calories: null,
          proteins: null,
          carbs: null,
          fat: null,
          portionGrams: null,
        },
      ],
    }),
  ]);
  ctx.assertEqual(
    "bulk missing → absent",
    getMealsForObjective(incomplete, SUBSCRIPTION_OBJECTIVE.BULK).length,
    0,
  );
  ctx.assertEqual(
    "weight_loss still present",
    getMealsForObjective(incomplete, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS).length,
    1,
  );

  ctx.scenario("F. Quantities indexed by variantId");
  let selected: Record<string, number> = {};
  selected = incrementSelectedMealQuantity(
    selected,
    "gid://shopify/ProductVariant/wl",
    12,
  );
  selected = incrementSelectedMealQuantity(
    selected,
    "gid://shopify/ProductVariant/wl",
    12,
  );
  selected = incrementSelectedMealQuantity(
    selected,
    "gid://shopify/ProductVariant/s-wl",
    12,
  );
  ctx.assertEqual(
    "same product different variants stay distinct",
    selected["gid://shopify/ProductVariant/wl"],
    2,
  );
  ctx.assertEqual(
    "second variant qty",
    selected["gid://shopify/ProductVariant/s-wl"],
    1,
  );
  ctx.assertEqual("total", getSelectedMealsTotal(selected), 3);
  selected = decrementSelectedMealQuantity(
    selected,
    "gid://shopify/ProductVariant/s-wl",
  );
  ctx.assertEqual(
    "zero removes key",
    Object.prototype.hasOwnProperty.call(
      selected,
      "gid://shopify/ProductVariant/s-wl",
    ),
    false,
  );
  const capped = incrementSelectedMealQuantity(
    { "gid://shopify/ProductVariant/wl": 12 },
    "gid://shopify/ProductVariant/s-wl",
    12,
  );
  ctx.assertEqual(
    "cannot exceed requiredMeals",
    getSelectedMealsTotal(capped),
    12,
  );
  ctx.assertEqual(
    "find by variantId",
    findMealByVariantId(catalog, "gid://shopify/ProductVariant/wl")?.title,
    "Poulet curry",
  );

  ctx.scenario("G. Cart Plat N uses recipe title via variantId");
  const plats = buildMealPlatProperties(catalog, {
    "gid://shopify/ProductVariant/wl": 2,
    "gid://shopify/ProductVariant/s-wl": 1,
  });
  ctx.assertEqual("Plat 1", plats["Plat 1"], "Poulet curry");
  ctx.assertEqual("Plat 2", plats["Plat 2"], "Poulet curry");
  ctx.assertEqual("Plat 3", plats["Plat 3"], "Saumon");
  ctx.assertFalse(
    "no weight_loss in Plat values",
    Object.values(plats).some((value) => value.includes("weight_loss")),
  );
  ctx.assertFalse(
    "no variant title in Plat values",
    Object.values(plats).some((value) => value === "Perte de poids"),
  );

  ctx.scenario("H. Objective / box reset behavior");
  ctx.assertTrue(
    "objective change resets box",
    shouldResetBoxOnObjectiveChange(
      {
        productId: "p",
        productTitle: "Box",
        variantId: "v",
        variantTitle: "12",
        objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
        mealCount: 12,
        price: "125.00",
        sellingPlanId: "plan",
      },
      SUBSCRIPTION_OBJECTIVE.BULK,
    ),
  );
  const reset = createBuilderBoxSelectionReset();
  ctx.assertNull("reset selectedBox", reset.selectedBox);
  ctx.assertEqual("reset requiredMeals", reset.requiredMeals, 0);
  ctx.assertEqual(
    "reset selectedMeals empty",
    Object.keys(reset.selectedMeals).length,
    0,
  );
  ctx.assertFalse("reset mealsRendered", reset.mealsRendered);

  ctx.scenario("I. Source wiring / no meal price / delivery smoke");
  const client = readRepoFile("app/features/builder/builder-client.ts");
  const catalogServer = readRepoFile(
    "app/features/builder/builder-catalog.server.ts",
  );
  const loader = readRepoFile("app/routes/apps.box-builder.tsx");
  const mealService = readRepoFile(
    "app/services/subscriptionMealCatalog.server.ts",
  );
  const types = readRepoFile("app/features/builder/builder-types.ts");
  const render = readRepoFile("app/features/builder/builder-render.ts");

  ctx.assertTrue(
    "loader uses fetchBuilderMealOptions",
    loader.includes("fetchBuilderMealOptions"),
  );
  ctx.assertFalse(
    "loader no longer uses toBuilderMeals",
    loader.includes("toBuilderMeals"),
  );
  ctx.assertFalse(
    "loader no longer uses getCollectionProducts for meals",
    loader.includes("getCollectionProducts"),
  );
  ctx.assertTrue(
    "catalog adapter uses fetchMealCatalogProducts",
    catalogServer.includes("fetchMealCatalogProducts"),
  );
  ctx.assertTrue(
    "client filters by meal.objective",
    client.includes("meal.objective === selectedObjective"),
  );
  ctx.assertTrue(
    "client selectedMeals uses variantId",
    client.includes("selectedMeals[meal.variantId]"),
  );
  ctx.assertFalse(
    "client no longer uses meal.id for quantities",
    client.includes("selectedMeals[meal.id]"),
  );
  ctx.assertTrue(
    "cart Plat N uses meal.title",
    client.includes('properties["Plat " + propertyIndex] = meal.title'),
  );
  ctx.assertTrue(
    "cart still single box line with selling_plan",
    client.includes("selling_plan: sellingPlanId") &&
      client.includes("items: [item]"),
  );
  ctx.assertFalse(
    "BuilderMealOption has no price field",
    types.includes("export type BuilderMealOption") &&
      /export type BuilderMealOption = \{[^}]*\bprice\b/.test(types),
  );
  ctx.assertTrue(
    "nutrition display uses formatMealNutrition",
    client.includes("formatMealNutrition({") &&
      client.includes("proteins: meal.proteins") &&
      client.includes("carbs: meal.carbs") &&
      client.includes("fat: meal.fat") &&
      client.includes("portionGrams: meal.portionGrams"),
  );
  ctx.assertTrue(
    "calorie badge stays on cards as quick info only",
    client.includes("function appendMealNutritionBadge") &&
      client.includes('className = "meal-nutrition-badge"') &&
      client.includes("nutrition.calories") &&
      client.includes('caption.textContent = "par portion"') &&
      !client.includes("function openMealNutritionModal") &&
      !render.includes('id="meal-nutrition-modal"'),
  );
  ctx.assertTrue(
    "full nutrition details live only in meal drawer",
    client.includes("function openMealDetailDrawer") &&
      client.includes("appendMealDetailNutritionRow(") &&
      client.includes("mealDetailDrawerNutrition") &&
      client.includes('"Calories"') &&
      render.includes('id="meal-detail-drawer-nutrition"') &&
      !client.includes("appendNutritionModalRow"),
  );
  ctx.assertFalse(
    "no legacy info button on meal cards",
    client.includes('className = "meal-nutrition-info"') ||
      client.includes("function appendMealNutritionInfoButton"),
  );
  ctx.assertFalse(
    "no permanent inline nutrition block on meal cards",
    client.includes('className = "meal-nutrition"'),
  );
  ctx.assertFalse(
    "no invented kcal concatenation in client",
    client.includes('meal.calories + " kcal"'),
  );
  ctx.assertFalse(
    "no product-level calories fallback in client",
    client.includes("productCalories") || client.includes("custom.calories"),
  );
  ctx.assertTrue(
    "filters open in a lateral drawer by default closed",
    render.includes('id="meal-filters-toggle"') &&
      render.includes('aria-label="Filtres"') &&
      render.includes('id="meal-filters-drawer"') &&
      render.includes('class="meal-filters-drawer hidden"') &&
      render.includes('id="meal-filters-apply"') &&
      client.includes("function setMealFiltersOpen") &&
      client.includes("function openMealFiltersDrawer") &&
      client.includes("function discardMealFiltersDrawer") &&
      client.includes("function applyMealFilters"),
  );
  ctx.assertTrue(
    "filters use draft state until apply",
    client.includes("draftAllergenFilters") &&
      client.includes("draftBadgeFilters") &&
      client.includes("syncMealFiltersDraftFromSelected") &&
      client.includes("toggleDraftAllergenFilter") &&
      client.includes("toggleDraftBadgeFilter") &&
      client.includes("applyMealFilters") &&
      !client.includes("toggleAllergenFilter(filter.id)") &&
      !client.includes("toggleBadgeFilter(filter.id)"),
  );
  ctx.assertTrue(
    "filters render as checkboxes",
    client.includes('input.type = "checkbox"') &&
      client.includes('"meal-filter-option"') &&
      render.includes('class="meal-filter-options"') &&
      !client.includes("filter-chip"),
  );
  ctx.assertTrue(
    "meals footer is a single floating CTA",
    render.includes('id="add-to-cart"') &&
      render.includes("meals-gauge-cta") &&
      render.includes('id="meals-gauge-footer"') &&
      !render.includes('id="meals-gauge-count"') &&
      !render.includes("meals-gauge-bar") &&
      !render.includes("meals-progress-strip") &&
      !render.includes("meals-progress-count"),
  );
  ctx.assertTrue(
    "meals CTA label switches by selection state",
    client.includes('addToCart.textContent = "Continuer"') &&
      client.includes('"Encore " + remaining') &&
      client.includes('total + " / " + requiredMeals + " repas"') &&
      client.includes("total === 0"),
  );
  ctx.assertTrue(
    "meal detail drawer opens from meal image",
    render.includes('id="meal-detail-drawer"') &&
      client.includes("function openMealDetailDrawer") &&
      client.includes("function closeMealDetailDrawer") &&
      client.includes("meal-card-media--interactive") &&
      client.includes("openMealDetailDrawer(meal)"),
  );
  ctx.assertTrue(
    "meal detail drawer reuses catalog meal fields",
    client.includes("meal.ingredients") &&
      client.includes("meal.allergenes") &&
      client.includes("meal.badges") &&
      client.includes("appendMealDetailNutritionRow(") &&
      render.includes('id="meal-detail-drawer-nutrition"'),
  );
  ctx.assertTrue(
    "empty objective copy present",
    client.includes(
      "Aucun plat n’est disponible pour cet objectif pour le moment.",
    ),
  );
  ctx.assertTrue(
    "meal service keeps variants(first: 10)",
    mealService.includes("variants(first: 10)"),
  );
  ctx.assertTrue(
    "meal service guards hasNextPage",
    mealService.includes("hasNextPage"),
  );
  ctx.assertTrue(
    "render accepts BuilderMealOption",
    render.includes("BuilderMealOption"),
  );
  ctx.assertTrue(
    "delivery weekly windows still present",
    client.includes("selectedDeliveryWindowKey") &&
      client.includes("deliveryWindowOptions") &&
      loader.includes("buildBuilderDeliveryWindowOptions"),
  );
  ctx.assertTrue(
    "box path still fetchBuilderBoxOptions",
    loader.includes("fetchBuilderBoxOptions"),
  );
  ctx.assertTrue(
    "requiredMeals still from box.mealCount",
    client.includes("requiredMeals = box.mealCount"),
  );
  ctx.assertTrue(
    "box change still resets selectedMeals",
    client.includes("selectedMeals = {}") &&
      client.includes("mealsRendered = false"),
  );

  return finishSuite("19-builder-v2-meal-step", ctx);
};

process.exitCode = runSuite();
