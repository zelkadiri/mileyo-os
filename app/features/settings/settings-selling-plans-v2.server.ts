/**
 * Box V2 weekly selling-plan provisioning.
 *
 * Separate from legacy weekly selling-plan provisioning:

 * - requires variant-level mileyo.objective + mileyo.meal_count on EVERY variant
 * - omits pricingPolicies (checkout price = variant.price)
 * - never updates, deletes, or detaches existing groups/plans
 */

import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
} from "../../constants/subscriptionSellingPlan";
import { parseMealCountMetafield } from "../../utils/mealCountMetafield";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";

export const SETUP_V2_WEEKLY_SELLING_PLANS_INTENT =
  "setupV2WeeklySellingPlans" as const;

export const V2_BOX_VARIANTS_PAGE_SIZE = 100;

export const V2_SELLING_PLAN_SKIP_REASON = {
  DUPLICATE_OBJECTIVE_MEAL_COUNT: "duplicate objective/mealCount combination",
  INVALID_VARIANT_ID: "invalid variant id",
  INVALID_VARIANT_MEAL_COUNT: "invalid variant meal_count",
  INVALID_VARIANT_OBJECTIVE: "invalid variant objective",
  INVALID_VARIANT_PRICE: "invalid variant price",
  MISSING_VARIANT_MEAL_COUNT: "missing variant meal_count",
  MISSING_VARIANT_OBJECTIVE: "missing variant objective",
  NO_VARIANTS: "no variants",
} as const;

export const V2_SELLING_PLAN_BLOCK_REASON = {
  GROUP_WITHOUT_PLAN: "Mileyo group exists without exact weekly plan",
  LEGACY_PRICING: "legacy pricing policy conflict",
  MULTIPLE_GROUPS: "multiple Mileyo selling plan groups",
  MULTIPLE_PLANS: "multiple Mileyo selling plans",
} as const;

type SettingsAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type V2SellingPlanPricingPolicyNode = {
  __typename?: string;
};

export type V2SellingPlanNode = {
  id: string;
  name: string;
  pricingPolicies?: V2SellingPlanPricingPolicyNode[] | null;
};

export type V2SellingPlanGroupNode = {
  id?: string | null;
  name: string;
  sellingPlans?: {
    nodes: V2SellingPlanNode[];
  } | null;
};

export type V2SellingPlanVariantNode = {
  id: string;
  title: string;
  price?: string | null;
  objectiveMetafield?: { value?: string | null } | null;
  mealCountMetafield?: { value?: string | null } | null;
  sellingPlanGroups?: {
    nodes: V2SellingPlanGroupNode[];
  } | null;
};

export type V2SellingPlanProductNode = {
  id: string;
  title: string;
  sellingPlanGroups?: {
    nodes: V2SellingPlanGroupNode[];
  } | null;
  variants: {
    nodes: V2SellingPlanVariantNode[];
  };
};

export type V2EligibleVariant = {
  id: string;
  mealCount: number;
  objective: string;
  price: string;
  title: string;
};

export type V2EligibilityResult =
  | { eligible: true; variants: V2EligibleVariant[] }
  | { eligible: false; reason: string };

export type V2SellingPlanDecision =
  | {
      action: "skip";
      reason: string;
    }
  | {
      action: "blocked";
      reason: string;
    }
  | {
      action: "create";
      productId: string;
      variantIds: string[];
    }
  | {
      action: "addMissingVariants";
      groupId: string;
      missingVariantIds: string[];
    }
  | {
      action: "alreadyConfigured";
      groupId: string;
      planId: string;
    };

export type V2SellingPlanProductStatus =
  | "created"
  | "variantsAdded"
  | "alreadyConfigured"
  | "skipped"
  | "blocked"
  | "error";

export type V2SellingPlanProductResult = {
  missingVariantIds?: string[];
  productId: string;
  reason?: string;
  status: V2SellingPlanProductStatus;
  title: string;
};

