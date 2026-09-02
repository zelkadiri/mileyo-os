/**
 * Business regression — builder V2 box step (13E-B/C).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BOX_V2_PRODUCT_HANDLE } from "../../app/constants/subscriptionBoxCatalogV2";
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
} from "../../app/constants/subscriptionSellingPlan";
import { toBuilderBoxOptions } from "../../app/features/builder/builder-catalog.server";
import {
  createBuilderBoxSelectionReset,
  filterBuilderBoxesByObjective,
  findBuilderBoxByVariantId,
  formatCentsAsEuroFr,
  formatEuroAmountFr,
  formatObjectiveStartingPriceLabel,
  getBuilderLaunchPricing,
  getObjectiveStartingPriceLabels,
  getStartingPriceForObjective,
  isBuilderBoxCtaEnabled,
  shouldResetBoxOnObjectiveChange,
} from "../../app/features/builder/builder-box-selection";
import { FIRST_BOX_LAUNCH_DISCOUNT_EUR } from "../../app/constants/firstBoxLaunchDiscount";
import { BUILDER_STEPS } from "../../app/features/builder/builder-objective-options";
import type { BuilderBoxOption } from "../../app/features/builder/builder-types";
import {
  applySellingPlanIdToBoxCatalogVariantsV2,
  BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY,
  BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY,
  BOX_V2_CATALOG_VARIANTS_PAGE_SIZE,
  buildBoxCatalogProductV2FromHandleNode,
  collectExactMileyoCatalogGroupSummaries,
  resolveBoxV2CatalogProductByHandle,
  resolveCompatibleWeeklySellingPlanIdFromGroupDetails,
  toTrustedBoxCatalogOptionsV2,
  type ShopifyBoxCatalogProductByHandleNodeV2,
  type ShopifyBoxCatalogSellingPlanGroupDetailsV2,
  type TrustedBoxCatalogOptionV2,
} from "../../app/services/subscriptionBoxCatalog.server";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const PLAN_ID = "gid://shopify/SellingPlan/9001";
const GROUP_ID = "gid://shopify/SellingPlanGroup/8001";
const PRODUCT_ID = "gid://shopify/Product/5001";

const buildHandleProduct = (
  overrides?: Partial<ShopifyBoxCatalogProductByHandleNodeV2>,
): ShopifyBoxCatalogProductByHandleNodeV2 => ({
  id: PRODUCT_ID,
  title: "Box Mileyo V2",
  handle: BOX_V2_PRODUCT_HANDLE,
  featuredImage: {
    altText: "Box Mileyo V2",
    url: "https://cdn.shopify.com/box-v2.jpg",
  },
  sellingPlanGroups: {
    nodes: [{ id: GROUP_ID, name: MILEYO_SELLING_PLAN_GROUP_NAME }],
  },
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/6001",
        title: "12 repas / Perte de poids",
        price: "125.11",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
        mealCountMetafield: { value: "12" },
      },
      {
        id: "gid://shopify/ProductVariant/6002",
        title: "12 repas / Équilibré",
        price: "125.22",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
        mealCountMetafield: { value: "12" },
      },
      {
        id: "gid://shopify/ProductVariant/6003",
        title: "8 repas / Prise de masse",
        price: "76.33",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
        mealCountMetafield: { value: "8" },
      },
    ],
  },
  ...overrides,
});

const buildGroupDetails = (
  overrides?: Partial<ShopifyBoxCatalogSellingPlanGroupDetailsV2>,
): ShopifyBoxCatalogSellingPlanGroupDetailsV2 => ({
  id: GROUP_ID,
  name: MILEYO_SELLING_PLAN_GROUP_NAME,
  sellingPlans: {
    nodes: [
      {
        id: PLAN_ID,
        name: MILEYO_SELLING_PLAN_NAME,
        pricingPolicies: [],
      },
    ],
  },
  productVariants: {
    nodes: [
      { id: "gid://shopify/ProductVariant/6001" },
      { id: "gid://shopify/ProductVariant/6002" },
    ],
  },
  ...overrides,
});

const sampleBuilderBoxes = (): BuilderBoxOption[] => [
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/6001",
    variantTitle: "12 weight_loss",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    mealCount: 12,
    price: "125.11",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/6002",
    variantTitle: "12 balanced",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    mealCount: 12,
    price: "125.22",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/6101",
    variantTitle: "8 weight_loss",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    mealCount: 8,
    price: "76.11",
    sellingPlanId: PLAN_ID,
  },
  {
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    variantId: "gid://shopify/ProductVariant/6201",
    variantTitle: "16 bulk",
    objective: SUBSCRIPTION_OBJECTIVE.BULK,
    mealCount: 16,
    price: "158.33",
    sellingPlanId: PLAN_ID,
  },
];

const runSuite = () => {
  const ctx = createBusinessTestContext("17-builder-v2-box-step");
  const catalogSource = readSource(
    "app/services/subscriptionBoxCatalog.server.ts",
  );
  const clientSource = readSource("app/features/builder/builder-client.ts");
  const renderSource = readSource("app/features/builder/builder-render.ts");
  const loaderSource = readSource("app/routes/apps.box-builder.tsx");
  const adapterSource = readSource(
    "app/features/builder/builder-catalog.server.ts",
  );
  const checkoutServerSource = readSource(
    "app/features/builder/builder-checkout.server.ts",
  );
  const createCheckoutFn =
    clientSource.match(/function createBuilderCheckout[\s\S]*?\n {2}function /)?.[0] ??
    "";

  ctx.scenario("A. QUERY A — handle lookup + cost-safe shape");
  ctx.assertEqual(
    "variants page size is 100",
    BOX_V2_CATALOG_VARIANTS_PAGE_SIZE,
    100,
  );
  ctx.assertTrue(
    "QUERY A named BoxV2CatalogProductByHandle",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes(
      "query BoxV2CatalogProductByHandle",
    ),
  );
  ctx.assertTrue(
    "QUERY A products by query variable",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes(
      "products(first: 5, query: $query)",
    ),
  );
  ctx.assertTrue(
    "QUERY A variants(first: 100)",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("variants(first: 100)"),
  );
  ctx.assertFalse(
    "QUERY A not variants(first: 10)",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("variants(first: 10)"),
  );
  ctx.assertTrue(
    "QUERY A product-level sellingPlanGroups",
    /sellingPlanGroups\(first:\s*20\)/.test(BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY),
  );
  ctx.assertFalse(
    "QUERY A no nested variant sellingPlanGroups",
    /variants\([\s\S]*?sellingPlanGroups\(/.test(
      BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY,
    ),
  );
  ctx.assertFalse(
    "QUERY A no sellingPlans",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("sellingPlans"),
  );
  ctx.assertFalse(
    "QUERY A no pricingPolicies",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("pricingPolicies"),
  );
  ctx.assertFalse(
    "QUERY A no prix_abonnement",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("prix_abonnement"),
  );
  ctx.assertTrue(
    "service imports BOX_V2_PRODUCT_HANDLE",
    catalogSource.includes("BOX_V2_PRODUCT_HANDLE"),
  );
  ctx.assertTrue(
    "fetch uses handle template",
    catalogSource.includes("`handle:${BOX_V2_PRODUCT_HANDLE}`"),
  );
  ctx.assertEqual("shared handle value", BOX_V2_PRODUCT_HANDLE, "box-mileyo-v2");

  ctx.scenario("B. QUERY B — group details");
  ctx.assertTrue(
    "QUERY B named BoxV2CatalogSellingPlanGroupDetails",
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "query BoxV2CatalogSellingPlanGroupDetails",
    ),
  );
  ctx.assertTrue(
    "QUERY B sellingPlanGroup(id)",
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "sellingPlanGroup(id: $groupId)",
    ),
  );
  ctx.assertTrue(
    "QUERY B sellingPlans",
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "sellingPlans(first: 10)",
    ),
  );
  ctx.assertTrue(
    "QUERY B pricingPolicies",
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY.includes("pricingPolicies"),
  );
  ctx.assertTrue(
    "QUERY B productVariants filtered by productId",
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "productVariants(first: 100, productId: $productId)",
    ),
  );

  ctx.scenario("C. Handle lookup resolution");
  ctx.assertEqual(
    "absent → absent",
    resolveBoxV2CatalogProductByHandle([]).status,
    "absent",
  );
  ctx.assertEqual(
    "exact handle → exact",
    resolveBoxV2CatalogProductByHandle([buildHandleProduct()]).status,
    "exact",
  );
  ctx.assertEqual(
    "wrong handle → handleMismatch",
    resolveBoxV2CatalogProductByHandle([
      buildHandleProduct({ handle: "autre-handle" }),
    ]).status,
    "handleMismatch",
  );
  ctx.assertEqual(
    "duplicate handle → ambiguous",
    resolveBoxV2CatalogProductByHandle([
      buildHandleProduct(),
      buildHandleProduct({ id: "gid://shopify/Product/5002" }),
    ]).status,
    "ambiguous",
  );

  ctx.scenario("D. Selling plan merge");
  const product = buildHandleProduct();
  const groups = collectExactMileyoCatalogGroupSummaries(product);
  ctx.assertEqual("exactly one Mileyo group", groups.length, 1);

  const compatiblePlanId = resolveCompatibleWeeklySellingPlanIdFromGroupDetails(
    buildGroupDetails(),
  );
  ctx.assertEqual("compatible plan id", compatiblePlanId, PLAN_ID);

  ctx.assertNull(
    "0 groups → null plan",
    resolveCompatibleWeeklySellingPlanIdFromGroupDetails(null),
  );
  ctx.assertNull(
    "0 exact plans → null",
    resolveCompatibleWeeklySellingPlanIdFromGroupDetails(
      buildGroupDetails({
        sellingPlans: {
          nodes: [{ id: "gid://shopify/SellingPlan/1", name: "Autre" }],
        },
      }),
    ),
  );
  ctx.assertNull(
    "multiple exact plans → null",
    resolveCompatibleWeeklySellingPlanIdFromGroupDetails(
      buildGroupDetails({
        sellingPlans: {
          nodes: [
            { id: "gid://shopify/SellingPlan/1", name: MILEYO_SELLING_PLAN_NAME },
            { id: "gid://shopify/SellingPlan/2", name: MILEYO_SELLING_PLAN_NAME },
          ],
        },
      }),
    ),
  );
  ctx.assertNull(
    "pricingPolicies non-empty → null",
    resolveCompatibleWeeklySellingPlanIdFromGroupDetails(
      buildGroupDetails({
        sellingPlans: {
          nodes: [
            {
              id: PLAN_ID,
              name: MILEYO_SELLING_PLAN_NAME,
              pricingPolicies: [{ __typename: "SellingPlanFixedPricingPolicy" }],
            },
          ],
        },
      }),
    ),
  );

  const merged = buildBoxCatalogProductV2FromHandleNode(
    product,
    buildGroupDetails(),
  );
  ctx.assertEqual("keeps 3 variants", merged.variants.length, 3);
  ctx.assertEqual(
    "attached weight_loss gets plan",
    merged.variants[0]?.sellingPlanId,
    PLAN_ID,
  );
  ctx.assertEqual(
    "attached balanced gets plan",
    merged.variants[1]?.sellingPlanId,
    PLAN_ID,
  );
  ctx.assertNull(
    "unattached bulk gets null",
    merged.variants[2]?.sellingPlanId ?? null,
  );

  const noGroupProduct = buildBoxCatalogProductV2FromHandleNode(
    buildHandleProduct({ sellingPlanGroups: { nodes: [] } }),
    null,
  );
  ctx.assertTrue(
    "0 groups → all null sellingPlanId",
    noGroupProduct.variants.every((variant) => variant.sellingPlanId === null),
  );

  const multiGroupProduct = buildBoxCatalogProductV2FromHandleNode(
    buildHandleProduct({
      sellingPlanGroups: {
        nodes: [
          { id: GROUP_ID, name: MILEYO_SELLING_PLAN_GROUP_NAME },
          {
            id: "gid://shopify/SellingPlanGroup/8002",
            name: MILEYO_SELLING_PLAN_GROUP_NAME,
          },
        ],
      },
    }),
    buildGroupDetails(),
  );
  ctx.assertTrue(
    "multiple groups → no arbitrary plan assignment",
    multiGroupProduct.variants.every((variant) => variant.sellingPlanId === null),
  );

  const applied = applySellingPlanIdToBoxCatalogVariantsV2(
    [
      {
        variantId: "gid://shopify/ProductVariant/1",
        variantTitle: "A",
        objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
        mealCount: 12,
        price: "10.00",
        sellingPlanId: null,
      },
      {
        variantId: "gid://shopify/ProductVariant/2",
        variantTitle: "B",
        objective: SUBSCRIPTION_OBJECTIVE.BULK,
        mealCount: 8,
        price: "20.00",
        sellingPlanId: null,
      },
    ],
    PLAN_ID,
    new Set(["gid://shopify/ProductVariant/1"]),
  );
  ctx.assertEqual("apply attaches matching only", applied[0]?.sellingPlanId, PLAN_ID);
  ctx.assertNull("apply leaves others null", applied[1]?.sellingPlanId ?? null);

  ctx.scenario("E. Trusted V2 preserved + builder adapter");
  const trusted = toTrustedBoxCatalogOptionsV2([merged]);
  ctx.assertEqual("trusted keeps unattached variant", trusted.length, 3);
  ctx.assertNull(
    "trusted allows null sellingPlanId",
    trusted.find((option) => option.variantId.endsWith("/6003"))
      ?.sellingPlanId ?? null,
  );

  const builderOptions = toBuilderBoxOptions(trusted);
  ctx.assertEqual("builder excludes null sellingPlanId", builderOptions.length, 2);
  ctx.assertTrue(
    "builder sellingPlanId always string",
    builderOptions.every((option) => typeof option.sellingPlanId === "string"),
  );
  const weightLossOption = builderOptions.find(
    (option) => option.variantId === "gid://shopify/ProductVariant/6001",
  );
  ctx.assertEqual(
    "builder price unchanged",
    weightLossOption?.price,
    "125.11",
  );
  ctx.assertEqual(
    "builder objective unchanged",
    weightLossOption?.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "builder mealCount unchanged",
    weightLossOption?.mealCount,
    12,
  );
  ctx.assertEqual(
    "builder variantId unchanged",
    weightLossOption?.variantId,
    "gid://shopify/ProductVariant/6001",
  );
  ctx.assertFalse(
    "adapter does not read prix_abonnement",
    adapterSource.includes("prix_abonnement") &&
      /toBuilderBoxOptions[\s\S]*prix_abonnement/.test(adapterSource),
  );

  const trustedWithoutPlan: TrustedBoxCatalogOptionV2 = {
    variantId: "gid://shopify/ProductVariant/7001",
    variantTitle: "No plan",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    mealCount: 10,
    price: "96.22",
    sellingPlanId: null,
    productId: PRODUCT_ID,
    productTitle: "Box Mileyo V2",
    imageAlt: "Box",
    imageUrl: null,
  };
  ctx.assertEqual(
    "trusted without plan excluded from builder",
    toBuilderBoxOptions([trustedWithoutPlan]).length,
    0,
  );

  ctx.scenario("F. Objective filter + reset");
  const boxes = sampleBuilderBoxes();
  ctx.assertEqual(
    "weight_loss filter",
    filterBuilderBoxesByObjective(
      boxes,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ).length,
    2,
  );
  ctx.assertEqual(
    "balanced filter",
    filterBuilderBoxesByObjective(boxes, SUBSCRIPTION_OBJECTIVE.BALANCED)
      .length,
    1,
  );
  ctx.assertEqual(
    "bulk filter",
    filterBuilderBoxesByObjective(boxes, SUBSCRIPTION_OBJECTIVE.BULK).length,
    1,
  );
  ctx.assertTrue(
    "filter uses objective field only",
    filterBuilderBoxesByObjective(
      boxes,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ).every((box) => box.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
  );

  const selectedWeightLoss = boxes[0];
  ctx.assertTrue(
    "objective change requires reset",
    shouldResetBoxOnObjectiveChange(
      selectedWeightLoss,
      SUBSCRIPTION_OBJECTIVE.BULK,
    ),
  );
  ctx.assertFalse(
    "same objective does not reset",
    shouldResetBoxOnObjectiveChange(
      selectedWeightLoss,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
  );
  const reset = createBuilderBoxSelectionReset();
  ctx.assertNull("reset selectedBox null", reset.selectedBox);
  ctx.assertEqual("reset requiredMeals 0", reset.requiredMeals, 0);
  ctx.assertEqual(
    "reset selectedMeals empty",
    Object.keys(reset.selectedMeals).length,
    0,
  );
  ctx.assertEqual("reset mealsRendered false", reset.mealsRendered, false);

  ctx.scenario("G. Selection by variantId + no auto-select");
  ctx.assertEqual(
    "find by variantId",
    findBuilderBoxByVariantId(boxes, "gid://shopify/ProductVariant/6101")
      ?.mealCount,
    8,
  );
  ctx.assertEqual(
    "same productId distinct variants",
    findBuilderBoxByVariantId(boxes, "gid://shopify/ProductVariant/6001")
      ?.variantId,
    "gid://shopify/ProductVariant/6001",
  );
  ctx.assertEqual(
    "other variant same product",
    findBuilderBoxByVariantId(boxes, "gid://shopify/ProductVariant/6002")
      ?.variantId,
    "gid://shopify/ProductVariant/6002",
  );
  ctx.assertFalse("CTA disabled without selection", isBuilderBoxCtaEnabled(null));
  ctx.assertTrue(
    "CTA enabled with checkout-ready box",
    isBuilderBoxCtaEnabled(boxes[0]),
  );
  ctx.assertFalse(
    "client has no initializeDefaultSelection",
    clientSource.includes("initializeDefaultSelection"),
  );
  ctx.assertFalse(
    "client has no getDefaultBox",
    clientSource.includes("getDefaultBox"),
  );
  ctx.assertTrue(
    "client selects by variantId",
    clientSource.includes("selectedBox.variantId === box.variantId"),
  );
  ctx.assertTrue(
    "client filters by objective equality",
    clientSource.includes("box.objective === selectedObjective"),
  );

  ctx.scenario("H. One-time removed + checkout always subscription");
  ctx.assertFalse("no orderType state", clientSource.includes("var orderType"));
  ctx.assertFalse("no setOrderType", clientSource.includes("setOrderType"));
  ctx.assertFalse(
    "no one-time toggle id",
    clientSource.includes("one-time-toggle") ||
      renderSource.includes("one-time-toggle"),
  );
  ctx.assertFalse(
    "no subscription-toggle id",
    clientSource.includes("subscription-toggle") ||
      renderSource.includes("subscription-toggle"),
  );
  ctx.assertFalse(
    "no Commande unique copy in render",
    renderSource.includes("Commande unique"),
  );
  ctx.assertFalse(
    "no one-time branch in cart",
    clientSource.includes('orderType === "one-time"'),
  );
  ctx.assertTrue(
    "checkout always sends sellingPlanId",
    createCheckoutFn.includes("sellingPlanId: selectedBox.sellingPlanId"),
  );
  ctx.assertTrue(
    "Type de commande always Abonnement hebdomadaire (server)",
    checkoutServerSource.includes("BUILDER_CART_ORDER_TYPE_SUBSCRIPTION") &&
      readSource("app/features/builder/builder-cart.ts").includes(
        '"Abonnement hebdomadaire"',
      ),
  );
  ctx.assertTrue(
    "Nombre de repas from checkout mealCount (server)",
    checkoutServerSource.includes("BUILDER_CART_MEAL_COUNT_PROPERTY") &&
      createCheckoutFn.includes("mealCount: selectedBox.mealCount"),
  );

  ctx.scenario("I. Price + launch promo display");
  ctx.assertTrue(
    "client prices from box.price",
    clientSource.includes("box.price"),
  );
  ctx.assertTrue(
    "client uses getBuilderLaunchPricing for display",
    clientSource.includes("function getBuilderLaunchPricing"),
  );
  ctx.assertTrue(
    "box cards show première box*",
    clientSource.includes(" la première box*"),
  );
  ctx.assertTrue(
    "box cards show Puis weekly",
    clientSource.includes('"Puis "') &&
      clientSource.includes('" / semaine"'),
  );
  ctx.assertTrue(
    "box cards show launch per-meal",
    clientSource.includes("launchPricePerMealCents") &&
      clientSource.includes('" / repas"'),
  );
  ctx.assertTrue(
    "eligibility note under box list",
    renderSource.includes("box-launch-eligibility-note") &&
      renderSource.includes("nouveaux clients éligibles"),
  );
  ctx.assertTrue(
    "eligibility note uses FIRST_BOX_LAUNCH_DISCOUNT_EUR",
    renderSource.includes("${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €") ||
      renderSource.includes(`${FIRST_BOX_LAUNCH_DISCOUNT_EUR} €`),
  );
  ctx.assertEqual("discount constant is 20", FIRST_BOX_LAUNCH_DISCOUNT_EUR, 20);
  ctx.assertFalse(
    "no FIRST_WEEK_DISCOUNT_EUR",
    clientSource.includes("FIRST_WEEK_DISCOUNT_EUR"),
  );
  ctx.assertFalse(
    "no subscriptionPrice pricing",
    clientSource.includes("subscriptionPrice"),
  );
  const promoBlock =
    renderSource.match(/class="tunnel-promo"[\s\S]*?<\/div>/)?.[0] ?? "";
  ctx.assertTrue(
    "tunnel promo banner present",
    renderSource.includes('class="tunnel-promo"'),
  );
  ctx.assertTrue(
    "promo before tunnel header",
    /tunnel-promo[\s\S]*tunnel-header/.test(renderSource),
  );
  ctx.assertEqual(
    "promo appears once in builder render",
    (renderSource.match(/class="tunnel-promo"/g) ?? []).length,
    1,
  );
  ctx.assertTrue(
    "promo uses FIRST_BOX_LAUNCH_DISCOUNT_EUR",
    renderSource.includes("${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € offerts") ||
      promoBlock.includes(`${FIRST_BOX_LAUNCH_DISCOUNT_EUR} € offerts`),
  );
  ctx.assertTrue(
    "promo mentions première box",
    promoBlock.includes("première box"),
  );
  ctx.assertTrue(
    "promo subtitle present",
    promoBlock.includes("Appliqués automatiquement au paiement"),
  );
  ctx.assertTrue(
    "promo dismiss control present",
    renderSource.includes('id="tunnel-promo-dismiss"') &&
      clientSource.includes("initTunnelPromoDismiss"),
  );
  ctx.assertFalse(
    "no FAQ remise 20 €",
    renderSource.includes("remise de 20"),
  );
  ctx.assertFalse(
    "no première semaine promo copy",
    clientSource.includes("la 1ère semaine"),
  );

  {
    const sample8 = getBuilderLaunchPricing({
      mealCount: 8,
      regularPrice: "76.11",
    });
    ctx.assertTrue("sample 8 pricing exists", Boolean(sample8));
    ctx.assertEqual("sample 8 regular cents", sample8?.regularPriceCents, 7611);
    ctx.assertEqual("sample 8 launch cents", sample8?.launchPriceCents, 5611);
    ctx.assertEqual(
      "sample 8 per-meal cents",
      sample8?.launchPricePerMealCents,
      701,
    );
    ctx.assertEqual(
      "sample 8 launch formatted",
      formatCentsAsEuroFr(sample8!.launchPriceCents),
      "56,11\u00a0€",
    );
    ctx.assertEqual(
      "sample 8 per-meal formatted",
      formatCentsAsEuroFr(sample8!.launchPricePerMealCents),
      "7,01\u00a0€",
    );

    const sample10 = getBuilderLaunchPricing({
      mealCount: 10,
      regularPrice: "96.22",
    });
    ctx.assertEqual("sample 10 launch", sample10?.launchPriceCents, 7622);
    ctx.assertEqual(
      "sample 10 per meal",
      sample10?.launchPricePerMealCents,
      762,
    );

    const sample12 = getBuilderLaunchPricing({
      mealCount: 12,
      regularPrice: "125.22",
    });
    ctx.assertEqual("sample 12 launch", sample12?.launchPriceCents, 10522);
    ctx.assertEqual(
      "sample 12 per meal",
      sample12?.launchPricePerMealCents,
      877,
    );

    const sample24 = getBuilderLaunchPricing({
      mealCount: 24,
      regularPrice: "200.33",
    });
    ctx.assertEqual("sample 24 launch", sample24?.launchPriceCents, 18033);
    ctx.assertEqual(
      "sample 24 per meal",
      sample24?.launchPricePerMealCents,
      751,
    );

    const exact20 = getBuilderLaunchPricing({
      mealCount: 8,
      regularPrice: "20.00",
    });
    ctx.assertEqual("exact 20 → launch 0", exact20?.launchPriceCents, 0);
    ctx.assertEqual("exact 20 → per meal 0", exact20?.launchPricePerMealCents, 0);

    const under20 = getBuilderLaunchPricing({
      mealCount: 8,
      regularPrice: "15.50",
    });
    ctx.assertEqual("under 20 → launch 0", under20?.launchPriceCents, 0);

    ctx.assertNull(
      "invalid price → null",
      getBuilderLaunchPricing({ mealCount: 8, regularPrice: "abc" }),
    );
    ctx.assertNull(
      "mealCount 0 → null",
      getBuilderLaunchPricing({ mealCount: 0, regularPrice: "76.11" }),
    );
    ctx.assertNull(
      "mealCount negative → null",
      getBuilderLaunchPricing({ mealCount: -1, regularPrice: "76.11" }),
    );
    ctx.assertNull(
      "mealCount NaN → null",
      getBuilderLaunchPricing({ mealCount: Number.NaN, regularPrice: "76.11" }),
    );
    ctx.assertNull(
      "mealCount non-integer → null",
      getBuilderLaunchPricing({ mealCount: 8.5, regularPrice: "76.11" }),
    );
  }

  ctx.scenario("J. Copy Box / step id formule + loader");
  ctx.assertEqual(
    "internal steps include email then recap after repas",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas→email→recap",
  );
  ctx.assertTrue(
    "render copy Choisissez votre box",
    renderSource.includes("Choisissez votre box"),
  );
  ctx.assertTrue(
    "back from delivery is ← Box",
    renderSource.includes(">← Box<"),
  );
  ctx.assertFalse(
    "no ← Formule back label",
    renderSource.includes(">← Formule<"),
  );
  ctx.assertTrue(
    "step id formule preserved",
    renderSource.includes('id="step-formula"') &&
      clientSource.includes('"formule"'),
  );
  ctx.assertTrue(
    "loader uses fetchBuilderBoxOptions",
    loaderSource.includes("fetchBuilderBoxOptions"),
  );
  ctx.assertFalse(
    "loader no longer requires boxCollectionId for boxes",
    loaderSource.includes("boxCollectionId"),
  );
  ctx.assertTrue(
    "loader still uses mealCollectionId",
    loaderSource.includes("mealCollectionId"),
  );
  ctx.assertTrue(
    "delivery weekly windows present",
    clientSource.includes("selectedDeliveryWindowKey") &&
      clientSource.includes("deliveryWindowOptions") &&
      loaderSource.includes("buildBuilderDeliveryWindowOptions"),
  );
  ctx.assertTrue(
    "meals V2 path present",
    clientSource.includes("renderMeals") &&
      loaderSource.includes("fetchBuilderMealOptions"),
  );
  ctx.assertTrue(
    "18 variants not truncated by first:10 in handle query",
    BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY.includes("variants(first: 100)"),
  );

  ctx.scenario("K. Objective starting price — launch primary + recurring secondary");
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
      variantId: "gid://shopify/ProductVariant/9202",
      variantTitle: "24 balanced",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      mealCount: 24,
      price: "200.22",
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
    {
      productId: PRODUCT_ID,
      productTitle: "Box Mileyo V2",
      variantId: "gid://shopify/ProductVariant/9302",
      variantTitle: "16 bulk",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      mealCount: 16,
      price: "158.33",
      sellingPlanId: PLAN_ID,
    },
  ];

  ctx.assertEqual(
    "A. weight_loss minimum from BuilderBoxOption.price",
    getStartingPriceForObjective(
      pricedBoxes,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    "76.11",
  );
  ctx.assertEqual(
    "B. balanced minimum",
    getStartingPriceForObjective(pricedBoxes, SUBSCRIPTION_OBJECTIVE.BALANCED),
    "76.22",
  );
  ctx.assertEqual(
    "C. bulk minimum",
    getStartingPriceForObjective(pricedBoxes, SUBSCRIPTION_OBJECTIVE.BULK),
    "76.33",
  );
  ctx.assertEqual(
    "E. other objective does not affect weight_loss min",
    getStartingPriceForObjective(
      [
        ...pricedBoxes,
        {
          ...pricedBoxes[0],
          variantId: "gid://shopify/ProductVariant/9999",
          objective: SUBSCRIPTION_OBJECTIVE.BULK,
          price: "1.00",
        },
      ],
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    "76.11",
  );
  ctx.assertEqual(
    "F. invalid prices ignored",
    getStartingPriceForObjective(
      [
        {
          ...pricedBoxes[0],
          variantId: "gid://shopify/ProductVariant/9401",
          price: "not-a-price",
        },
        {
          ...pricedBoxes[0],
          variantId: "gid://shopify/ProductVariant/9402",
          price: "",
        },
        {
          ...pricedBoxes[0],
          variantId: "gid://shopify/ProductVariant/9403",
          price: "99.11",
        },
      ],
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
    "99.11",
  );
  ctx.assertNull(
    "G. no valid box → null",
    getStartingPriceForObjective([], SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
  );
  ctx.assertNull(
    "G. only invalid prices → null",
    getStartingPriceForObjective(
      [
        {
          ...pricedBoxes[0],
          price: "abc",
        },
      ],
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    ),
  );

  const weightLossFallback = formatObjectiveStartingPriceLabel("76.11");
  ctx.assertTrue(
    "H. fallback label contains À partir de",
    Boolean(weightLossFallback?.includes("À partir de")),
  );
  ctx.assertTrue(
    "H. fallback label contains / semaine",
    Boolean(weightLossFallback?.includes("/ semaine")),
  );
  ctx.assertEqual(
    "formatter 76.11 → 76,11 €",
    formatEuroAmountFr("76.11"),
    "76,11\u00a0€",
  );
  ctx.assertEqual(
    "formatter 76.00 → 76 €",
    formatEuroAmountFr("76.00"),
    "76\u00a0€",
  );
  ctx.assertEqual(
    "formatter 125.50 → 125,50 €",
    formatEuroAmountFr("125.50"),
    "125,50\u00a0€",
  );

  const labels = getObjectiveStartingPriceLabels(pricedBoxes);
  ctx.assertEqual(
    "D. weight_loss launch from shared helper",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.launchLine,
    "À partir de 56,11\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "D. weight_loss recurring from same box",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS]?.recurringLine,
    "Puis à partir de 76,11\u00a0€ / semaine",
  );
  ctx.assertEqual(
    "labels balanced launch",
    labels[SUBSCRIPTION_OBJECTIVE.BALANCED]?.launchLine,
    "À partir de 56,22\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "labels balanced recurring",
    labels[SUBSCRIPTION_OBJECTIVE.BALANCED]?.recurringLine,
    "Puis à partir de 76,22\u00a0€ / semaine",
  );
  ctx.assertEqual(
    "labels bulk launch",
    labels[SUBSCRIPTION_OBJECTIVE.BULK]?.launchLine,
    "À partir de 56,33\u00a0€ la première box*",
  );
  ctx.assertEqual(
    "labels bulk recurring",
    labels[SUBSCRIPTION_OBJECTIVE.BULK]?.recurringLine,
    "Puis à partir de 76,33\u00a0€ / semaine",
  );
  ctx.assertEqual(
    "empty boxes → no labels",
    Object.keys(getObjectiveStartingPriceLabels([])).length,
    0,
  );

  const selectionSource = readSource(
    "app/features/builder/builder-box-selection.ts",
  );
  const stylesSource = readSource("app/features/builder/builder-styles.ts");
  ctx.assertTrue(
    "render injects objectiveStartingPriceLabels",
    renderSource.includes("objectiveStartingPriceLabels"),
  );
  ctx.assertTrue(
    "client renders objective launch price",
    clientSource.includes("objective-card-launch-price"),
  );
  ctx.assertTrue(
    "client renders objective recurring price",
    clientSource.includes("objective-card-recurring-price"),
  );
  ctx.assertTrue(
    "styles include launch/recurring objective classes",
    stylesSource.includes("objective-card-launch-price") &&
      stylesSource.includes("objective-card-recurring-price"),
  );
  ctx.assertTrue(
    "objective eligibility note present",
    renderSource.includes("objective-launch-eligibility-note") &&
      renderSource.includes("nouveaux clients éligibles"),
  );
  ctx.assertFalse(
    "I. no hardcoded 76.11 in render",
    renderSource.includes("76.11"),
  );
  ctx.assertFalse(
    "I. no hardcoded 76.22 in render",
    renderSource.includes("76.22"),
  );
  ctx.assertFalse(
    "I. no hardcoded 76.33 in render",
    renderSource.includes("76.33"),
  );
  ctx.assertFalse(
    "I. no hardcoded DEV mins in client",
    clientSource.includes("76.11") ||
      clientSource.includes("76.22") ||
      clientSource.includes("76.33"),
  );
  ctx.assertFalse(
    "J. no FIRST_WEEK_DISCOUNT reintroduced",
    clientSource.includes("FIRST_WEEK_DISCOUNT_EUR") ||
      selectionSource.includes("FIRST_WEEK_DISCOUNT"),
  );
  ctx.assertEqual(
    "J. fallback regular label when launch unavailable",
    formatObjectiveStartingPriceLabel("76.11"),
    "À partir de 76,11\u00a0€ / semaine",
  );
  ctx.assertTrue(
    "J. launch helper lives in selection module",
    selectionSource.includes("export const getBuilderLaunchPricing"),
  );
  ctx.assertTrue(
    "J. objective labels use getBuilderLaunchPricing on same starting box",
    selectionSource.includes("getStartingBoxForObjective") &&
      /getObjectiveStartingPriceLabels[\s\S]*?getBuilderLaunchPricing/.test(
        selectionSource,
      ),
  );
  const startingPriceFn =
    selectionSource.match(
      /export const getStartingPriceForObjective = [\s\S]*?\n\};/,
    )?.[0] ?? "";
  ctx.assertTrue(
    "J. getStartingPriceForObjective body found",
    startingPriceFn.includes("box.price.trim()"),
  );
  ctx.assertFalse(
    "J. getStartingPriceForObjective itself does not subtract discount",
    /getBuilderLaunchPricing|FIRST_BOX_LAUNCH_DISCOUNT/.test(startingPriceFn),
  );
  ctx.assertTrue(
    "createBuilderCheckout posts JSON checkout intent",
    createCheckoutFn.includes("CREATE_CHECKOUT_INTENT") &&
      !createCheckoutFn.includes("/cart/add.js"),
  );
  ctx.assertFalse(
    "J. checkout does not send launchPrice",
    /launchPrice|launchPricePerMeal|discountCents|LAUNCH_DISCOUNT/.test(
      createCheckoutFn,
    ),
  );

  ctx.scenario("L. Formula card meal count — Duo display (UI only)");
  ctx.assertTrue(
    "formatBoxMealCountDisplay helper present",
    clientSource.includes("function formatBoxMealCountDisplay"),
  );
  ctx.assertTrue(
    "renderBoxes uses display helper",
    clientSource.includes(
      "mealCount.textContent = formatBoxMealCountDisplay(box.mealCount)",
    ),
  );
  ctx.assertFalse(
    "renderBoxes no raw mealCount + repas label",
    /mealCount\.textContent = box\.mealCount \+ " repas"/.test(clientSource),
  );
  ctx.assertFalse(
    "checkout still uses numeric mealCount",
    /mealCount: formatBoxMealCountDisplay/.test(createCheckoutFn),
  );

  const formatBoxMealCountDisplaySource =
    clientSource.match(
      /function formatBoxMealCountDisplay\(mealCount\) \{[\s\S]*?\n  \}/,
    )?.[0] ?? "";
  ctx.assertTrue(
    "formatBoxMealCountDisplay body found",
    formatBoxMealCountDisplaySource.length > 0,
  );
  const formatBoxMealCountDisplay = new Function(
    `${formatBoxMealCountDisplaySource}; return formatBoxMealCountDisplay;`,
  )() as (mealCount: number) => string;

  ctx.assertEqual("8 repas without Duo", formatBoxMealCountDisplay(8), "8 repas");
  ctx.assertEqual("10 repas without Duo", formatBoxMealCountDisplay(10), "10 repas");
  ctx.assertEqual("12 repas without Duo", formatBoxMealCountDisplay(12), "12 repas");
  ctx.assertEqual(
    "16 repas with Duo",
    formatBoxMealCountDisplay(16),
    "16 repas (Duo)",
  );
  ctx.assertEqual(
    "20 repas with Duo",
    formatBoxMealCountDisplay(20),
    "20 repas (Duo)",
  );
  ctx.assertEqual(
    "24 repas with Duo",
    formatBoxMealCountDisplay(24),
    "24 repas (Duo)",
  );

  return finishSuite("17-builder-v2-box-step", ctx);
};

process.exitCode = runSuite();
