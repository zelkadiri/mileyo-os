/**
 * Business regression — builder objective step (13D / 13I-A launch pricing).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVES,
} from "../../app/constants/subscriptionObjective";
import {
  formatObjectiveLaunchStartingPriceLabel,
  formatObjectiveRecurringStartingPriceLabel,
  formatObjectiveStartingPriceLabel,
  getBuilderLaunchPricing,
  getObjectiveStartingPriceLabels,
  getStartingBoxForObjective,
  getStartingPriceForObjective,
} from "../../app/features/builder/builder-box-selection";
import {
  BUILDER_OBJECTIVE_OPTIONS,
  BUILDER_STEP_COUNT,
  BUILDER_STEPS,
  canContinueFromObjective,
  getBuilderStepIndex,
  getBuilderStepLabel,
  getBuilderStepProgressPercent,
} from "../../app/features/builder/builder-objective-options";
import type { BuilderBoxOption } from "../../app/features/builder/builder-types";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const readSource = (relativePath: string): string =>
  readFileSync(join(ROOT, relativePath), "utf8");

const PRODUCT_ID = "gid://shopify/Product/9714426871948";
const PLAN_ID = "gid://shopify/SellingPlan/3530227852";

const pricedBoxes: BuilderBoxOption[] = [
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/9101",
    variantTitle: "8 weight_loss",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    mealCount: 8,
    price: "76.11",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/9102",
    variantTitle: "12 weight_loss",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    mealCount: 12,
    price: "125.11",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/9201",
    variantTitle: "8 balanced",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    mealCount: 8,
    price: "76.22",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/9301",
    variantTitle: "8 bulk",
    objective: SUBSCRIPTION_OBJECTIVE.BULK,
    mealCount: 8,
    price: "76.33",
    sellingPlanId: PLAN_ID,
  },
];

const runSuite = () => {
  const ctx = createBusinessTestContext("13-builder-objective-step");
  const selectionSource = readSource(
    "app/features/builder/builder-box-selection.ts",
  );
  const clientSource = readSource("app/features/builder/builder-client.ts");
  const renderSource = readSource("app/features/builder/builder-render.ts");

  ctx.scenario("A. Objective options — exact métier values");
  ctx.given("les options builder dérivées de SUBSCRIPTION_OBJECTIVES");
  ctx.assertEqual("exactly 3 options", BUILDER_OBJECTIVE_OPTIONS.length, 3);
  ctx.assertEqual(
    "option values match SUBSCRIPTION_OBJECTIVES",
    BUILDER_OBJECTIVE_OPTIONS.map((option) => option.value).join("|"),
    [...SUBSCRIPTION_OBJECTIVES].join("|"),
  );
  ctx.assertEqual(
    "weight_loss present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    true,
  );
  ctx.assertEqual(
    "balanced present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BALANCED,
    ),
    true,
  );
  ctx.assertEqual(
    "bulk present",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BULK,
    ),
    true,
  );
  ctx.assertEqual(
    "no fourth métier value",
    BUILDER_OBJECTIVE_OPTIONS.some(
      (option) =>
        option.value !== SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS &&
        option.value !== SUBSCRIPTION_OBJECTIVE.BALANCED &&
        option.value !== SUBSCRIPTION_OBJECTIVE.BULK,
    ),
    false,
  );

  ctx.scenario("B. Labels and descriptions");
  for (const option of BUILDER_OBJECTIVE_OPTIONS) {
    ctx.assertTrue(
      `${option.value} label non-empty`,
      option.label.trim().length > 0,
    );
    ctx.assertTrue(
      `${option.value} description non-empty`,
      option.description.trim().length > 0,
    );
    ctx.assertEqual(
      `${option.value} is in SUBSCRIPTION_OBJECTIVES`,
      (SUBSCRIPTION_OBJECTIVES as readonly string[]).includes(option.value),
      true,
    );
  }
  ctx.assertEqual(
    "weight_loss label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    )?.label,
    "Perte de poids",
  );
  ctx.assertEqual(
    "balanced label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BALANCED,
    )?.label,
    "Équilibré",
  );
  ctx.assertEqual(
    "bulk label",
    BUILDER_OBJECTIVE_OPTIONS.find(
      (option) => option.value === SUBSCRIPTION_OBJECTIVE.BULK,
    )?.label,
    "Prise de masse",
  );

  ctx.scenario("C. Step order — objectif first");
  ctx.assertEqual("step count is 6", BUILDER_STEP_COUNT, 6);
  ctx.assertEqual("first step is objectif", BUILDER_STEPS[0], "objectif");
  ctx.assertEqual(
    "full step order",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas→email→recap",
  );
  ctx.assertEqual("objectif index", getBuilderStepIndex("objectif"), 0);
  ctx.assertEqual("formule index", getBuilderStepIndex("formule"), 1);
  ctx.assertEqual("livraison index", getBuilderStepIndex("livraison"), 2);
  ctx.assertEqual("repas index", getBuilderStepIndex("repas"), 3);
  ctx.assertEqual("email index", getBuilderStepIndex("email"), 4);
  ctx.assertEqual("recap index", getBuilderStepIndex("recap"), 5);
  ctx.assertEqual(
    "internal formule id preserved (UX copy is Box)",
    BUILDER_STEPS[1],
    "formule",
  );

  ctx.scenario("D. Objective continue validation");
  ctx.assertFalse("null cannot continue", canContinueFromObjective(null));
  ctx.assertFalse(
    "undefined cannot continue",
    canContinueFromObjective(undefined),
  );
  ctx.assertFalse("empty cannot continue", canContinueFromObjective(""));
  ctx.assertTrue(
    "weight_loss can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
  );
  ctx.assertTrue(
    "balanced can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.BALANCED),
  );
  ctx.assertTrue(
    "bulk can continue",
    canContinueFromObjective(SUBSCRIPTION_OBJECTIVE.BULK),
  );
  ctx.assertFalse(
    "unknown value cannot continue",
    canContinueFromObjective("lose_weight"),
  );

  ctx.scenario("E. Serialization / single source of truth");
  ctx.assertEqual(
    "options length equals SUBSCRIPTION_OBJECTIVES length",
    BUILDER_OBJECTIVE_OPTIONS.length,
    SUBSCRIPTION_OBJECTIVES.length,
  );
  for (let index = 0; index < SUBSCRIPTION_OBJECTIVES.length; index += 1) {
    ctx.assertEqual(
      `option[${index}] value from SUBSCRIPTION_OBJECTIVES`,
      BUILDER_OBJECTIVE_OPTIONS[index]?.value,
      SUBSCRIPTION_OBJECTIVES[index],
    );
  }

  ctx.scenario("Progress labels for 6 steps");
  ctx.assertEqual(
    "objectif label",
    getBuilderStepLabel("objectif"),
    "Étape 1 sur 6",
  );
  ctx.assertEqual(
    "formule label",
    getBuilderStepLabel("formule"),
    "Étape 2 sur 6",
  );
  ctx.assertEqual(
    "livraison label",
    getBuilderStepLabel("livraison"),
    "Étape 3 sur 6",
  );
  ctx.assertEqual("repas label", getBuilderStepLabel("repas"), "Étape 4 sur 6");
  ctx.assertEqual("email label", getBuilderStepLabel("email"), "Étape 5 sur 6");
  ctx.assertEqual("recap label", getBuilderStepLabel("recap"), "Étape 6 sur 6");
  ctx.assertEqual(
    "objectif progress",
    getBuilderStepProgressPercent("objectif"),
    17,
  );
  ctx.assertEqual(
    "formule progress",
    getBuilderStepProgressPercent("formule"),
    33,
  );
  ctx.assertEqual(
    "livraison progress",
    getBuilderStepProgressPercent("livraison"),
    50,
  );
  ctx.assertEqual("repas progress", getBuilderStepProgressPercent("repas"), 67);
  ctx.assertEqual("email progress", getBuilderStepProgressPercent("email"), 83);
  ctx.assertEqual("recap progress", getBuilderStepProgressPercent("recap"), 100);

  ctx.scenario("F. Objective launch pricing — shared helper, same reference box");
  const labels = getObjectiveStartingPriceLabels(pricedBoxes);
  const weightLossBox = getStartingBoxForObjective(
    pricedBoxes,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  const balancedBox = getStartingBoxForObjective(
    pricedBoxes,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  const bulkBox = getStartingBoxForObjective(
    pricedBoxes,
    SUBSCRIPTION_OBJECTIVE.BULK,
  );

  ctx.assertEqual("weight_loss reference price", weightLossBox?.price, "76.11");
  ctx.assertEqual("weight_loss reference meals", weightLossBox?.mealCount, 8);
  ctx.assertEqual("balanced reference price", balancedBox?.price, "76.22");
  ctx.assertEqual("bulk reference price", bulkBox?.price, "76.33");
  ctx.assertEqual(
    "getStartingPriceForObjective stays regular min",
    getStartingPriceForObjective(
      pricedBoxes,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    "76.11",
  );

  const weightLossLaunch = getBuilderLaunchPricing({
    mealCount: weightLossBox!.mealCount,
    regularPrice: weightLossBox!.price,
  });
  ctx.assertEqual(
    "weight_loss launch cents",
    weightLossLaunch?.launchPriceCents,
    5611,
  );
  ctx.assertEqual(
    "weight_loss launch line",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.launchLine,
    formatObjectiveLaunchStartingPriceLabel(5611),
  );
  ctx.assertEqual(
    "weight_loss recurring line",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.recurringLine,
    formatObjectiveRecurringStartingPriceLabel(7611),
  );
  ctx.assertEqual(
    "weight_loss launch copy",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.launchLine,
    "À partir de 56,11\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "weight_loss recurring copy",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.recurringLine,
    "Puis à partir de 76,11\u00a0€ / semaine",
  );

  ctx.assertEqual(
    "balanced launch copy",
    labels[SUBSCRIPTION_OBJECTIVE.BALANCED]?.launchLine,
    "À partir de 56,22\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "balanced recurring copy",
    labels[SUBSCRIPTION_OBJECTIVE.BALANCED]?.recurringLine,
    "Puis à partir de 76,22\u00a0€ / semaine",
  );

  ctx.assertEqual(
    "bulk launch copy",
    labels[SUBSCRIPTION_OBJECTIVE.BULK]?.launchLine,
    "À partir de 56,33\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "bulk recurring copy",
    labels[SUBSCRIPTION_OBJECTIVE.BULK]?.recurringLine,
    "Puis à partir de 76,33\u00a0€ / semaine",
  );

  ctx.assertTrue(
    "labels use shared getBuilderLaunchPricing",
    selectionSource.includes("getBuilderLaunchPricing({") &&
      selectionSource.includes("getStartingBoxForObjective"),
  );
  ctx.assertTrue(
    "eligibility note under objective group",
    renderSource.includes("objective-launch-eligibility-note") &&
      renderSource.includes(
        "*Offre de lancement pour les nouveaux clients éligibles.",
      ),
  );
  ctx.assertTrue(
    "client renders launch + recurring objective lines",
    clientSource.includes("objective-card-launch-price") &&
      clientSource.includes("objective-card-recurring-price") &&
      clientSource.includes("priceInfo.launchLine"),
  );
  ctx.assertFalse(
    "no €/repas on objective pricing helpers",
    /getObjectiveStartingPriceLabels[\s\S]*?\/ repas|formatObjectiveLaunchStartingPriceLabel[\s\S]*?\/ repas/.test(
      selectionSource,
    ),
  );
  const renderObjectivesFn =
    clientSource.match(
      /function renderObjectives\(\) \{[\s\S]*?\n {2}function /,
    )?.[0] ?? "";
  ctx.assertTrue(
    "renderObjectives captured",
    renderObjectivesFn.includes("objective-card-launch-price"),
  );
  ctx.assertFalse(
    "client objective render has no / repas",
    renderObjectivesFn.includes("/ repas"),
  );
  ctx.assertFalse(
    "no À payer aujourd’hui on objective",
    renderSource.includes("À payer aujourd’hui") ||
      selectionSource.includes("À payer aujourd’hui"),
  );
  ctx.assertFalse(
    "no Prix garanti wording",
    renderSource.includes("Prix garanti") ||
      selectionSource.includes("Votre prix"),
  );

  const invalidMealBoxes: BuilderBoxOption[] = [
    {
      ...pricedBoxes[0],
      mealCount: 0,
    },
  ];
  const fallbackLabels = getObjectiveStartingPriceLabels(invalidMealBoxes);
  ctx.assertNull(
    "invalid launch → no launch line",
    fallbackLabels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.launchLine ?? null,
  );
  ctx.assertEqual(
    "invalid launch → regular fallback",
    fallbackLabels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.recurringLine,
    formatObjectiveStartingPriceLabel("76.11"),
  );
  ctx.assertEqual(
    "fallback copy",
    fallbackLabels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.recurringLine,
    "À partir de 76,11\u00a0€ / semaine",
  );

  const addToCartFn =
    clientSource.match(
      /function createBuilderCheckout[\s\S]*?\n {2}function /,
    )?.[0] ?? "";
  ctx.assertTrue(
    "storefront checkout intent present",
    addToCartFn.includes("CREATE_CHECKOUT_INTENT") ||
      addToCartFn.includes("create_builder_checkout"),
  );
  ctx.assertFalse(
    "objective launch pricing not injected into checkout",
    /launchPrice|launchPricePerMeal|discountCents|LAUNCH_DISCOUNT/.test(
      addToCartFn,
    ),
  );

  return finishSuite("13-builder-objective-step", ctx);
};

process.exitCode = runSuite();