export type SetupV2WeeklySellingPlansResult = {
  alreadyConfiguredCount: number;
  blockedCount: number;
  createdCount: number;
  errorCount: number;
  errors: string[];
  products: V2SellingPlanProductResult[];
  skippedCount: number;
  variantsAddedCount: number;
};

export type V2WeeklySellingPlanInput = {
  billingPolicy: {
    recurring: {
      interval: "WEEK";
      intervalCount: 1;
    };
  };
  category: "SUBSCRIPTION";
  deliveryPolicy: {
    recurring: {
      interval: "WEEK";
      intervalCount: 1;
    };
  };
  name: string;
  options: string[];
};

export type V2WeeklySellingPlanGroupInput = {
  merchantCode: string;
  name: string;
  options: string[];
  sellingPlansToCreate: V2WeeklySellingPlanInput[];
};

type GraphqlErrorResponse = {
  data?: {
    collection?: {
      products: { nodes: V2SellingPlanProductNode[] };
    } | null;
    sellingPlanGroupAddProductVariants?: {
      userErrors: { field?: string[] | null; message: string }[];
    };
    sellingPlanGroupCreate?: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  };
  errors?: { message?: string | null }[];
};

export const BOX_V2_SELLING_PLAN_PRODUCTS_QUERY = `#graphql
  query BoxV2SellingPlanProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          sellingPlanGroups(first: 10) {
            nodes {
              id
              name
              sellingPlans(first: 10) {
                nodes {
                  id
                  name
                  pricingPolicies {
                    __typename
                  }
                }
              }
            }
          }
          variants(first: 100) {
            nodes {
              id
              title
              price
              objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
                value
              }
              mealCountMetafield: metafield(namespace: "mileyo", key: "meal_count") {
                value
              }
              sellingPlanGroups(first: 10) {
                nodes {
                  id
                  name
                  sellingPlans(first: 10) {
                    nodes {
                      id
                      name
                      pricingPolicies {
                        __typename
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const SELLING_PLAN_GROUP_CREATE_V2_MUTATION = `#graphql
  mutation CreateV2WeeklySellingPlanGroup(
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput!
  ) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const SELLING_PLAN_GROUP_ADD_PRODUCT_VARIANTS_MUTATION = `#graphql
  mutation AddV2SellingPlanGroupProductVariants(
    $id: ID!
    $productVariantIds: [ID!]!
  ) {
    sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $productVariantIds) {
      userErrors {
        field
        message
      }
    }
  }
`;

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

const parseV2VariantPrice = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const amount = Number.parseFloat(trimmed.replace(",", "."));

  if (!Number.isFinite(amount)) {
    return null;
  }

  return trimmed;
};

const metafieldRawValue = (
  metafield: { value?: string | null } | null | undefined,
) => metafield?.value ?? null;

/**
 * V2 eligibility ignores PRODUCT-level mileyo.meal_count on purpose.
 * Legacy product metafields must never classify a box as V2.
 */
export const evaluateV2ProductEligibility = (
  product: V2SellingPlanProductNode,
): V2EligibilityResult => {
  const variants = product.variants?.nodes ?? [];

  if (variants.length === 0) {
    return {
      eligible: false,
      reason: V2_SELLING_PLAN_SKIP_REASON.NO_VARIANTS,
    };
  }

  const eligibleVariants: V2EligibleVariant[] = [];
  const pairKeys = new Set<string>();

  for (const variant of variants) {
    if (isBlank(variant.id)) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_ID,
      };
    }

    const rawObjective = metafieldRawValue(variant.objectiveMetafield);
    if (isBlank(rawObjective)) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_OBJECTIVE,
      };
    }

    const objective = parseSubscriptionObjective(rawObjective);
    if (objective === null) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_OBJECTIVE,
      };
    }

    const rawMealCount = metafieldRawValue(variant.mealCountMetafield);
    if (isBlank(rawMealCount)) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.MISSING_VARIANT_MEAL_COUNT,
      };
    }

    const mealCount = parseMealCountMetafield(rawMealCount);
    if (mealCount === null) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_MEAL_COUNT,
      };
    }

    const price = parseV2VariantPrice(variant.price);
    if (price === null) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.INVALID_VARIANT_PRICE,
      };
    }

    const pairKey = `${objective}:${mealCount}`;
    if (pairKeys.has(pairKey)) {
      return {
        eligible: false,
        reason: V2_SELLING_PLAN_SKIP_REASON.DUPLICATE_OBJECTIVE_MEAL_COUNT,
      };
    }
    pairKeys.add(pairKey);

    eligibleVariants.push({
      id: variant.id.trim(),
      mealCount,
      objective,
      price,
      title: variant.title,
    });
  }

  return { eligible: true, variants: eligibleVariants };
};

