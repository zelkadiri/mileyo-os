/**
 * Box V2 weekly selling-plan provisioning.
 *
 * Separate from legacy weekly selling-plan provisioning:

 * - requires variant-level mileyo.objective + mileyo.meal_count on EVERY variant
 * - omits pricingPolicies (checkout price = variant.price)
 * - never updates, deletes, or detaches existing groups/plans
 */

import { BOX_V2_PRODUCT_HANDLE } from "../../constants/subscriptionBoxCatalogV2";
import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
} from "../../constants/subscriptionSellingPlan";
import { parseMealCountMetafield } from "../../utils/mealCountMetafield";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";

export const SETUP_V2_WEEKLY_SELLING_PLANS_INTENT =
  "setupV2WeeklySellingPlans" as const;

export const V2_BOX_VARIANTS_PAGE_SIZE = 100;
export const V2_BOX_PRODUCT_SELLING_PLAN_GROUPS_PAGE_SIZE = 20;
export const V2_BOX_GROUP_SELLING_PLANS_PAGE_SIZE = 10;

export const V2_SELLING_PLAN_SKIP_REASON = {
  DUPLICATE_OBJECTIVE_MEAL_COUNT: "duplicate objective/mealCount combination",
  INVALID_VARIANT_ID: "invalid variant id",
  INVALID_VARIANT_MEAL_COUNT: "invalid variant meal_count",
  INVALID_VARIANT_OBJECTIVE: "invalid variant objective",
  INVALID_VARIANT_PRICE: "invalid variant price",
  MISSING_VARIANT_MEAL_COUNT: "missing variant meal_count",
  MISSING_VARIANT_OBJECTIVE: "missing variant objective",
  NO_VARIANTS: "no variants",
  PRODUCT_NOT_FOUND: "Box Mileyo V2 introuvable",
  HANDLE_MISMATCH: `product handle is not ${BOX_V2_PRODUCT_HANDLE}`,
} as const;

export const V2_SELLING_PLAN_BLOCK_REASON = {
  GROUP_DETAILS_UNAVAILABLE: "selling plan group details unavailable",
  GROUP_WITHOUT_PLAN: "Mileyo group exists without exact weekly plan",
  LEGACY_PRICING: "legacy pricing policy conflict",
  MULTIPLE_GROUPS: "multiple Mileyo selling plan groups",
  MULTIPLE_PLANS: "multiple Mileyo selling plans",
  MULTIPLE_PRODUCTS: "multiple products matched Box Mileyo V2 handle",
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

export type V2SellingPlanGroupSummary = {
  id?: string | null;
  name: string;
};

/** @deprecated Prefer V2SellingPlanGroupSummary for QUERY A product groups. */
export type V2SellingPlanGroupNode = V2SellingPlanGroupSummary & {
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
};

export type V2SellingPlanProductNode = {
  id: string;
  title: string;
  handle?: string | null;
  sellingPlanGroups?: {
    nodes: V2SellingPlanGroupSummary[];
  } | null;
  variants: {
    nodes: V2SellingPlanVariantNode[];
  };
};

export type V2SellingPlanGroupDetails = {
  id: string;
  name: string;
  sellingPlans?: {
    nodes: V2SellingPlanNode[];
  } | null;
  productVariants?: {
    nodes: { id: string }[];
  } | null;
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
    products?: {
      nodes: V2SellingPlanProductNode[];
    };
    sellingPlanGroup?: V2SellingPlanGroupDetails | null;
    sellingPlanGroupAddProductVariants?: {
      userErrors: { field?: string[] | null; message: string }[];
    };
    sellingPlanGroupCreate?: {
      userErrors: { field?: string[] | null; message: string }[];
    };
  };
  errors?: { message?: string | null }[];
};

/**
 * QUERY A — product identity, variant eligibility, product-level group summaries.
 * Intentionally omits per-variant sellingPlanGroups (Shopify requested-cost bomb).
 */
export const BOX_V2_SELLING_PLAN_PRODUCTS_QUERY = `#graphql
  query BoxV2SellingPlanProductsByHandle($query: String!) {
    products(first: 5, query: $query) {
      nodes {
        id
        title
        handle
        sellingPlanGroups(first: 20) {
          nodes {
            id
            name
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
          }
        }
      }
    }
  }
`;

/**
 * QUERY B — exact Mileyo group details + Box V2 variant attachments.
 * Fetched only when QUERY A finds exactly one Mileyo group.
 */
