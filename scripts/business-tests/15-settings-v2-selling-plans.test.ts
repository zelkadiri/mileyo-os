/**
 * Business regression — Box V2 weekly selling-plan provisioning (13E-A2b).
 *
 * Pure helpers + mocked Admin GraphQL only. No live Shopify mutations.
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
import { createOrUpdateWeeklySellingPlans } from "../../app/features/settings/settings-selling-plans.server";
import {
  BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY,
  BOX_V2_SELLING_PLAN_PRODUCTS_QUERY,
  SETUP_V2_WEEKLY_SELLING_PLANS_INTENT,
  SELLING_PLAN_GROUP_ADD_PRODUCT_VARIANTS_MUTATION,
  SELLING_PLAN_GROUP_CREATE_V2_MUTATION,
  V2_BOX_VARIANTS_PAGE_SIZE,
  V2_SELLING_PLAN_BLOCK_REASON,
  V2_SELLING_PLAN_SKIP_REASON,
  evaluateV2ProductEligibility,
  formatV2SellingPlanSetupMessage,
  getV2WeeklySellingPlanGroupInput,
  resolveV2BoxProductsByHandle,
  resolveV2SellingPlanDecision,
  setupV2WeeklySellingPlans,
  summarizeV2SellingPlanResults,
  type V2SellingPlanGroupDetails,
  type V2SellingPlanGroupSummary,
  type V2SellingPlanNode,
  type V2SellingPlanProductNode,
  type V2SellingPlanVariantNode,
} from "../../app/features/settings/settings-selling-plans-v2.server";
import {
  MILEYO_SELLING_PLAN_GROUP_NAME as CATALOG_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME as CATALOG_PLAN_NAME,
} from "../../app/services/subscriptionBoxCatalog.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const PRODUCT_ID = "gid://shopify/Product/5001";
const GROUP_ID = "gid://shopify/SellingPlanGroup/8001";
const PLAN_ID = "gid://shopify/SellingPlan/9001";

const VARIANT_IDS = {
  balanced12: "gid://shopify/ProductVariant/612",
  balanced8: "gid://shopify/ProductVariant/608",
  bulk12: "gid://shopify/ProductVariant/712",
  bulk8: "gid://shopify/ProductVariant/708",
  weightLoss12: "gid://shopify/ProductVariant/512",
  weightLoss8: "gid://shopify/ProductVariant/508",
};

const jsonResponse = (body: unknown) =>
  ({ json: async () => body }) as unknown as Response;

type GraphqlCall = {
  query: string;
  variables?: Record<string, unknown>;
};

const createMockAdmin = ({
  addUserErrors = [],
  createUserErrors = [],
  groupDetailsById = {},
  products = [],
  queryErrors,
}: {
  addUserErrors?: { message: string }[];
  createUserErrors?: { message: string }[];
  groupDetailsById?: Record<string, V2SellingPlanGroupDetails | null>;
  products?: V2SellingPlanProductNode[];
  queryErrors?: { message: string }[];
} = {}) => {
  const calls: GraphqlCall[] = [];

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("BoxV2SellingPlanProductsByHandle")) {
          return jsonResponse({
            data: {
              products: { nodes: products },
            },
            errors: queryErrors,
          });
        }

        if (query.includes("BoxV2SellingPlanGroupDetails")) {
          const groupId = String(options?.variables?.groupId ?? "");
          const details =
            groupId in groupDetailsById ? groupDetailsById[groupId] : null;
          return jsonResponse({
            data: {
              sellingPlanGroup: details,
            },
          });
        }

        if (query.includes("sellingPlanGroupCreate")) {
          return jsonResponse({
            data: {
              sellingPlanGroupCreate: { userErrors: createUserErrors },
            },
          });
        }

        if (query.includes("sellingPlanGroupAddProductVariants")) {
          return jsonResponse({
            data: {
              sellingPlanGroupAddProductVariants: {
                userErrors: addUserErrors,
              },
            },
          });
        }

        throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 120)}`);
      },
    },
    calls,
  };
};

const groupSummary = (
  id: string = GROUP_ID,
): V2SellingPlanGroupSummary => ({
  id,
  name: MILEYO_SELLING_PLAN_GROUP_NAME,
});

const ALL_V2_VARIANT_SPECS = [
  {
    id: VARIANT_IDS.weightLoss8,
    mealCount: "8",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  },
  {
    id: VARIANT_IDS.balanced8,
    mealCount: "8",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
  },
  {
    id: VARIANT_IDS.bulk8,
    mealCount: "8",
    objective: SUBSCRIPTION_OBJECTIVE.BULK,
  },
  {
    id: VARIANT_IDS.weightLoss12,
    mealCount: "12",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  },
  {
    id: VARIANT_IDS.balanced12,
    mealCount: "12",
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
  },
  {
    id: VARIANT_IDS.bulk12,
    mealCount: "12",
    objective: SUBSCRIPTION_OBJECTIVE.BULK,
  },
] as const;

const ALL_V2_VARIANT_IDS = ALL_V2_VARIANT_SPECS.map((spec) => spec.id);

const compatiblePlan = (
  overrides?: Partial<V2SellingPlanNode>,
): V2SellingPlanNode => ({
  id: PLAN_ID,
  name: MILEYO_SELLING_PLAN_NAME,
  pricingPolicies: [],
  ...overrides,
});

const compatibleGroupDetails = ({
  attachedVariantIds = ALL_V2_VARIANT_IDS,
  id = GROUP_ID,
  sellingPlans = [compatiblePlan()],
}: {
  attachedVariantIds?: string[];
  id?: string;
  sellingPlans?: V2SellingPlanNode[];
} = {}): V2SellingPlanGroupDetails => ({
  id,
  name: MILEYO_SELLING_PLAN_GROUP_NAME,
  productVariants: {
    nodes: attachedVariantIds.map((variantId) => ({ id: variantId })),
  },
  sellingPlans: { nodes: sellingPlans },
});

const buildVariant = ({
  id,
  mealCount,
  objective,
  price = "79.90",
}: {
  id: string;
  mealCount: string | null;
  objective: string | null;
  price?: string | null;
}): V2SellingPlanVariantNode => ({
  id,
  mealCountMetafield: mealCount == null ? null : { value: mealCount },
  objectiveMetafield: objective == null ? null : { value: objective },
  price,
  title: `${mealCount ?? "?"} — ${objective ?? "none"}`,
});

const buildEligibleProduct = ({
  productGroups = [],
}: {
  productGroups?: V2SellingPlanGroupSummary[];
} = {}): V2SellingPlanProductNode => ({
  id: PRODUCT_ID,
  handle: BOX_V2_PRODUCT_HANDLE,
  sellingPlanGroups: { nodes: productGroups },
  title: "Box Mileyo V2",
  variants: {
    nodes: ALL_V2_VARIANT_SPECS.map((spec) =>
      buildVariant({
        id: spec.id,
        mealCount: spec.mealCount,
        objective: spec.objective,
      }),
    ),
  },
});

const alreadyConfiguredFixture = () => ({
  groupDetailsById: {
    [GROUP_ID]: compatibleGroupDetails(),
  },
  product: buildEligibleProduct({
    productGroups: [groupSummary()],
  }),
});

const detailQueryCalls = (calls: GraphqlCall[]) =>
  calls.filter((call) => call.query.includes("BoxV2SellingPlanGroupDetails"));

const mutationCalls = (calls: GraphqlCall[]) =>
  calls.filter(
    (call) =>
      call.query.includes("sellingPlanGroupCreate") ||
      call.query.includes("sellingPlanGroupAddProductVariants"),
  );

const skipReason = (product: V2SellingPlanProductNode) => {
  const result = evaluateV2ProductEligibility(product);
  return result.eligible ? "eligible" : result.reason;
};

const blockedReason = (
  product: V2SellingPlanProductNode,
  groupDetails: V2SellingPlanGroupDetails | null = null,
) => {
  const decision = resolveV2SellingPlanDecision(product, groupDetails);
  return decision.action === "blocked" ? decision.reason : decision.action;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("15-settings-v2-selling-plans");
  const v2Source = readRepoFile(
    "app/features/settings/settings-selling-plans-v2.server.ts",
  );
  const legacySource = readRepoFile(
    "app/features/settings/settings-selling-plans.server.ts",
  );
  const actionsSource = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const uiSource = readRepoFile("app/features/settings/settings-render.tsx");

  ctx.scenario("A. Shared selling-plan constants");
  ctx.assertEqual(
    "group name",
    MILEYO_SELLING_PLAN_GROUP_NAME,
    "Mileyo abonnement hebdomadaire",
  );
  ctx.assertEqual(
    "plan name",
    MILEYO_SELLING_PLAN_NAME,
    "Abonnement hebdomadaire",
  );
  ctx.assertEqual(
    "catalog re-exports the same group name",
    CATALOG_GROUP_NAME,
    MILEYO_SELLING_PLAN_GROUP_NAME,
  );
  ctx.assertEqual(
    "catalog re-exports the same plan name",
    CATALOG_PLAN_NAME,
    MILEYO_SELLING_PLAN_NAME,
  );
  ctx.assertTrue(
    "legacy provisioning imports shared constants",
    legacySource.includes('from "../../constants/subscriptionSellingPlan"'),
  );
  ctx.assertFalse(
    "legacy no longer duplicates group name literal",
    legacySource.includes(
      'const weeklySellingPlanGroupName = "Mileyo abonnement hebdomadaire"',
    ),
  );

  ctx.scenario("B. Eligibility — all variants valid");
  const eligible = evaluateV2ProductEligibility(buildEligibleProduct());
  ctx.assertTrue("eligible when every variant is complete", eligible.eligible);
  if (eligible.eligible) {
    ctx.assertEqual("keeps every variant", eligible.variants.length, 6);
  }

  ctx.scenario("C. Eligibility — missing variant objective");
  const missingObjective = buildEligibleProduct();
  missingObjective.variants.nodes[0] = buildVariant({
    id: VARIANT_IDS.weightLoss8,
    mealCount: "8",
    objective: null,
  });
  ctx.assertEqual(
    "skip missing variant objective",
    skipReason(missingObjective),
    V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_OBJECTIVE,
  );
  ctx.assertEqual(
    "missing objective decision is skip",
    resolveV2SellingPlanDecision(missingObjective).action,
    "skip",
  );

  ctx.scenario("D. Eligibility — invalid variant objective");
  const invalidObjective = buildEligibleProduct();
  invalidObjective.variants.nodes[0] = buildVariant({
    id: VARIANT_IDS.weightLoss8,
    mealCount: "8",
    objective: "keto",
  });
  ctx.assertEqual(
    "skip invalid variant objective",
    skipReason(invalidObjective),
    V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_OBJECTIVE,
  );

  ctx.scenario("E. Eligibility — PRODUCT meal_count fallback is NOT used");
  const productMealCountOnly = {
    id: PRODUCT_ID,
    mealCountMetafield: { value: "12" },
    title: "Box legacy meal_count PRODUCT",
    variants: {
      nodes: [
        buildVariant({
          id: VARIANT_IDS.weightLoss8,
          mealCount: null,
          objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
        }),
      ],
    },
  } as V2SellingPlanProductNode;
  ctx.assertEqual(
    "skip missing variant meal_count despite PRODUCT value",
    skipReason(productMealCountOnly),
    V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_MEAL_COUNT,
  );
  ctx.assertFalse(
    "eligibility helper does not use catalog PRODUCT fallback",
    v2Source.includes("parseBoxCatalogMealCount"),
  );

  ctx.scenario("F. Eligibility — invalid variant meal_count");
  const invalidMealCount = buildEligibleProduct();
  invalidMealCount.variants.nodes[0] = buildVariant({
    id: VARIANT_IDS.weightLoss8,
    mealCount: "0",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  });
  ctx.assertEqual(
    "skip invalid variant meal_count",
    skipReason(invalidMealCount),
    V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_MEAL_COUNT,
  );

  ctx.scenario("G. Eligibility — duplicate objective/mealCount");
  const duplicatePair = buildEligibleProduct();
  duplicatePair.variants.nodes[1] = buildVariant({
    id: VARIANT_IDS.balanced8,
    mealCount: "8",
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  });
  ctx.assertEqual(
    "skip duplicate objective/mealCount combination",
    skipReason(duplicatePair),
    V2_SELLING_PLAN_SKIP_REASON.DUPLICATE_OBJECTIVE_MEAL_COUNT,
  );

  ctx.scenario("H. Eligibility — no variants");
  ctx.assertEqual(
    "skip product without variants",
    skipReason({
      id: PRODUCT_ID,
      title: "Empty box",
      variants: { nodes: [] },
    }),
    V2_SELLING_PLAN_SKIP_REASON.NO_VARIANTS,
  );

  ctx.scenario("I. V2 selling-plan input");
  const input = getV2WeeklySellingPlanGroupInput();
  const plan = input.sellingPlansToCreate[0];
  ctx.assertEqual("group name", input.name, MILEYO_SELLING_PLAN_GROUP_NAME);
  ctx.assertEqual(
    "merchantCode matches group name",
    input.merchantCode,
    MILEYO_SELLING_PLAN_GROUP_NAME,
  );
  ctx.assertEqual("plan name", plan.name, MILEYO_SELLING_PLAN_NAME);
  ctx.assertEqual(
    "billing interval WEEK",
    plan.billingPolicy.recurring.interval,
    "WEEK",
  );
  ctx.assertEqual(
    "billing intervalCount 1",
    plan.billingPolicy.recurring.intervalCount,
    1,
  );
  ctx.assertEqual(
    "delivery interval WEEK",
    plan.deliveryPolicy.recurring.interval,
    "WEEK",
  );
  ctx.assertEqual(
    "delivery intervalCount 1",
    plan.deliveryPolicy.recurring.intervalCount,
    1,
  );
  ctx.assertFalse(
    "pricingPolicies omitted from plan input",
    Object.prototype.hasOwnProperty.call(plan, "pricingPolicies"),
  );
  ctx.assertFalse(
    "pricingPolicies omitted from serialized input",
    JSON.stringify(input).includes("pricingPolicies"),
  );
  ctx.assertFalse(
    "no custom.prix_abonnement in input",
    JSON.stringify(input).includes("prix_abonnement"),
  );
  ctx.assertFalse(
    "no FIXED_AMOUNT in input",
    JSON.stringify(input).includes("FIXED_AMOUNT"),
  );
  ctx.assertEqual("subscription category", plan.category, "SUBSCRIPTION");

  ctx.scenario("J. Create when no Mileyo group exists");
  const createDecision = resolveV2SellingPlanDecision(buildEligibleProduct());
  ctx.assertEqual("decision is create", createDecision.action, "create");
  if (createDecision.action === "create") {
    ctx.assertEqual(
      "create uses the product id",
      createDecision.productId,
      PRODUCT_ID,
    );
    ctx.assertEqual(
      "create includes every V2 variant",
      createDecision.variantIds.length,
      ALL_V2_VARIANT_IDS.length,
    );
    ctx.assertTrue(
      "create is not limited to the first variant",
      createDecision.variantIds.includes(VARIANT_IDS.bulk12) &&
        createDecision.variantIds.length > 1,
    );
  }

  const createMock = createMockAdmin({ products: [buildEligibleProduct()] });
  const createResult = await setupV2WeeklySellingPlans(createMock.admin);
  const createCall = createMock.calls.find((call) =>
    call.query.includes("sellingPlanGroupCreate"),
  );
  const createResources = createCall?.variables?.resources as
    | { productIds?: string[]; productVariantIds?: string[] }
    | undefined;
  const createdVariantIds = createResources?.productVariantIds ?? [];
  ctx.assertEqual("create status", createResult.products[0]?.status, "created");
  ctx.assertEqual(
    "create productIds is the exact product",
    JSON.stringify(createResources?.productIds),
    JSON.stringify([PRODUCT_ID]),
  );
  ctx.assertEqual(
    "create productVariantIds includes all variants",
    createdVariantIds.length,
    ALL_V2_VARIANT_IDS.length,
  );
  ctx.assertTrue(
    "create productVariantIds is not only the first variant",
    createdVariantIds.includes(VARIANT_IDS.weightLoss8) &&
      createdVariantIds.includes(VARIANT_IDS.bulk12),
  );
  ctx.assertEqual(
    "create path does not fetch group details",
    detailQueryCalls(createMock.calls).length,
    0,
  );

  ctx.scenario("K. Existing compatible group+plan — NO-OP");
  const configuredFixture = alreadyConfiguredFixture();
  ctx.assertEqual(
    "already configured decision",
    resolveV2SellingPlanDecision(
      configuredFixture.product,
      configuredFixture.groupDetailsById[GROUP_ID] ?? null,
    ).action,
    "alreadyConfigured",
  );
  const noopMock = createMockAdmin({
    groupDetailsById: configuredFixture.groupDetailsById,
    products: [configuredFixture.product],
  });
  const noopResult = await setupV2WeeklySellingPlans(noopMock.admin);
  ctx.assertEqual(
    "alreadyConfigured status",
    noopResult.products[0]?.status,
    "alreadyConfigured",
  );
  ctx.assertEqual(
    "already configured performs no mutation",
    mutationCalls(noopMock.calls).length,
    0,
  );
  ctx.assertEqual(
    "already configured fetches group details once",
    detailQueryCalls(noopMock.calls).length,
    1,
  );

  ctx.scenario("L. Add missing variants only");
  const attachedIds = [
    VARIANT_IDS.weightLoss8,
    VARIANT_IDS.balanced8,
    VARIANT_IDS.bulk8,
  ];
  const partialProduct = buildEligibleProduct({
    productGroups: [groupSummary()],
  });
  const partialDetails = compatibleGroupDetails({
    attachedVariantIds: attachedIds,
  });
  const addDecision = resolveV2SellingPlanDecision(
    partialProduct,
    partialDetails,
  );
  ctx.assertEqual("decision is add missing variants", addDecision.action, "addMissingVariants");
  if (addDecision.action === "addMissingVariants") {
    ctx.assertEqual("adds only the 12-meal variants", addDecision.missingVariantIds.length, 3);
    ctx.assertTrue(
      "does not re-add already attached variants",
      !addDecision.missingVariantIds.includes(VARIANT_IDS.weightLoss8),
    );
    ctx.assertTrue(
      "includes a missing 12-meal variant",
      addDecision.missingVariantIds.includes(VARIANT_IDS.weightLoss12),
    );
  }

  const addMock = createMockAdmin({
    groupDetailsById: { [GROUP_ID]: partialDetails },
    products: [partialProduct],
  });
  const addResult = await setupV2WeeklySellingPlans(addMock.admin);
  const addCall = addMock.calls.find((call) =>
    call.query.includes("sellingPlanGroupAddProductVariants"),
  );
  ctx.assertEqual("variantsAdded status", addResult.products[0]?.status, "variantsAdded");
  ctx.assertEqual(
    "add mutation uses the existing group id",
    addCall?.variables?.id,
    GROUP_ID,
  );
  ctx.assertEqual(
    "add mutation sends only missing variant ids",
    (addCall?.variables?.productVariantIds as string[] | undefined)?.length,
    3,
  );
  ctx.assertEqual("create is not used when group exists", addMock.calls.filter((call) => call.query.includes("sellingPlanGroupCreate")).length, 0);
  ctx.assertEqual(
    "add missing fetches group details once",
    detailQueryCalls(addMock.calls).length,
    1,
  );

  ctx.scenario("M. Multiple exact groups — BLOCKED");
  const multipleGroups = buildEligibleProduct({
    productGroups: [
      groupSummary(),
      groupSummary("gid://shopify/SellingPlanGroup/8002"),
    ],
  });
  ctx.assertEqual(
    "multiple groups blocked",
    resolveV2SellingPlanDecision(multipleGroups).action,
    "blocked",
  );
  ctx.assertEqual(
    "multiple groups reason",
    blockedReason(multipleGroups),
    V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
  );
  const multipleGroupsMock = createMockAdmin({ products: [multipleGroups] });
  const multipleGroupsResult = await setupV2WeeklySellingPlans(multipleGroupsMock.admin);
  ctx.assertEqual(
    "multiple groups status",
    multipleGroupsResult.products[0]?.status,
    "blocked",
  );
  ctx.assertEqual(
    "multiple groups performs no mutation",
    mutationCalls(multipleGroupsMock.calls).length,
    0,
  );
  ctx.assertEqual(
    "multiple groups does not fetch group details",
    detailQueryCalls(multipleGroupsMock.calls).length,
    0,
  );

  ctx.scenario("N. Multiple exact plans — BLOCKED");
  const multiplePlansProduct = buildEligibleProduct({
    productGroups: [groupSummary()],
  });
  const multiplePlansDetails = compatibleGroupDetails({
    sellingPlans: [
      compatiblePlan(),
      compatiblePlan({ id: "gid://shopify/SellingPlan/9002" }),
    ],
  });
  ctx.assertEqual(
    "multiple plans blocked",
    resolveV2SellingPlanDecision(multiplePlansProduct, multiplePlansDetails)
      .action,
    "blocked",
  );
  ctx.assertEqual(
    "multiple plans reason",
    blockedReason(multiplePlansProduct, multiplePlansDetails),
    V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_PLANS,
  );
  const multiplePlansMock = createMockAdmin({
    groupDetailsById: { [GROUP_ID]: multiplePlansDetails },
    products: [multiplePlansProduct],
  });
  await setupV2WeeklySellingPlans(multiplePlansMock.admin);
  ctx.assertEqual(
    "multiple plans performs no mutation",
    mutationCalls(multiplePlansMock.calls).length,
    0,
  );

  ctx.scenario("O. Plan with pricingPolicies — BLOCKED, no mutation");
  const pricedProduct = buildEligibleProduct({
    productGroups: [groupSummary()],
  });
  const pricedDetails = compatibleGroupDetails({
    sellingPlans: [
      compatiblePlan({
        pricingPolicies: [{ __typename: "SellingPlanFixedPricingPolicy" }],
      }),
    ],
  });
  const pricedDecision = resolveV2SellingPlanDecision(
    pricedProduct,
    pricedDetails,
  );
  ctx.assertEqual("legacy pricing blocked", pricedDecision.action, "blocked");
  ctx.assertEqual(
    "legacy pricing reason",
    pricedDecision.action === "blocked" ? pricedDecision.reason : "",
    V2_SELLING_PLAN_BLOCK_REASON.LEGACY_PRICING,
  );
  const pricedMock = createMockAdmin({
    groupDetailsById: { [GROUP_ID]: pricedDetails },
    products: [pricedProduct],
  });
  const pricedResult = await setupV2WeeklySellingPlans(pricedMock.admin);
  ctx.assertEqual("legacy pricing status", pricedResult.products[0]?.status, "blocked");
  ctx.assertEqual(
    "legacy pricing performs no mutation and does not attach variants",
    mutationCalls(pricedMock.calls).length,
    0,
  );

  ctx.scenario("P. Group without exact plan — BLOCKED");
  const groupWithoutPlanProduct = buildEligibleProduct({
    productGroups: [groupSummary()],
  });
  const groupWithoutPlanDetails = compatibleGroupDetails({
    sellingPlans: [
      {
        id: "gid://shopify/SellingPlan/other",
        name: "Autre plan",
        pricingPolicies: [],
      },
    ],
  });
  ctx.assertEqual(
    "group without exact plan blocked",
    resolveV2SellingPlanDecision(
      groupWithoutPlanProduct,
      groupWithoutPlanDetails,
    ).action,
    "blocked",
  );
  ctx.assertEqual(
    "group without exact plan reason",
    blockedReason(groupWithoutPlanProduct, groupWithoutPlanDetails),
    V2_SELLING_PLAN_BLOCK_REASON.GROUP_WITHOUT_PLAN,
  );
  const missingPlanMock = createMockAdmin({
    groupDetailsById: { [GROUP_ID]: groupWithoutPlanDetails },
    products: [groupWithoutPlanProduct],
  });
  await setupV2WeeklySellingPlans(missingPlanMock.admin);
  ctx.assertEqual(
    "group without plan performs no mutation",
    mutationCalls(missingPlanMock.calls).length,
    0,
  );

  ctx.scenario("Q. Legacy collection products are never provisioned by A2b");
  const legacyProduct: V2SellingPlanProductNode = {
    id: "gid://shopify/Product/legacy",
    handle: "box-8-repas",
    title: "Box 8 repas legacy",
    variants: {
      nodes: [
        buildVariant({
          id: "gid://shopify/ProductVariant/legacy-1",
          mealCount: null,
          objective: null,
          price: "69.90",
        }),
      ],
    },
  };
  ctx.assertEqual(
    "legacy without variant objective is skipped by eligibility",
    resolveV2SellingPlanDecision(legacyProduct).action,
    "skip",
  );
  const onlyV2Mock = createMockAdmin({
    products: [buildEligibleProduct()],
  });
  const onlyV2Result = await setupV2WeeklySellingPlans(onlyV2Mock.admin);
  ctx.assertEqual("only V2 product is created", onlyV2Result.createdCount, 1);
  ctx.assertEqual("no skipped legacy product in V2 path", onlyV2Result.skippedCount, 0);
  ctx.assertEqual(
    "create resources productIds is only Box V2",
    JSON.stringify(
      (
        mutationCalls(onlyV2Mock.calls)[0]?.variables?.resources as {
          productIds: string[];
        }
      ).productIds,
    ),
    JSON.stringify([PRODUCT_ID]),
  );
  ctx.assertFalse(
    "create resources never include a legacy product id",
    JSON.stringify(mutationCalls(onlyV2Mock.calls)[0]?.variables ?? {}).includes(
      "legacy",
    ),
  );
  const legacyOnlyMock = createMockAdmin({ products: [legacyProduct] });
  const legacyOnlyResult = await setupV2WeeklySellingPlans(legacyOnlyMock.admin);
  ctx.assertEqual(
    "legacy handle alone is skipped as mismatch",
    legacyOnlyResult.products[0]?.status,
    "skipped",
  );
  ctx.assertEqual(
    "legacy handle alone reason",
    legacyOnlyResult.products[0]?.reason,
    V2_SELLING_PLAN_SKIP_REASON.HANDLE_MISMATCH,
  );
  ctx.assertEqual(
    "legacy handle alone performs no mutation",
    mutationCalls(legacyOnlyMock.calls).length,
    0,
  );

  ctx.scenario("R. Legacy provisioning intact");
  ctx.assertEqual(
    "createOrUpdateWeeklySellingPlans is still exported",
    typeof createOrUpdateWeeklySellingPlans,
    "function",
  );
  ctx.assertTrue(
    "legacy still uses FIXED_AMOUNT",
    legacySource.includes("FIXED_AMOUNT"),
  );
  ctx.assertTrue(
    "legacy still reads custom.prix_abonnement",
    legacySource.includes('namespace: "custom", key: "prix_abonnement"'),
  );
  ctx.assertTrue(
    "legacy still uses variants(first: 1)",
    legacySource.includes("variants(first: 1)"),
  );
  ctx.assertTrue(
    "legacy still computes variantPrice - subscriptionPrice",
    legacySource.includes("variantPrice - subscriptionPrice"),
  );
  ctx.assertTrue(
    "legacy still updates existing groups",
    legacySource.includes("sellingPlanGroupUpdate"),
  );
  ctx.assertFalse(
    "V2 service does not import legacy provisioning",
    v2Source.includes("settings-selling-plans.server"),
  );
  ctx.assertFalse(
    "V2 service does not call createOrUpdateWeeklySellingPlans",
    v2Source.includes("createOrUpdateWeeklySellingPlans"),
  );

  ctx.scenario("S. Idempotence on an already configured catalog");
  const idempotentFixture = alreadyConfiguredFixture();
  const firstPass = createMockAdmin({
    groupDetailsById: idempotentFixture.groupDetailsById,
    products: [idempotentFixture.product],
  });
  const secondPass = createMockAdmin({
    groupDetailsById: idempotentFixture.groupDetailsById,
    products: [idempotentFixture.product],
  });
  const firstResult = await setupV2WeeklySellingPlans(firstPass.admin);
  const secondResult = await setupV2WeeklySellingPlans(secondPass.admin);
  ctx.assertEqual("first pass alreadyConfigured", firstResult.alreadyConfiguredCount, 1);
  ctx.assertEqual("second pass alreadyConfigured", secondResult.alreadyConfiguredCount, 1);
  ctx.assertEqual("first pass mutations", mutationCalls(firstPass.calls).length, 0);
  ctx.assertEqual("second pass mutations", mutationCalls(secondPass.calls).length, 0);
  ctx.assertTrue(
    "both passes query product then group details",
    firstPass.calls.some((call) =>
      call.query.includes("BoxV2SellingPlanProductsByHandle"),
    ) &&
      firstPass.calls.some((call) =>
        call.query.includes("BoxV2SellingPlanGroupDetails"),
      ) &&
      secondPass.calls.some((call) =>
        call.query.includes("BoxV2SellingPlanProductsByHandle"),
      ) &&
      secondPass.calls.some((call) =>
        call.query.includes("BoxV2SellingPlanGroupDetails"),
      ),
  );
  ctx.assertEqual(
    "idempotent passes have no mutations",
    mutationCalls(firstPass.calls).length + mutationCalls(secondPass.calls).length,
    0,
  );

  ctx.scenario("T. No destructive mutations in V2");
  ctx.assertFalse(
    "no sellingPlanGroupDelete",
    v2Source.includes("sellingPlanGroupDelete"),
  );
  ctx.assertFalse(
    "no sellingPlanGroupRemoveProducts",
    v2Source.includes("sellingPlanGroupRemoveProducts"),
  );
  ctx.assertFalse(
    "no sellingPlanGroupRemoveProductVariants",
    v2Source.includes("sellingPlanGroupRemoveProductVariants"),
  );
  ctx.assertFalse(
    "no sellingPlanGroupUpdate",
    v2Source.includes("sellingPlanGroupUpdate"),
  );
  ctx.assertFalse("no nodes[0] resolution", v2Source.includes("nodes[0]"));
  ctx.assertTrue(
    "create mutation is present",
    SELLING_PLAN_GROUP_CREATE_V2_MUTATION.includes("sellingPlanGroupCreate"),
  );
  ctx.assertTrue(
    "add variants mutation is present",
    SELLING_PLAN_GROUP_ADD_PRODUCT_VARIANTS_MUTATION.includes(
      "sellingPlanGroupAddProductVariants",
    ),
  );

  ctx.scenario("U. Provisioning query shape — split QUERY A / QUERY B");
  ctx.assertEqual("variants page size constant", V2_BOX_VARIANTS_PAGE_SIZE, 100);
  ctx.assertTrue(
    "QUERY A is named BoxV2SellingPlanProductsByHandle",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes(
      "query BoxV2SellingPlanProductsByHandle",
    ),
  );
  ctx.assertTrue(
    "QUERY A searches products by handle variable",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes(
      "products(first: 5, query: $query)",
    ),
  );
  ctx.assertTrue(
    "QUERY A fetches product handle",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("handle"),
  );
  ctx.assertFalse(
    "QUERY A does not load a collection",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("collection("),
  );
  ctx.assertTrue(
    "QUERY A loads variants(first: 100)",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("variants(first: 100)"),
  );
  ctx.assertFalse(
    "QUERY A does not use variants(first: 1)",
    /variants\(first:\s*1\)/.test(BOX_V2_SELLING_PLAN_PRODUCTS_QUERY),
  );
  ctx.assertTrue(
    "QUERY A fetches variant objective",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes('key: "objective"'),
  );
  ctx.assertTrue(
    "QUERY A fetches variant meal_count",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes('key: "meal_count"'),
  );
  ctx.assertTrue(
    "QUERY A has product-level sellingPlanGroups",
    /sellingPlanGroups\(first:\s*20\)/.test(BOX_V2_SELLING_PLAN_PRODUCTS_QUERY),
  );
  ctx.assertFalse(
    "QUERY A does not request pricingPolicies",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("pricingPolicies"),
  );
  ctx.assertFalse(
    "QUERY A does not request sellingPlans",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("sellingPlans"),
  );
  ctx.assertFalse(
    "selling plan provisioning avoids nested per-variant selling-plan connections",
    /variants\([\s\S]*?sellingPlanGroups\(/.test(BOX_V2_SELLING_PLAN_PRODUCTS_QUERY),
  );
  ctx.assertFalse(
    "QUERY A does not read custom.prix_abonnement",
    BOX_V2_SELLING_PLAN_PRODUCTS_QUERY.includes("prix_abonnement"),
  );
  ctx.assertTrue(
    "QUERY B is named BoxV2SellingPlanGroupDetails",
    BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "query BoxV2SellingPlanGroupDetails",
    ),
  );
  ctx.assertTrue(
    "QUERY B loads sellingPlanGroup(id: $groupId)",
    BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "sellingPlanGroup(id: $groupId)",
    ),
  );
  ctx.assertTrue(
    "QUERY B fetches sellingPlans",
    BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY.includes("sellingPlans(first: 10)"),
  );
  ctx.assertTrue(
    "QUERY B fetches pricingPolicies",
    BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY.includes("pricingPolicies"),
  );
  ctx.assertTrue(
    "QUERY B fetches productVariants filtered by productId",
    BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY.includes(
      "productVariants(first: 100, productId: $productId)",
    ),
  );

  ctx.scenario("V. Distinct Settings intent");
  const v2Intent: string = SETUP_V2_WEEKLY_SELLING_PLANS_INTENT;
  ctx.assertEqual(
    "V2 intent name",
    v2Intent,
    "setupV2WeeklySellingPlans",
  );
  ctx.assertTrue(
    "V2 intent is not the legacy selling-plan intent",
    v2Intent !== "setupWeeklySellingPlans",
  );
  ctx.assertTrue(
    "actions still handle legacy setupWeeklySellingPlans",
    actionsSource.includes('intent === "setupWeeklySellingPlans"'),
  );
  ctx.assertTrue(
    "actions handle the V2 intent",
    actionsSource.includes("SETUP_V2_WEEKLY_SELLING_PLANS_INTENT"),
  );
  const v2IntentIndex = actionsSource.indexOf(
    "if (intent === SETUP_V2_WEEKLY_SELLING_PLANS_INTENT)",
  );
  const nextIntentAfterV2 = actionsSource.indexOf(
    "if (intent ===",
    v2IntentIndex + 1,
  );
  const fallbackBoxCollectionIndex = actionsSource.indexOf(
    "const boxCollectionId",
    v2IntentIndex,
  );
  const v2BlockEnd =
    nextIntentAfterV2 === -1
      ? fallbackBoxCollectionIndex
      : Math.min(
          nextIntentAfterV2,
          fallbackBoxCollectionIndex === -1
            ? nextIntentAfterV2
            : fallbackBoxCollectionIndex,
        );
  const v2Block = actionsSource.slice(v2IntentIndex, v2BlockEnd);
  ctx.assertTrue(
    "V2 intent calls setupV2WeeklySellingPlans",
    v2Block.includes("setupV2WeeklySellingPlans("),
  );
  ctx.assertTrue(
    "V2 intent calls setupV2WeeklySellingPlans(admin) without collection",
    v2Block.includes("setupV2WeeklySellingPlans(admin)"),
  );
  ctx.assertFalse(
    "V2 intent does not call createOrUpdateWeeklySellingPlans",
    v2Block.includes("createOrUpdateWeeklySellingPlans("),
  );
  ctx.assertFalse(
    "V2 intent does not read settings.boxCollectionId",
    v2Block.includes("boxCollectionId"),
  );
  ctx.assertFalse(
    "V2 intent does not load AppSettings for collection targeting",
    v2Block.includes("prisma.appSettings"),
  );
  ctx.assertTrue(
    "V2 intent catches unexpected Shopify query failures",
    v2Block.includes("try {") && v2Block.includes("catch (error)"),
  );

  ctx.scenario("W. Settings UI copy");
  ctx.assertTrue(
    "UI has the V2 control label",
    uiSource.includes("Configurer abonnements Box V2"),
  );
  ctx.assertTrue(
    "UI posts the V2 intent",
    uiSource.includes('value="setupV2WeeklySellingPlans"'),
  );
  ctx.assertTrue(
    "UI targets Box Mileyo V2 by handle",
    uiSource.includes("Box Mileyo V2") && uiSource.includes("box-mileyo-v2"),
  );
  ctx.assertTrue(
    "UI says legacy collection products are not involved",
    uiSource.includes("Les produits legacy de la collection historique ne sont pas"),
  );
  ctx.assertTrue(
    "UI says price is the variant price",
    uiSource.includes("prix de la variante"),
  );
  ctx.assertTrue(
    "UI says no extra discount",
    uiSource.includes("Aucun") && uiSource.includes("discount"),
  );
  ctx.assertTrue(
    "legacy weekly selling-plan button remains",
    uiSource.includes("Créer / mettre à jour les abonnements hebdomadaires"),
  );

  ctx.scenario("X. Provisioning feedback is not a bare OK");
  const skippedOnly = summarizeV2SellingPlanResults([
    {
      productId: PRODUCT_ID,
      reason: V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_OBJECTIVE,
      status: "skipped",
      title: "Box 8 repas",
    },
  ]);
  const skippedMessage = formatV2SellingPlanSetupMessage(skippedOnly);
  ctx.assertEqual("all-skipped has no blocking errors", skippedOnly.errors.length, 0);
  ctx.assertTrue(
    "all-skipped message includes skipped count",
    skippedMessage.includes("1 ignoré"),
  );
  ctx.assertTrue(
    "all-skipped message includes the reason",
    skippedMessage.includes(V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_OBJECTIVE),
  );
  ctx.assertFalse("all-skipped message is not OK", skippedMessage === "OK");
  ctx.assertEqual(
    "empty products fallback message",
    formatV2SellingPlanSetupMessage(summarizeV2SellingPlanResults([])),
    "Abonnements Box V2 : Box Mileyo V2 introuvable.",
  );

  ctx.scenario("Y. Shopify userErrors surface as errors");
  const createErrorMock = createMockAdmin({
    createUserErrors: [{ message: "Shopify rejected create" }],
    products: [buildEligibleProduct()],
  });
  const createErrorResult = await setupV2WeeklySellingPlans(createErrorMock.admin);
  ctx.assertEqual("create userError status", createErrorResult.products[0]?.status, "error");
  ctx.assertTrue(
    "create userError is listed",
    createErrorResult.errors.some((error) =>
      error.includes("Shopify rejected create"),
    ),
  );

  ctx.scenario("Z. Invalid variant id / price skip");
  ctx.assertEqual(
    "skip invalid variant id",
    skipReason({
      id: PRODUCT_ID,
      handle: BOX_V2_PRODUCT_HANDLE,
      title: "Bad id",
      variants: {
        nodes: [
          buildVariant({
            id: "   ",
            mealCount: "8",
            objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
          }),
        ],
      },
    }),
    V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_ID,
  );
  ctx.assertEqual(
    "skip invalid variant price",
    skipReason({
      id: PRODUCT_ID,
      handle: BOX_V2_PRODUCT_HANDLE,
      title: "Bad price",
      variants: {
        nodes: [
          buildVariant({
            id: VARIANT_IDS.weightLoss8,
            mealCount: "8",
            objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
            price: "abc",
          }),
        ],
      },
    }),
    V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_PRICE,
  );

  ctx.scenario("AA. Target Box Mileyo V2 by canonical handle only");
  ctx.assertEqual(
    "shared BOX_V2_PRODUCT_HANDLE",
    BOX_V2_PRODUCT_HANDLE,
    "box-mileyo-v2",
  );
  ctx.assertTrue(
    "service imports BOX_V2_PRODUCT_HANDLE",
    v2Source.includes('from "../../constants/subscriptionBoxCatalogV2"') &&
      v2Source.includes("BOX_V2_PRODUCT_HANDLE"),
  );
  ctx.assertFalse(
    "service does not hardcode handle string in query variables",
    v2Source.includes('query: "handle:box-mileyo-v2"'),
  );
  ctx.assertTrue(
    "service builds handle query from constant",
    v2Source.includes("`handle:${BOX_V2_PRODUCT_HANDLE}`"),
  );
  ctx.assertFalse(
    "setupV2WeeklySellingPlans no longer takes boxCollectionId",
    /setupV2WeeklySellingPlans\s*=\s*async\s*\(\s*admin\s*,\s*boxCollectionId/.test(
      v2Source,
    ),
  );
  ctx.assertFalse(
    "V2 selling-plan service does not read AppSettings.boxCollectionId",
    v2Source.includes("boxCollectionId"),
  );
  ctx.assertFalse(
    "V2 selling-plan service does not query collection products",
    v2Source.includes("getCollectionProducts") ||
      v2Source.includes("collection(id:"),
  );

  const absentLookup = resolveV2BoxProductsByHandle([]);
  ctx.assertEqual("0 products → absent", absentLookup.status, "absent");

  const mismatchLookup = resolveV2BoxProductsByHandle([
    {
      id: "gid://shopify/Product/legacy-1",
      handle: "box-8-repas",
      title: "Box 8 repas",
      variants: { nodes: [] },
    },
  ]);
  ctx.assertEqual(
    "wrong handle → handleMismatch",
    mismatchLookup.status,
    "handleMismatch",
  );

  const ambiguousLookup = resolveV2BoxProductsByHandle([
    buildEligibleProduct(),
    {
      ...buildEligibleProduct(),
      id: "gid://shopify/Product/5002",
    },
  ]);
  ctx.assertEqual(
    "multiple exact handles → ambiguous",
    ambiguousLookup.status,
    "ambiguous",
  );

  const exactLookup = resolveV2BoxProductsByHandle([buildEligibleProduct()]);
  ctx.assertEqual("one exact handle → exact", exactLookup.status, "exact");

  const absentMock = createMockAdmin({ products: [] });
  const absentResult = await setupV2WeeklySellingPlans(absentMock.admin);
  ctx.assertEqual("absent product skipped", absentResult.skippedCount, 1);
  ctx.assertEqual("absent product no create", absentResult.createdCount, 0);
  ctx.assertEqual(
    "absent reason",
    absentResult.products[0]?.reason,
    V2_SELLING_PLAN_SKIP_REASON.PRODUCT_NOT_FOUND,
  );
  ctx.assertEqual("absent product mutations", mutationCalls(absentMock.calls).length, 0);
  ctx.assertEqual(
    "absent query uses handle variable",
    absentMock.calls[0]?.variables?.query,
    `handle:${BOX_V2_PRODUCT_HANDLE}`,
  );

  const mismatchMock = createMockAdmin({
    products: [
      {
        id: "gid://shopify/Product/legacy-1",
        handle: "box-8-repas",
        title: "Box 8 repas",
        variants: {
          nodes: [
            buildVariant({
              id: VARIANT_IDS.weightLoss8,
              mealCount: "8",
              objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
            }),
          ],
        },
      },
    ],
  });
  const mismatchResult = await setupV2WeeklySellingPlans(mismatchMock.admin);
  ctx.assertEqual("handle mismatch skipped", mismatchResult.skippedCount, 1);
  ctx.assertEqual(
    "handle mismatch reason",
    mismatchResult.products[0]?.reason,
    V2_SELLING_PLAN_SKIP_REASON.HANDLE_MISMATCH,
  );
  ctx.assertEqual(
    "handle mismatch mutations",
    mutationCalls(mismatchMock.calls).length,
    0,
  );

  const ambiguousMock = createMockAdmin({
    products: [
      buildEligibleProduct(),
      { ...buildEligibleProduct(), id: "gid://shopify/Product/5002" },
    ],
  });
  const ambiguousResult = await setupV2WeeklySellingPlans(ambiguousMock.admin);
  ctx.assertEqual("ambiguous lookup blocked", ambiguousResult.blockedCount, 1);
  ctx.assertEqual(
    "ambiguous reason",
    ambiguousResult.products[0]?.reason,
    V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_PRODUCTS,
  );
  ctx.assertEqual(
    "ambiguous mutations",
    mutationCalls(ambiguousMock.calls).length,
    0,
  );

  const exactMock = createMockAdmin({ products: [buildEligibleProduct()] });
  const exactResult = await setupV2WeeklySellingPlans(exactMock.admin);
  ctx.assertEqual("exact eligible product creates", exactResult.createdCount, 1);
  ctx.assertEqual(
    "exact create resources productIds",
    JSON.stringify(
      (
        mutationCalls(exactMock.calls)[0]?.variables?.resources as {
          productIds: string[];
        }
      ).productIds,
    ),
    JSON.stringify([PRODUCT_ID]),
  );
  ctx.assertFalse(
    "exact path never provisions a legacy box product id",
    mutationCalls(exactMock.calls).some((call) =>
      JSON.stringify(call.variables ?? {}).includes("legacy"),
    ),
  );

  return finishSuite("15-settings-v2-selling-plans", ctx);
};

runSuite()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