const mergeSellingPlans = (
  left: V2SellingPlanNode[],
  right: V2SellingPlanNode[],
): V2SellingPlanNode[] => {
  const byId = new Map<string, V2SellingPlanNode>();

  for (const plan of [...left, ...right]) {
    if (isBlank(plan.id)) {
      continue;
    }

    const existing = byId.get(plan.id);
    if (!existing) {
      byId.set(plan.id, plan);
      continue;
    }

    const existingHasPolicies = existing.pricingPolicies != null;
    const incomingHasPolicies = plan.pricingPolicies != null;
    if (incomingHasPolicies && !existingHasPolicies) {
      byId.set(plan.id, plan);
      continue;
    }

    if (
      (plan.pricingPolicies?.length ?? 0) >
      (existing.pricingPolicies?.length ?? 0)
    ) {
      byId.set(plan.id, plan);
    }
  }

  return [...byId.values()];
};

const collectNamedMileyoGroups = (
  product: V2SellingPlanProductNode,
): V2SellingPlanGroupNode[] => {
  const groups: V2SellingPlanGroupNode[] = [
    ...(product.sellingPlanGroups?.nodes ?? []),
  ];

  for (const variant of product.variants?.nodes ?? []) {
    groups.push(...(variant.sellingPlanGroups?.nodes ?? []));
  }

  return groups.filter(
    (group) => group.name === MILEYO_SELLING_PLAN_GROUP_NAME,
  );
};

export const collectExactMileyoSellingPlanGroups = (
  product: V2SellingPlanProductNode,
): V2SellingPlanGroupNode[] => {
  const byId = new Map<string, V2SellingPlanGroupNode>();

  for (const group of collectNamedMileyoGroups(product)) {
    const groupId = group.id?.trim();
    if (!groupId) {
      continue;
    }

    const existing = byId.get(groupId);
    if (!existing) {
      byId.set(groupId, {
        ...group,
        id: groupId,
        sellingPlans: {
          nodes: group.sellingPlans?.nodes ?? [],
        },
      });
      continue;
    }

    byId.set(groupId, {
      ...existing,
      sellingPlans: {
        nodes: mergeSellingPlans(
          existing.sellingPlans?.nodes ?? [],
          group.sellingPlans?.nodes ?? [],
        ),
      },
    });
  }

  return [...byId.values()];
};

export const hasSellingPlanPricingPolicies = (
  plan: V2SellingPlanNode,
): boolean => (plan.pricingPolicies?.length ?? 0) > 0;

const collectAttachedVariantIds = (
  product: V2SellingPlanProductNode,
  groupId: string,
): Set<string> => {
  const attached = new Set<string>();

  for (const variant of product.variants?.nodes ?? []) {
    const matches = (variant.sellingPlanGroups?.nodes ?? []).some(
      (group) => group.id === groupId,
    );
    if (matches && !isBlank(variant.id)) {
      attached.add(variant.id.trim());
    }
  }

  return attached;
};

export const getV2WeeklySellingPlanGroupInput =
  (): V2WeeklySellingPlanGroupInput => ({
    merchantCode: MILEYO_SELLING_PLAN_GROUP_NAME,
    name: MILEYO_SELLING_PLAN_GROUP_NAME,
    options: ["Fréquence"],
    sellingPlansToCreate: [
      {
        billingPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 1,
          },
        },
        category: "SUBSCRIPTION",
        deliveryPolicy: {
          recurring: {
            interval: "WEEK",
            intervalCount: 1,
          },
        },
        name: MILEYO_SELLING_PLAN_NAME,
        options: ["Hebdomadaire"],
      },
    ],
  });