export const BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY = `#graphql
  query BoxV2SellingPlanGroupDetails($groupId: ID!, $productId: ID!) {
    sellingPlanGroup(id: $groupId) {
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
      productVariants(first: 100, productId: $productId) {
        nodes {
          id
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

const collectNamedMileyoGroupSummaries = (
  product: V2SellingPlanProductNode,
): V2SellingPlanGroupSummary[] =>
  (product.sellingPlanGroups?.nodes ?? []).filter(
    (group) => group.name === MILEYO_SELLING_PLAN_GROUP_NAME,
  );

export const collectExactMileyoSellingPlanGroupSummaries = (
  product: V2SellingPlanProductNode,
): V2SellingPlanGroupSummary[] => {
  const byId = new Map<string, V2SellingPlanGroupSummary>();

  for (const group of collectNamedMileyoGroupSummaries(product)) {
    const groupId = group.id?.trim();
    if (!groupId) {
      continue;
    }

    if (!byId.has(groupId)) {
      byId.set(groupId, {
        id: groupId,
        name: group.name,
      });
    }
  }

  return [...byId.values()];
};

/** @deprecated Use collectExactMileyoSellingPlanGroupSummaries. */
export const collectExactMileyoSellingPlanGroups =
  collectExactMileyoSellingPlanGroupSummaries;

export const hasSellingPlanPricingPolicies = (
  plan: V2SellingPlanNode,
): boolean => (plan.pricingPolicies?.length ?? 0) > 0;

const collectAttachedVariantIdsFromGroupDetails = (
  groupDetails: V2SellingPlanGroupDetails,
): Set<string> => {
  const attached = new Set<string>();

  for (const variant of groupDetails.productVariants?.nodes ?? []) {
    if (!isBlank(variant.id)) {
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
  groupDetails: V2SellingPlanGroupDetails | null = null,
): V2SellingPlanDecision => {
  const eligibility = evaluateV2ProductEligibility(product);
  if (!eligibility.eligible) {
    return { action: "skip", reason: eligibility.reason };
  }

  const namedWithoutId = collectNamedMileyoGroupSummaries(product).filter(
    (group) => isBlank(group.id),
  );
  if (namedWithoutId.length > 0) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
    };
  }

  const groups = collectExactMileyoSellingPlanGroupSummaries(product);

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

  const summary = groups[0];
  const groupId = summary.id?.trim();
  if (!groupId) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
    };
  }

  if (
    !groupDetails ||
    isBlank(groupDetails.id) ||
    groupDetails.id.trim() !== groupId ||
    groupDetails.name !== MILEYO_SELLING_PLAN_GROUP_NAME
  ) {
    return {
      action: "blocked",
      reason: V2_SELLING_PLAN_BLOCK_REASON.GROUP_DETAILS_UNAVAILABLE,
    };
  }

  const exactPlans = (groupDetails.sellingPlans?.nodes ?? []).filter(
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

  const attachedVariantIds =
    collectAttachedVariantIdsFromGroupDetails(groupDetails);
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
    return "Abonnements Box V2 : Box Mileyo V2 introuvable.";
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

export type V2BoxProductLookupResult =
  | { status: "absent"; errors: string[]; products: [] }
  | { status: "exact"; errors: string[]; products: [V2SellingPlanProductNode] }
  | {
      status: "ambiguous";
      errors: string[];
      products: V2SellingPlanProductNode[];
    }
  | {
      status: "handleMismatch";
      errors: string[];
      products: V2SellingPlanProductNode[];
    }
  | { status: "error"; errors: string[]; products: [] };

export const resolveV2BoxProductsByHandle = (
  nodes: V2SellingPlanProductNode[],
): V2BoxProductLookupResult => {
  if (nodes.length === 0) {
    return { status: "absent", errors: [], products: [] };
  }

  const exactHandleMatches = nodes.filter(
    (product) => product.handle === BOX_V2_PRODUCT_HANDLE,
  );

  if (exactHandleMatches.length === 0) {
    return { status: "handleMismatch", errors: [], products: nodes };
  }

  if (exactHandleMatches.length > 1) {
    return {
      status: "ambiguous",
      errors: [],
      products: exactHandleMatches,
    };
  }

  return {
    status: "exact",
    errors: [],
    products: [exactHandleMatches[0]],
  };
};

const getBoxV2ProductForSellingPlans = async (
  admin: SettingsAdmin,
): Promise<V2BoxProductLookupResult> => {
  const response = await admin.graphql(BOX_V2_SELLING_PLAN_PRODUCTS_QUERY, {
    variables: { query: `handle:${BOX_V2_PRODUCT_HANDLE}` },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);

  if (errors.length > 0) {
    return { status: "error", errors, products: [] };
  }

  return resolveV2BoxProductsByHandle(json.data?.products?.nodes ?? []);
};

type V2GroupDetailsLookupResult =
  | { status: "exact"; errors: string[]; details: V2SellingPlanGroupDetails }
  | { status: "missing"; errors: string[]; details: null }
  | { status: "error"; errors: string[]; details: null };

export const getBoxV2SellingPlanGroupDetails = async (
  admin: SettingsAdmin,
  groupId: string,
  productId: string,
): Promise<V2GroupDetailsLookupResult> => {
  const response = await admin.graphql(BOX_V2_SELLING_PLAN_GROUP_DETAILS_QUERY, {
    variables: { groupId, productId },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);

  if (errors.length > 0) {
    return { status: "error", errors, details: null };
  }

  const details = json.data?.sellingPlanGroup ?? null;
  if (
    !details ||
    isBlank(details.id) ||
    details.id.trim() !== groupId.trim() ||
    details.name !== MILEYO_SELLING_PLAN_GROUP_NAME
  ) {
    return { status: "missing", errors: [], details: null };
  }

  return { status: "exact", errors: [], details };
};

const resolveDecisionForProduct = async (
  admin: SettingsAdmin,
  product: V2SellingPlanProductNode,
): Promise<
  | { decision: V2SellingPlanDecision; errors: string[] }
  | { decision: null; errors: string[] }
> => {
  const eligibility = evaluateV2ProductEligibility(product);
  if (!eligibility.eligible) {
    return {
      decision: { action: "skip", reason: eligibility.reason },
      errors: [],
    };
  }

  const namedWithoutId = collectNamedMileyoGroupSummaries(product).filter(
    (group) => isBlank(group.id),
  );
  if (namedWithoutId.length > 0) {
    return {
      decision: {
        action: "blocked",
        reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
      },
      errors: [],
    };
  }

  const groups = collectExactMileyoSellingPlanGroupSummaries(product);

  if (groups.length !== 1) {
    return {
      decision: resolveV2SellingPlanDecision(product, null),
      errors: [],
    };
  }

  const groupId = groups[0]?.id?.trim();
  if (!groupId) {
    return {
      decision: {
        action: "blocked",
        reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_GROUPS,
      },
      errors: [],
    };
  }

  const detailsLookup = await getBoxV2SellingPlanGroupDetails(
    admin,
    groupId,
    product.id,
  );

  if (detailsLookup.status === "error") {
    return { decision: null, errors: detailsLookup.errors };
  }

  if (detailsLookup.status === "missing") {
    return {
      decision: {
        action: "blocked",
        reason: V2_SELLING_PLAN_BLOCK_REASON.GROUP_DETAILS_UNAVAILABLE,
      },
      errors: [],
    };
  }

  return {
    decision: resolveV2SellingPlanDecision(product, detailsLookup.details),
    errors: [],
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
): Promise<SetupV2WeeklySellingPlansResult> => {
  const lookup = await getBoxV2ProductForSellingPlans(admin);

  if (lookup.status === "error") {
    return summarizeV2SellingPlanResults([], lookup.errors);
  }

  if (lookup.status === "absent") {
    return summarizeV2SellingPlanResults([
      {
        productId: "",
        reason: V2_SELLING_PLAN_SKIP_REASON.PRODUCT_NOT_FOUND,
        status: "skipped",
        title: "Box Mileyo V2",
      },
    ]);
  }

  if (lookup.status === "handleMismatch") {
    return summarizeV2SellingPlanResults(
      lookup.products.map((product) => ({
        productId: product.id,
        reason: V2_SELLING_PLAN_SKIP_REASON.HANDLE_MISMATCH,
        status: "skipped" as const,
        title: product.title,
      })),
    );
  }

  if (lookup.status === "ambiguous") {
    return summarizeV2SellingPlanResults([
      {
        productId: lookup.products[0]?.id ?? "",
        reason: V2_SELLING_PLAN_BLOCK_REASON.MULTIPLE_PRODUCTS,
        status: "blocked",
        title: lookup.products[0]?.title ?? "Box Mileyo V2",
      },
    ]);
  }

  const products = lookup.products;
  const results: V2SellingPlanProductResult[] = [];
  const extraErrors: string[] = [];

  for (const product of products) {
    const resolved = await resolveDecisionForProduct(admin, product);

    if (resolved.decision === null) {
      extraErrors.push(...resolved.errors);
      results.push({
        productId: product.id,
        reason: resolved.errors.join("; ") || "GraphQL error",
        status: "error",
        title: product.title,
      });
      continue;
    }

    const decision = resolved.decision;

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

  return summarizeV2SellingPlanResults(results, extraErrors);
};
