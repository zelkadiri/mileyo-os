/**
 * Business regression — multi-variant box catalog parsing (13C-1) and trusted V2 (13C-2).
 */
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
  parseBoxCatalogMealCount,
  resolveWeeklySellingPlanIdFromVariantGroups,
  toBoxCatalogProductsV2,
  toTrustedBoxCatalogOptionsV2,
  toTrustedBoxCatalogVariantV2,
  type ShopifyBoxCatalogProductNodeV2,
  type ShopifyBoxCatalogSellingPlanGroupNodeV2,
} from "../../app/services/subscriptionBoxCatalog.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const MILEYO_WEEKLY_SELLING_PLAN_ID =
  "gid://shopify/SellingPlan/9001";

const buildMileyoWeeklySellingPlanGroups = (
  overrides?: ShopifyBoxCatalogSellingPlanGroupNodeV2[],
): { nodes: ShopifyBoxCatalogSellingPlanGroupNodeV2[] } => ({
  nodes:
    overrides ??
    [
      {
        id: "gid://shopify/SellingPlanGroup/8001",
        name: MILEYO_SELLING_PLAN_GROUP_NAME,
        sellingPlans: {
          nodes: [
            {
              id: MILEYO_WEEKLY_SELLING_PLAN_ID,
              name: MILEYO_SELLING_PLAN_NAME,
            },
          ],
        },
      },
    ],
});

const buildThreeObjectiveBoxFixture = (): ShopifyBoxCatalogProductNodeV2 => ({
  id: "gid://shopify/Product/5001",
  title: "Box Mileyo",
  featuredImage: {
    altText: "Box Mileyo",
    url: "https://cdn.shopify.com/box-mileyo.jpg",
  },
  mealCountMetafield: { value: "12" },
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/6001",
        title: "3 repas — Perte de poids",
        price: "59.90",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
        mealCountMetafield: { value: "3" },
      },
      {
        id: "gid://shopify/ProductVariant/6002",
        title: "3 repas — Équilibre",
        price: "62.90",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
        mealCountMetafield: { value: "3" },
      },
      {
        id: "gid://shopify/ProductVariant/6003",
        title: "3 repas — Prise de masse",
        price: "64.90",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
        mealCountMetafield: { value: "3" },
      },
    ],
  },
});