export const resolveV2SellingPlanDecision = (
  product: V2SellingPlanProductNode,
): V2SellingPlanDecision => {
  const eligibility = evaluateV2ProductEligibility(product);
  if (!eligibility.eligible) {
    return { action: "skip", reason: eligibility.reason };
  }

  const namedWithoutId = collectNamedMileyoGroups(product).filter((group) =>
    isBlank(group.id),
  );
  if (namedWithoutId.length > 0) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
    };
  }

  const groups = collectExactMileyoSellingPlanGroups(product);

  if (groups.length === 0) {
    return {
      action: "create",
      productId: product.id,
      variantIds: eligibility.variants.map((variant) => variant.id),
    };
  }

  if (groups.length !== 1) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
    };
  }

  const group = groups.find(
    (candidate) => candidate.name === MILEYO_SELLING_PLAN_GROUP_NAME,
  );
  const groupId = group?.id?.trim();
  if (!group || !groupId) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
    };
  }

  const exactPlans = (group.sellingPlans?.nodes ?? []).filter(
    (plan) => plan.name === MILEYO_SELLING_PLAN_NAME,
  );

  if (exactPlans.length === 0) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.GROUP_WITHOUT_PLAN,
    };
  }

  if (exactPlans.length !== 1) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_PLANS,
    };
  }

  const plan = exactPlans.find(
    (candidate) => candidate.name === MILEYO_SELLING_PLAN_NAME,
  );
  if (!plan) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.GROUP_WITHOUT_PLAN,
    };
  }

  if (hasSellingPlanPricingPolicies(plan)) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.LEGACY_PRICING,
    };
  }

  const attachedVariantIds = collectAttachedVariantIds(product, groupId);
  const missingVariantIds = eligibility.variants
    .map((variant) => variant.id)
    .filter((variantId) => !attachedVariantIds.has(variantId));

  if (missingVariantIds.length === 0) {
    return {
      action: "alreadyConfigured",
      groupId,
      planId: plan.id,
    };
  }

  return {
    action: "addMissingVariants",
    groupId,
    missingVariantIds,
  };
};

const countByStatus = (
  products: V2SellingPlanProductResult[],
  status: V2SellingPlanProductStatus,
) => products.filter((product) => product.status === status).length;

export const summarizeV2SellingPlanResults = (
  products: V2SellingPlanProductResult[],
  extraErrors: string[] = [],
): SetupV2WeeklySellingPlansResult => {
  const blocking = products.filter(
    (product) => product.status === "blocked" || product.status === "error",
  );

  return {
    alreadyConfiguredCount: countByStatus(products, "alreadyConfigured"),
    blockedCount: countByStatus(products, "blocked"),
    createdCount: countByStatus(products, "created"),
    errorCount: countByStatus(products, "error"),
    errors: [
      ...blocking.map(
        (product) => `${product.title}: ${product.reason ?? product.status}`,
      ),
      ...extraErrors,
    ],
    products,
    skippedCount: countByStatus(products, "skipped"),
    variantsAddedCount: countByStatus(products, "variantsAdded"),
  };
};

export const formatV2SellingPlanSetupMessage = (
  result: SetupV2WeeklySellingPlansResult,
): string => {
  if (result.products.length === 0 && result.errors.length === 0) {
    return "Abonnements Box V2 : aucun produit box dans la collection.";
  }

  const summary = `Abonnements Box V2 : ${result.createdCount} créé(s), ${result.variantsAddedCount} variante(s) ajoutée(s), ${result.alreadyConfiguredCount} déjà configuré(s), ${result.skippedCount} ignoré(s), ${result.blockedCount} bloqué(s).`;
  const skipped = result.products.filter(
    (product) => product.status === "skipped",
  );
  if (skipped.length === 0) {
    return summary;
  }

  const skippedDetail = skipped
    .map((product) => `${product.title} (${product.reason ?? "skipped"})`)
    .join(" ; ");

  return `${summary} Ignorés : ${skippedDetail}`;
};

