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
  formatEuroAmountFr,
  formatObjectiveStartingPriceLabel,
  getObjectiveStartingPriceLabels,
  getStartingPriceForObjective,
  isBuilderBoxCtaEnabled,
  shouldResetBoxOnObjectiveChange,
} from "../../app/features/builder/builder-box-selection";
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

  ctx.scenario("H. One-time removed + cart always subscription");
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
    "cart always sets selling_plan",
    clientSource.includes("selling_plan: sellingPlanId"),
  );
  ctx.assertTrue(
    "Type de commande always Abonnement hebdomadaire",
    clientSource.includes(
      '"Type de commande": "Abonnement hebdomadaire"',
    ),
  );
  ctx.assertTrue(
    "Nombre de repas from selectedBox.mealCount",
    clientSource.includes(
      '"Nombre de repas": String(selectedBox.mealCount)',
    ),
  );

  ctx.scenario("I. Price + promo");
  ctx.assertTrue(
    "client prices from box.price",
    clientSource.includes("box.price"),
  );
  ctx.assertFalse(
    "no FIRST_WEEK_DISCOUNT_EUR",
    clientSource.includes("FIRST_WEEK_DISCOUNT_EUR"),
  );
  ctx.assertFalse(
    "no subscriptionPrice pricing",
    clientSource.includes("subscriptionPrice"),
  );
  ctx.assertFalse(
    "no tunnel promo banner",
    renderSource.includes("tunnel-promo") ||
      renderSource.includes("20 € offerts"),
  );
  ctx.assertFalse(
    "no FAQ remise 20 €",
    renderSource.includes("remise de 20"),
  );
  ctx.assertFalse(
    "no première semaine promo copy",
    renderSource.includes("1ʳᵉ box") ||
      clientSource.includes("la 1ère semaine"),
  );

  ctx.scenario("J. Copy Box / step id formule + loader");
  ctx.assertEqual(
    "internal steps unchanged",
    BUILDER_STEPS.join("→"),
    "objectif→formule→livraison→repas",
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
    "delivery legacy still present",
    clientSource.includes("selectedDeliveryDate") &&
      loaderSource.includes("deliveryConfig"),
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

  ctx.scenario("K. Objective starting price — À partir de X €/semaine");
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

  const weightLossLabel = formatObjectiveStartingPriceLabel("76.11");
  ctx.assertTrue(
    "H. label contains À partir de",
    Boolean(weightLossLabel?.includes("À partir de")),
  );
  ctx.assertTrue(
    "H. label contains /semaine",
    Boolean(weightLossLabel?.includes("/semaine")),
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
    "D. labels derived from BuilderBoxOption.price mins",
    labels[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS],
    formatObjectiveStartingPriceLabel("76.11"),
  );
  ctx.assertEqual(
    "labels balanced",
    labels[SUBSCRIPTION_OBJECTIVE.BALANCED],
    formatObjectiveStartingPriceLabel("76.22"),
  );
  ctx.assertEqual(
    "labels bulk",
    labels[SUBSCRIPTION_OBJECTIVE.BULK],
    formatObjectiveStartingPriceLabel("76.33"),
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
    "client renders objective-card-starting-price",
    clientSource.includes("objective-card-starting-price"),
  );
  ctx.assertTrue(
    "styles include starting-price class",
    stylesSource.includes("objective-card-starting-price"),
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
  ctx.assertFalse(
    "J. no -20 promo in starting-price path",
    selectionSource.includes("20 €") ||
      selectionSource.includes("première semaine"),
  );

  return finishSuite("17-builder-v2-box-step", ctx);
};

process.exitCode = runSuite();