const runSuite = () => {
  const ctx = createBusinessTestContext("12-subscription-box-catalog");

  ctx.scenario("A. Objective — 3 variantes");
  const objectiveBoxes = toBoxCatalogProductsV2([buildThreeObjectiveBoxFixture()]);
  const box = objectiveBoxes[0];

  ctx.assertEqual("first objective is weight_loss", box.variants[0]?.objective, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS);
  ctx.assertEqual("second objective is balanced", box.variants[1]?.objective, SUBSCRIPTION_OBJECTIVE.BALANCED);
  ctx.assertEqual("third objective is bulk", box.variants[2]?.objective, SUBSCRIPTION_OBJECTIVE.BULK);

  ctx.scenario("B. Multi variants — aucune perte");
  const multiVariantBoxes = toBoxCatalogProductsV2([
    buildThreeObjectiveBoxFixture(),
    {
      id: "gid://shopify/Product/5002",
      title: "Box 12 repas",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/6101",
            title: "12 repas weight_loss",
            price: "99.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
            mealCountMetafield: { value: "12" },
          },
          {
            id: "gid://shopify/ProductVariant/6102",
            title: "12 repas balanced",
            price: "109.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
            mealCountMetafield: { value: "12" },
          },
          {
            id: "gid://shopify/ProductVariant/6103",
            title: "12 repas bulk",
            price: "119.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
            mealCountMetafield: { value: "12" },
          },
          {
            id: "gid://shopify/ProductVariant/6104",
            title: "12 repas sans objectif",
            price: "89.00",
          },
        ],
      },
    },
  ]);

  ctx.assertEqual("first product keeps 3 variants", multiVariantBoxes[0]?.variants.length, 3);
  ctx.assertEqual("second product keeps 4 variants", multiVariantBoxes[1]?.variants.length, 4);

  ctx.scenario("C. meal_count — variant puis fallback product");
  ctx.assertEqual(
    "variant meal_count used when present",
    parseBoxCatalogMealCount("8", "12"),
    8,
  );
  ctx.assertEqual(
    "product meal_count used when variant absent",
    parseBoxCatalogMealCount(undefined, "12"),
    12,
  );
  ctx.assertNull(
    "null when both absent",
    parseBoxCatalogMealCount(undefined, undefined),
  );
  ctx.assertNull("invalid mealCount zero", parseBoxCatalogMealCount("0", undefined));
  ctx.assertNull("invalid mealCount negative", parseBoxCatalogMealCount("-1", undefined));
  ctx.assertNull("invalid mealCount decimal", parseBoxCatalogMealCount("12.5", undefined));
  ctx.assertNull("invalid mealCount above max", parseBoxCatalogMealCount("101", undefined));
  ctx.assertNull("invalid mealCount text", parseBoxCatalogMealCount("abc", undefined));

  const fallbackBoxes = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5003",
      title: "Box legacy fallback",
      mealCountMetafield: { value: "12" },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/6201",
            title: "Legacy variant",
            price: "79.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
          },
        ],
      },
    },
  ]);

  ctx.assertEqual(
    "variant inherits product meal_count fallback",
    fallbackBoxes[0]?.variants[0]?.mealCount,
    12,
  );

  ctx.scenario("D. Price — conservé tel quel");
  ctx.assertEqual("weight_loss price preserved", box.variants[0]?.price, "59.90");
  ctx.assertEqual("balanced price preserved", box.variants[1]?.price, "62.90");
  ctx.assertEqual("bulk price preserved", box.variants[2]?.price, "64.90");

  const whitespacePriceBoxes = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5009",
      title: "Box whitespace price",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/6401",
            title: "Whitespace price",
            price: "   ",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
            mealCountMetafield: { value: "3" },
          },
        ],
      },
    },
  ]);

  ctx.assertNull(
    "whitespace price becomes null",
    whitespacePriceBoxes[0]?.variants[0]?.price ?? null,
  );

  ctx.scenario("E. Données incomplètes — aucun crash");
  const incompleteBoxes = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5004",
      title: "Box sans variant",
      variants: { nodes: [] },
    },
    {
      id: "gid://shopify/Product/5005",
      title: "Box incomplete variant",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/6301",
            title: "Sans metafields",
          },
        ],
      },
    },
    {
      id: "gid://shopify/Product/5006",
      title: "Box invalid objective",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/6302",
            title: "Invalid",
            objectiveMetafield: { value: "lose_weight" },
            price: "",
          },
        ],
      },
    },
  ]);

  ctx.assertEqual("zero variants returns empty array", incompleteBoxes[0]?.variants.length, 0);
  ctx.assertNull("missing objective is null", incompleteBoxes[1]?.variants[0]?.objective ?? null);
  ctx.assertNull("missing mealCount is null", incompleteBoxes[1]?.variants[0]?.mealCount ?? null);
  ctx.assertNull("missing price is null", incompleteBoxes[1]?.variants[0]?.price ?? null);
  ctx.assertNull("invalid objective becomes null", incompleteBoxes[2]?.variants[0]?.objective ?? null);
  ctx.assertNull("empty price becomes null", incompleteBoxes[2]?.variants[0]?.price ?? null);

  ctx.scenario("Product metadata preserved");
  ctx.assertEqual("product title preserved", box.title, "Box Mileyo");
  ctx.assertEqual("product imageUrl preserved", box.imageUrl, "https://cdn.shopify.com/box-mileyo.jpg");
  ctx.assertEqual("variant meal_count parsed", box.variants[0]?.mealCount, 3);

  const noImageBoxes = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5010",
      title: "Box sans image",
      featuredImage: null,
      variants: { nodes: [] },
    },
  ]);

  ctx.assertNull("missing imageUrl is null", noImageBoxes[0]?.imageUrl ?? null);

  ctx.scenario("F. Trusted V2 — variante complète");
  const completeVariant = toTrustedBoxCatalogVariantV2({
    variantId: "gid://shopify/ProductVariant/7001",
    variantTitle: "12 repas balanced",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    mealCount: 12,
    price: "99.00",
    sellingPlanId: MILEYO_WEEKLY_SELLING_PLAN_ID,
  });

  ctx.assertEqual("complete variant is trusted", completeVariant?.variantId, "gid://shopify/ProductVariant/7001");
  ctx.assertEqual("complete variant objective", completeVariant?.objective, SUBSCRIPTION_OBJECTIVE.BALANCED);
  ctx.assertEqual("complete variant mealCount", completeVariant?.mealCount, 12);
  ctx.assertEqual("complete variant price", completeVariant?.price, "99.00");
  ctx.assertEqual(
    "complete variant sellingPlanId",
    completeVariant?.sellingPlanId,
    MILEYO_WEEKLY_SELLING_PLAN_ID,
  );

  ctx.scenario("G. Trusted V2 — objective absent");
  ctx.assertNull(
    "variant without objective is excluded",
    toTrustedBoxCatalogVariantV2({
      variantId: "gid://shopify/ProductVariant/7002",
      variantTitle: "Sans objectif",
      objective: null,
      mealCount: 12,
      price: "99.00",
      sellingPlanId: null,
    }),
  );

  ctx.scenario("H. Trusted V2 — mealCount absent");
  ctx.assertNull(
    "variant without mealCount is excluded",
    toTrustedBoxCatalogVariantV2({
      variantId: "gid://shopify/ProductVariant/7003",
      variantTitle: "Sans meal count",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      mealCount: null,
      price: "99.00",
      sellingPlanId: null,
    }),
  );

  ctx.scenario("I. Trusted V2 — price absent");
  ctx.assertNull(
    "variant without price is excluded",
    toTrustedBoxCatalogVariantV2({
      variantId: "gid://shopify/ProductVariant/7004",
      variantTitle: "Sans prix",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      mealCount: 12,
      price: null,
      sellingPlanId: null,
    }),
  );

  ctx.scenario("L. Trusted V2 — variantId vide ou whitespace");
  ctx.assertNull(
    "variant with empty variantId is excluded",
    toTrustedBoxCatalogVariantV2({
      variantId: "",
      variantTitle: "Sans id",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      mealCount: 12,
      price: "99.00",
      sellingPlanId: null,
    }),
  );
  ctx.assertNull(
    "variant with whitespace variantId is excluded",
    toTrustedBoxCatalogVariantV2({
      variantId: "   ",
      variantTitle: "Id whitespace",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      mealCount: 12,
      price: "99.00",
      sellingPlanId: null,
    }),
  );

  const whitespaceVariantIdBoxes = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5011",
      title: "Box whitespace variant id",
      variants: {
        nodes: [
          {
            id: "   ",
            title: "Whitespace id",
            price: "59.90",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
            mealCountMetafield: { value: "3" },
          },
        ],
      },
    },
  ]);

  ctx.assertNull(
    "raw whitespace variantId excluded from trusted",
    toTrustedBoxCatalogVariantV2(whitespaceVariantIdBoxes[0]?.variants[0] ?? {
      variantId: "",
      variantTitle: "",
      objective: null,
      mealCount: null,
      price: null,
      sellingPlanId: null,
    }),
  );

  ctx.scenario("J. Trusted V2 — produit multi-variants mixtes");
  const mixedProduct = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5007",
      title: "Box mixte",
      featuredImage: {
        altText: "Box mixte",
        url: "https://cdn.shopify.com/box-mixte.jpg",
      },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/7101",
            title: "3 weight_loss",
            price: "59.90",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
            mealCountMetafield: { value: "3" },
          },
          {
            id: "gid://shopify/ProductVariant/7102",
            title: "3 balanced",
            price: "62.90",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
            mealCountMetafield: { value: "3" },
          },
          {
            id: "gid://shopify/ProductVariant/7103",
            title: "3 bulk",
            price: "64.90",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
            mealCountMetafield: { value: "3" },
          },
          {
            id: "gid://shopify/ProductVariant/7104",
            title: "Sans objectif",
            price: "50.00",
            mealCountMetafield: { value: "3" },
          },
          {
            id: "gid://shopify/ProductVariant/7105",
            title: "Sans prix",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
            mealCountMetafield: { value: "3" },
          },
        ],
      },
    },
  ]);

  ctx.assertEqual("raw catalog keeps all variants", mixedProduct[0]?.variants.length, 5);

  const mixedTrusted = toTrustedBoxCatalogOptionsV2(mixedProduct);
  ctx.assertEqual("trusted keeps only 3 valid variants", mixedTrusted.length, 3);
  ctx.assertEqual(
    "trusted preserves Shopify variant order",
    mixedTrusted[0]?.variantId,
    "gid://shopify/ProductVariant/7101",
  );
  ctx.assertEqual(
    "trusted second option keeps variant order",
    mixedTrusted[1]?.variantId,
    "gid://shopify/ProductVariant/7102",
  );
  ctx.assertEqual(
    "trusted third option keeps variant order",
    mixedTrusted[2]?.variantId,
    "gid://shopify/ProductVariant/7103",
  );
  ctx.assertEqual(
    "trusted option includes product metadata",
    mixedTrusted[0]?.productTitle,
    "Box mixte",
  );
  ctx.assertEqual(
    "trusted option includes imageUrl",
    mixedTrusted[0]?.imageUrl,
    "https://cdn.shopify.com/box-mixte.jpg",
  );

  ctx.scenario("K. Trusted V2 — produit sans variante valide");
  const noTrustedProduct = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5008",
      title: "Box invalide",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/7201",
            title: "Incomplete",
          },
        ],
      },
    },
  ]);

  ctx.assertEqual(
    "product with no valid variant returns empty trusted list",
    toTrustedBoxCatalogOptionsV2(noTrustedProduct).length,
    0,
  );

  ctx.scenario("M. Selling plan V2 — résolution par noms Mileyo");

  ctx.assertEqual(
    "A. Mileyo group + plan → sellingPlanId",
    resolveWeeklySellingPlanIdFromVariantGroups(
      buildMileyoWeeklySellingPlanGroups(),
    ),
    MILEYO_WEEKLY_SELLING_PLAN_ID,
  );

  ctx.assertNull(
    "B. missing sellingPlanGroups → null",
    resolveWeeklySellingPlanIdFromVariantGroups(undefined),
  );
  ctx.assertNull(
    "B. empty sellingPlanGroups nodes → null",
    resolveWeeklySellingPlanIdFromVariantGroups({ nodes: [] }),
  );

  ctx.assertNull(
    "C. other group name → null",
    resolveWeeklySellingPlanIdFromVariantGroups({
      nodes: [
        {
          id: "gid://shopify/SellingPlanGroup/8100",
          name: "Autre abonnement",
          sellingPlans: {
            nodes: [
              {
                id: "gid://shopify/SellingPlan/9100",
                name: MILEYO_SELLING_PLAN_NAME,
              },
            ],
          },
        },
      ],
    }),
  );

  ctx.assertNull(
    "D. Mileyo group without expected plan → null",
    resolveWeeklySellingPlanIdFromVariantGroups({
      nodes: [
        {
          id: "gid://shopify/SellingPlanGroup/8200",
          name: MILEYO_SELLING_PLAN_GROUP_NAME,
          sellingPlans: {
            nodes: [
              {
                id: "gid://shopify/SellingPlan/9200",
                name: "Mensuel",
              },
            ],
          },
        },
      ],
    }),
  );

  const mileyoNotFirstGroupId = "gid://shopify/SellingPlan/9301";
  ctx.assertEqual(
    "E. Mileyo group not first → still resolved",
    resolveWeeklySellingPlanIdFromVariantGroups({
      nodes: [
        {
          id: "gid://shopify/SellingPlanGroup/8300",
          name: "Autre groupe",
          sellingPlans: {
            nodes: [
              {
                id: "gid://shopify/SellingPlan/9300",
                name: "Autre plan",
              },
            ],
          },
        },
        {
          id: "gid://shopify/SellingPlanGroup/8301",
          name: MILEYO_SELLING_PLAN_GROUP_NAME,
          sellingPlans: {
            nodes: [
              {
                id: mileyoNotFirstGroupId,
                name: MILEYO_SELLING_PLAN_NAME,
              },
            ],
          },
        },
      ],
    }),
    mileyoNotFirstGroupId,
  );

  const mileyoNotFirstPlanId = "gid://shopify/SellingPlan/9402";
  ctx.assertEqual(
    "F. Mileyo plan not first in group → still resolved",
    resolveWeeklySellingPlanIdFromVariantGroups({
      nodes: [
        {
          id: "gid://shopify/SellingPlanGroup/8400",
          name: MILEYO_SELLING_PLAN_GROUP_NAME,
          sellingPlans: {
            nodes: [
              {
                id: "gid://shopify/SellingPlan/9401",
                name: "Essai gratuit",
              },
              {
                id: mileyoNotFirstPlanId,
                name: MILEYO_SELLING_PLAN_NAME,
              },
            ],
          },
        },
      ],
    }),
    mileyoNotFirstPlanId,
  );

  const sellingPlanProduct = toBoxCatalogProductsV2([
    {
      id: "gid://shopify/Product/5020",
      title: "Box selling plan",
      featuredImage: {
        altText: "Box selling plan",
        url: "https://cdn.shopify.com/box-selling-plan.jpg",
      },
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/8001",
            title: "12 balanced with plan",
            price: "99.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
            mealCountMetafield: { value: "12" },
            sellingPlanGroups: buildMileyoWeeklySellingPlanGroups(),
          },
          {
            id: "gid://shopify/ProductVariant/8002",
            title: "12 weight_loss without plan",
            price: "89.00",
            objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
            mealCountMetafield: { value: "12" },
          },
        ],
      },
    },
  ]);

  ctx.assertEqual(
    "raw variant with Mileyo plan keeps sellingPlanId",
    sellingPlanProduct[0]?.variants[0]?.sellingPlanId,
    MILEYO_WEEKLY_SELLING_PLAN_ID,
  );
  ctx.assertNull(
    "raw variant without groups has null sellingPlanId",
    sellingPlanProduct[0]?.variants[1]?.sellingPlanId ?? null,
  );

  const sellingPlanTrusted = toTrustedBoxCatalogOptionsV2(sellingPlanProduct);
  ctx.assertEqual("G+H. trusted keeps both complete variants", sellingPlanTrusted.length, 2);
  ctx.assertEqual(
    "G. sellingPlanId propagated to TrustedBoxCatalogOptionV2",
    sellingPlanTrusted[0]?.sellingPlanId,
    MILEYO_WEEKLY_SELLING_PLAN_ID,
  );
  ctx.assertEqual(
    "H. trusted option without selling plan stays trusted",
    sellingPlanTrusted[1]?.variantId,
    "gid://shopify/ProductVariant/8002",
  );
  ctx.assertNull(
    "H. trusted option without plan has null sellingPlanId",
    sellingPlanTrusted[1]?.sellingPlanId ?? null,
  );

  ctx.assertNull(
    "incomplete catalog still exposes null sellingPlanId",
    incompleteBoxes[1]?.variants[0]?.sellingPlanId ?? null,
  );

  return finishSuite("12-subscription-box-catalog", ctx);
};

process.exitCode = runSuite();