const graphqlErrorMessages = (json: GraphqlErrorResponse) =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

const getBoxProductsForV2SellingPlans = async (
  admin: SettingsAdmin,
  boxCollectionId: string,
): Promise<{ errors: string[]; products: V2SellingPlanProductNode[] }> => {
  const response = await admin.graphql(BOX_V2_SELLING_PLAN_PRODUCTS_QUERY, {
    variables: { id: boxCollectionId },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);

  if (errors.length > 0) {
    return { errors, products: [] };
  }

  return {
    errors: [],
    products: json.data?.collection?.products.nodes ?? [],
  };
};

const createV2WeeklySellingPlanGroup = async (
  admin: SettingsAdmin,
  productId: string,
  variantIds: string[],
): Promise<string[]> => {
  const response = await admin.graphql(SELLING_PLAN_GROUP_CREATE_V2_MUTATION, {
    variables: {
      input: getV2WeeklySellingPlanGroupInput(),
      resources: {
        productIds: [productId],
        productVariantIds: variantIds,
      },
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.sellingPlanGroupCreate?.userErrors.map(
      (error) => error.message,
    ) ?? [];

  return [...graphqlErrorMessages(json), ...userErrors];
};

const addMissingV2SellingPlanVariants = async (
  admin: SettingsAdmin,
  groupId: string,
  missingVariantIds: string[],
): Promise<string[]> => {
  const response = await admin.graphql(
    SELLING_PLAN_GROUP_ADD_PRODUCT_VARIANTS_MUTATION,
    {
      variables: {
        id: groupId,
        productVariantIds: missingVariantIds,
      },
    },
  );
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.sellingPlanGroupAddProductVariants?.userErrors.map(
      (error) => error.message,
    ) ?? [];

  return [...graphqlErrorMessages(json), ...userErrors];
};

export const setupV2WeeklySellingPlans = async (
  admin: SettingsAdmin,
  boxCollectionId: string,
): Promise<SetupV2WeeklySellingPlansResult> => {
  const { errors: queryErrors, products } =
    await getBoxProductsForV2SellingPlans(admin, boxCollectionId);

  if (queryErrors.length > 0) {
    return summarizeV2SellingPlanResults([], queryErrors);
  }

  const results: V2SellingPlanProductResult[] = [];

  for (const product of products) {
    const decision = resolveV2SellingPlanDecision(product);

    if (decision.action === "skip") {
      results.push({
        productId: product.id,
        reason: decision.reason,
        status: "skipped",
        title: product.title,
      });
      continue;
    }

    if (decision.action === "blocked") {
      results.push({
        productId: product.id,
        reason: decision.reason,
        status: "blocked",
        title: product.title,
      });
      continue;
    }

    if (decision.action === "alreadyConfigured") {
      results.push({
        productId: product.id,
        reason: "already configured",
        status: "alreadyConfigured",
        title: product.title,
      });
      continue;
    }

    if (decision.action === "create") {
      const mutationErrors = await createV2WeeklySellingPlanGroup(
        admin,
        decision.productId,
        decision.variantIds,
      );

      if (mutationErrors.length > 0) {
        results.push({
          productId: product.id,
          reason: mutationErrors.join(", "),
          status: "error",
          title: product.title,
        });
        continue;
      }

      results.push({
        productId: product.id,
        status: "created",
        title: product.title,
      });
      continue;
    }

    const mutationErrors = await addMissingV2SellingPlanVariants(
      admin,
      decision.groupId,
      decision.missingVariantIds,
    );

    if (mutationErrors.length > 0) {
      results.push({
        missingVariantIds: decision.missingVariantIds,
        productId: product.id,
        reason: mutationErrors.join(", "),
        status: "error",
        title: product.title,
      });
      continue;
    }

    results.push({
      missingVariantIds: decision.missingVariantIds,
      productId: product.id,
      status: "variantsAdded",
      title: product.title,
    });
  }

  return summarizeV2SellingPlanResults(results);
};
