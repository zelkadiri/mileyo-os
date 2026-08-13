import { BOX_V2_PRODUCT_HANDLE } from "../constants/subscriptionBoxCatalogV2";
import type { SubscriptionObjective } from "../constants/subscriptionObjective";
import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
} from "../constants/subscriptionSellingPlan";
import {
  parseMealCountMetafield,
  warnMissingMealCountMetafield,
} from "../utils/mealCountMetafield";
import { parseSubscriptionObjective } from "../utils/subscriptionObjective";

export {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
};

export type ShopifyBoxProductNode = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  mealCountMetafield?: { value: string } | null;
  subscriptionPriceMetafield?: { value: string } | null;
  sellingPlanGroups?: {
    nodes: {
      name: string;
      sellingPlans: {
        nodes: { id: string; name: string }[];
      };
    }[];
  };
  variants: {
    nodes: {
      id: string;
      price?: string | null;
      title: string;
    }[];
  };
};

export type BoxCatalogProduct = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  mealCount: number | null;
  sellingPlanId: string | null;
  subscriptionPrice: string | null;
  title: string;
  variantId: string;
  variantPrice: string | null;
  variantTitle: string;
};

export type TrustedBoxProduct = BoxCatalogProduct & {
  mealCount: number;
  sellingPlanId: string;
  subscriptionPrice: string;
  variantId: string;
};

export type PortalBoxProduct = {
  id: string;
  imageAlt: string;
  imageUrl: string | null;
  mealCount: number | null;
  subscriptionPrice: string | null;
  title: string;
};

const boxCollectionProductsQuery = `#graphql
  query SubscriptionBoxCatalogProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            altText
            url
          }
          subscriptionPriceMetafield: metafield(
            namespace: "custom"
            key: "prix_abonnement"
          ) {
            value
          }
          mealCountMetafield: metafield(namespace: "mileyo", key: "meal_count") {
            value
          }
          sellingPlanGroups(first: 10) {
            nodes {
              name
              sellingPlans(first: 10) {
                nodes {
                  id
                  name
                }
              }
            }
          }
          variants(first: 1) {
            nodes {
              id
              price
              title
            }
          }
        }
      }
    }
  }
`;

type BoxCollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyBoxProductNode[] };
    } | null;
  };
  errors?: { message?: string | null }[];
};

const parseSubscriptionPrice = (value: string | null | undefined) => {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim().replace(",", ".");
  const amount = Number.parseFloat(normalized);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount.toFixed(2);
};

export const toBoxCatalogProducts = (
  products: ShopifyBoxProductNode[],
): BoxCatalogProduct[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];
    const mealCount = parseMealCountMetafield(
      product.mealCountMetafield?.value,
    );

    if (mealCount === null) {
      warnMissingMealCountMetafield(product.id, product.title);
    }

    const weeklySellingPlanGroup = product.sellingPlanGroups?.nodes.find(
      (group) => group.name === MILEYO_SELLING_PLAN_GROUP_NAME,
    );
    const weeklySellingPlan =
      weeklySellingPlanGroup?.sellingPlans.nodes.find(
        (sellingPlan) => sellingPlan.name === MILEYO_SELLING_PLAN_NAME,
      ) ?? null;

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      mealCount,
      sellingPlanId: weeklySellingPlan?.id ?? null,
      subscriptionPrice: parseSubscriptionPrice(
        product.subscriptionPriceMetafield?.value,
      ),
      title: product.title,
      variantId: firstVariant?.id ?? "",
      variantPrice: firstVariant?.price ?? null,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });

export const toTrustedBoxProducts = (
  products: BoxCatalogProduct[],
): TrustedBoxProduct[] => {
  const trusted: TrustedBoxProduct[] = [];

  for (const product of products) {
    if (
      !product.variantId ||
      product.mealCount === null ||
      !product.subscriptionPrice ||
      !product.sellingPlanId
    ) {
      continue;
    }

    trusted.push({
      ...product,
      mealCount: product.mealCount,
      sellingPlanId: product.sellingPlanId,
      subscriptionPrice: product.subscriptionPrice,
      variantId: product.variantId,
    });
  }

  return trusted.sort((left, right) => left.mealCount - right.mealCount);
};

export const toPortalBoxProducts = (
  products: BoxCatalogProduct[],
): PortalBoxProduct[] =>
  products.map((product) => ({
    id: product.id,
    imageAlt: product.imageAlt,
    imageUrl: product.imageUrl,
    mealCount: product.mealCount,
    subscriptionPrice: product.subscriptionPrice,
    title: product.title,
  }));

export const fetchBoxCatalogProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  boxCollectionId: string,
) => {
  const response = await admin.graphql(boxCollectionProductsQuery, {
    variables: { id: boxCollectionId },
  });
  const json = (await response.json()) as BoxCollectionProductsResponse;

  if (json.errors?.length) {
    throw new Error(
      json.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de charger les box disponibles.",
    );
  }

  return toBoxCatalogProducts(json.data?.collection?.products.nodes ?? []);
};

export const fetchTrustedBoxCatalog = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  boxCollectionId: string,
) => {
  const catalog = await fetchBoxCatalogProducts(admin, boxCollectionId);

  return toTrustedBoxProducts(catalog);
};

export const resolveTrustedBoxProduct = (
  catalog: TrustedBoxProduct[],
  productId: string,
) => catalog.find((product) => product.id === productId) ?? null;

export const resolveCurrentBoxProduct = (
  catalog: TrustedBoxProduct[],
  selection: {
    boxProductShopifyId: string | null;
    boxTitle: string | null;
    mealsCount: number | null;
  },
) => {
  if (selection.boxProductShopifyId) {
    const byId = resolveTrustedBoxProduct(catalog, selection.boxProductShopifyId);
    if (byId) {
      return byId;
    }
  }

  if (selection.boxTitle) {
    const byTitle = catalog.find((product) => product.title === selection.boxTitle);
    if (byTitle) {
      return byTitle;
    }
  }

  if (typeof selection.mealsCount === "number" && selection.mealsCount > 0) {
    return (
      catalog.find((product) => product.mealCount === selection.mealsCount) ??
      null
    );
  }

  return null;
};

export type BoxCatalogVariantV2 = {
  variantId: string;
  variantTitle: string;
  objective: SubscriptionObjective | null;
  mealCount: number | null;
  price: string | null;
  sellingPlanId: string | null;
};

export type BoxCatalogProductV2 = {
  id: string;
  title: string;
  imageAlt: string;
  imageUrl: string | null;
  variants: BoxCatalogVariantV2[];
};

export type ShopifyBoxCatalogSellingPlanNodeV2 = {
  id: string;
  name: string;
};

export type ShopifyBoxCatalogSellingPlanGroupNodeV2 = {
  id?: string;
  name: string;
  sellingPlans: {
    nodes: ShopifyBoxCatalogSellingPlanNodeV2[];
  };
};

export type ShopifyBoxCatalogVariantNodeV2 = {
  id: string;
  title: string;
  price?: string | null;
  objectiveMetafield?: { value: string } | null;
  mealCountMetafield?: { value: string } | null;
  sellingPlanGroups?: {
    nodes: ShopifyBoxCatalogSellingPlanGroupNodeV2[];
  } | null;
};

export type ShopifyBoxCatalogProductNodeV2 = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  mealCountMetafield?: { value: string } | null;
  variants: {
    nodes: ShopifyBoxCatalogVariantNodeV2[];
  };
};

const boxCollectionProductsV2Query = `#graphql
  query SubscriptionBoxCatalogProductsV2($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            altText
            url
          }
          mealCountMetafield: metafield(namespace: "mileyo", key: "meal_count") {
            value
          }
          variants(first: 10) {
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

type BoxCollectionProductsV2Response = {
  data?: {
    collection?: {
      products: { nodes: ShopifyBoxCatalogProductNodeV2[] };
    } | null;
  };
  errors?: { message?: string | null }[];
};

const parseBoxVariantPrice = (
  value: string | null | undefined,
): string | null => {
  if (value == null) return null;

  const trimmed = value.trim();
  return trimmed || null;
};

/**
 * Resolve the Mileyo weekly selling plan id from a variant's selling plan groups.
 * Match by exact group/plan names only — never by node order.
 */
export const resolveWeeklySellingPlanIdFromVariantGroups = (
  sellingPlanGroups:
    | { nodes: ShopifyBoxCatalogSellingPlanGroupNodeV2[] }
    | null
    | undefined,
): string | null => {
  const groups = sellingPlanGroups?.nodes ?? [];
  const weeklyGroup = groups.find(
    (group) => group.name === MILEYO_SELLING_PLAN_GROUP_NAME,
  );
  if (!weeklyGroup) {
    return null;
  }

  const weeklyPlan =
    weeklyGroup.sellingPlans?.nodes?.find(
      (sellingPlan) => sellingPlan.name === MILEYO_SELLING_PLAN_NAME,
    ) ?? null;

  return weeklyPlan?.id ?? null;
};

export const parseBoxCatalogMealCount = (
  variantMealCountValue: string | null | undefined,
  productMealCountValue: string | null | undefined,
): number | null => {
  const variantMealCount = parseMealCountMetafield(variantMealCountValue);
  if (variantMealCount !== null) {
    return variantMealCount;
  }

  return parseMealCountMetafield(productMealCountValue);
};

export const toBoxCatalogVariantV2 = (
  variant: ShopifyBoxCatalogVariantNodeV2,
  productMealCountValue: string | null | undefined,
): BoxCatalogVariantV2 => ({
  variantId: variant.id.trim(),
  variantTitle: variant.title,
  objective: parseSubscriptionObjective(variant.objectiveMetafield?.value),
  mealCount: parseBoxCatalogMealCount(
    variant.mealCountMetafield?.value,
    productMealCountValue,
  ),
  price: parseBoxVariantPrice(variant.price),
  sellingPlanId: resolveWeeklySellingPlanIdFromVariantGroups(
    variant.sellingPlanGroups,
  ),
});

export const toBoxCatalogProductV2 = (
  product: ShopifyBoxCatalogProductNodeV2,
): BoxCatalogProductV2 => ({
  id: product.id,
  title: product.title,
  imageAlt: product.featuredImage?.altText ?? product.title,
  imageUrl: product.featuredImage?.url ?? null,
  variants: (product.variants?.nodes ?? []).map((variant) =>
    toBoxCatalogVariantV2(variant, product.mealCountMetafield?.value),
  ),
});

export const toBoxCatalogProductsV2 = (
  products: ShopifyBoxCatalogProductNodeV2[],
): BoxCatalogProductV2[] => products.map(toBoxCatalogProductV2);

export const fetchBoxCatalogProductsV2 = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  boxCollectionId: string,
) => {
  const response = await admin.graphql(boxCollectionProductsV2Query, {
    variables: { id: boxCollectionId },
  });
  const json = (await response.json()) as BoxCollectionProductsV2Response;

  if (json.errors?.length) {
    throw new Error(
      json.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(" ") || "Impossible de charger le catalogue box multi-variantes.",
    );
  }

  return toBoxCatalogProductsV2(json.data?.collection?.products.nodes ?? []);
};

export type TrustedBoxCatalogVariantV2 = {
  variantId: string;
  variantTitle: string;
  objective: SubscriptionObjective;
  mealCount: number;
  price: string;
  sellingPlanId: string | null;
};

export type TrustedBoxCatalogOptionV2 = TrustedBoxCatalogVariantV2 & {
  productId: string;
  productTitle: string;
  imageAlt: string;
  imageUrl: string | null;
};

const isTrustedBoxCatalogVariantV2 = (
  variant: BoxCatalogVariantV2,
): variant is TrustedBoxCatalogVariantV2 =>
  variant.variantId.trim() !== "" &&
  variant.objective !== null &&
  variant.mealCount !== null &&
  variant.price !== null;

export const toTrustedBoxCatalogVariantV2 = (
  variant: BoxCatalogVariantV2,
): TrustedBoxCatalogVariantV2 | null =>
  isTrustedBoxCatalogVariantV2(variant) ? variant : null;

export const toTrustedBoxCatalogOptionsV2 = (
  products: BoxCatalogProductV2[],
): TrustedBoxCatalogOptionV2[] => {
  const options: TrustedBoxCatalogOptionV2[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const trustedVariant = toTrustedBoxCatalogVariantV2(variant);
      if (!trustedVariant) {
        continue;
      }

      options.push({
        ...trustedVariant,
        imageAlt: product.imageAlt,
        imageUrl: product.imageUrl,
        productId: product.id,
        productTitle: product.title,
      });
    }
  }

  return options;
};

/** Page size for Box V2 handle fetch — covers the live 18-variant product. */
export const BOX_V2_CATALOG_VARIANTS_PAGE_SIZE = 100;

export type ShopifyBoxCatalogProductGroupSummaryV2 = {
  id?: string | null;
  name: string;
};

export type ShopifyBoxCatalogSellingPlanPricingPolicyNodeV2 = {
  __typename?: string | null;
};

export type ShopifyBoxCatalogSellingPlanDetailsNodeV2 = {
  id: string;
  name: string;
  pricingPolicies?: ShopifyBoxCatalogSellingPlanPricingPolicyNodeV2[] | null;
};

export type ShopifyBoxCatalogSellingPlanGroupDetailsV2 = {
  id: string;
  name: string;
  sellingPlans?: {
    nodes: ShopifyBoxCatalogSellingPlanDetailsNodeV2[];
  } | null;
  productVariants?: {
    nodes: { id: string }[];
  } | null;
};

/**
 * QUERY A product node for handle-based Box V2 catalog.
 * Product-level sellingPlanGroups are summaries only (id/name).
 * Variants intentionally omit nested sellingPlanGroups (query-cost safe).
 */
export type ShopifyBoxCatalogProductByHandleNodeV2 = {
  id: string;
  title: string;
  handle: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  mealCountMetafield?: { value: string } | null;
  sellingPlanGroups?: {
    nodes: ShopifyBoxCatalogProductGroupSummaryV2[];
  } | null;
  variants: {
    nodes: ShopifyBoxCatalogVariantNodeV2[];
  };
};

/**
 * QUERY A — Box V2 by handle: variants + metafields + product-level group summaries.
 * Intentionally omits per-variant sellingPlanGroups (Shopify requested-cost bomb).
 */
export const BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY = `#graphql
  query BoxV2CatalogProductByHandle($query: String!) {
    products(first: 5, query: $query) {
      nodes {
        id
        title
        handle
        featuredImage {
          altText
          url
        }
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
 * QUERY B — exact Mileyo group details + attached product variants.
 * Fetched only when QUERY A finds exactly one Mileyo group.
 */
export const BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY = `#graphql
  query BoxV2CatalogSellingPlanGroupDetails($groupId: ID!, $productId: ID!) {
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

type BoxV2CatalogByHandleResponse = {
  data?: {
    products?: {
      nodes: ShopifyBoxCatalogProductByHandleNodeV2[];
    };
    sellingPlanGroup?: ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null;
  };
  errors?: { message?: string | null }[];
};

type CatalogAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, string> },
  ) => Promise<Response>;
};

const graphqlErrorMessages = (json: BoxV2CatalogByHandleResponse) =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

export type BoxV2CatalogHandleLookupResult =
  | { status: "absent"; product: null }
  | { status: "exact"; product: ShopifyBoxCatalogProductByHandleNodeV2 }
  | { status: "ambiguous"; product: null }
  | { status: "handleMismatch"; product: null };

export const resolveBoxV2CatalogProductByHandle = (
  nodes: ShopifyBoxCatalogProductByHandleNodeV2[],
): BoxV2CatalogHandleLookupResult => {
  if (nodes.length === 0) {
    return { status: "absent", product: null };
  }

  const exactHandleMatches = nodes.filter(
    (product) => product.handle === BOX_V2_PRODUCT_HANDLE,
  );

  if (exactHandleMatches.length === 0) {
    return { status: "handleMismatch", product: null };
  }

  if (exactHandleMatches.length > 1) {
    return { status: "ambiguous", product: null };
  }

  return { status: "exact", product: exactHandleMatches[0] };
};

export const collectExactMileyoCatalogGroupSummaries = (
  product: ShopifyBoxCatalogProductByHandleNodeV2,
): { id: string; name: string }[] => {
  const byId = new Map<string, { id: string; name: string }>();

  for (const group of product.sellingPlanGroups?.nodes ?? []) {
    if (group.name !== MILEYO_SELLING_PLAN_GROUP_NAME) {
      continue;
    }

    const groupId = group.id?.trim();
    if (!groupId) {
      continue;
    }

    if (!byId.has(groupId)) {
      byId.set(groupId, { id: groupId, name: group.name });
    }
  }

  return [...byId.values()];
};

export const hasCatalogSellingPlanPricingPolicies = (
  plan: ShopifyBoxCatalogSellingPlanDetailsNodeV2,
): boolean => (plan.pricingPolicies?.length ?? 0) > 0;

/**
 * Resolve a checkout-compatible Mileyo weekly plan id from QUERY B group details.
 * Returns null for 0/multiple exact plans or any pricingPolicies.
 */
export const resolveCompatibleWeeklySellingPlanIdFromGroupDetails = (
  groupDetails: ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null | undefined,
): string | null => {
  if (
    !groupDetails ||
    isBlank(groupDetails.id) ||
    groupDetails.name !== MILEYO_SELLING_PLAN_GROUP_NAME
  ) {
    return null;
  }

  const exactPlans = (groupDetails.sellingPlans?.nodes ?? []).filter(
    (plan) => plan.name === MILEYO_SELLING_PLAN_NAME,
  );

  if (exactPlans.length !== 1) {
    return null;
  }

  const plan = exactPlans[0];
  if (isBlank(plan.id) || hasCatalogSellingPlanPricingPolicies(plan)) {
    return null;
  }

  return plan.id.trim();
};

export const collectAttachedVariantIdsFromCatalogGroupDetails = (
  groupDetails: ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null | undefined,
): Set<string> => {
  const attached = new Set<string>();

  for (const variant of groupDetails?.productVariants?.nodes ?? []) {
    if (!isBlank(variant.id)) {
      attached.add(variant.id.trim());
    }
  }

  return attached;
};

/**
 * Assign sellingPlanId only to variants attached to the compatible plan.
 * Unattached / incompatible → null (trusted V2 may still keep the variant).
 */
export const applySellingPlanIdToBoxCatalogVariantsV2 = (
  variants: BoxCatalogVariantV2[],
  sellingPlanId: string | null,
  attachedVariantIds: ReadonlySet<string>,
): BoxCatalogVariantV2[] =>
  variants.map((variant) => ({
    ...variant,
    sellingPlanId:
      sellingPlanId && attachedVariantIds.has(variant.variantId)
        ? sellingPlanId
        : null,
  }));

export const buildBoxCatalogProductV2FromHandleNode = (
  product: ShopifyBoxCatalogProductByHandleNodeV2,
  groupDetails: ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null = null,
): BoxCatalogProductV2 => {
  const base = toBoxCatalogProductV2({
    id: product.id,
    title: product.title,
    featuredImage: product.featuredImage,
    mealCountMetafield: product.mealCountMetafield,
    variants: product.variants,
  });

  const groups = collectExactMileyoCatalogGroupSummaries(product);
  if (groups.length !== 1) {
    return {
      ...base,
      variants: applySellingPlanIdToBoxCatalogVariantsV2(
        base.variants,
        null,
        new Set(),
      ),
    };
  }

  const planId =
    resolveCompatibleWeeklySellingPlanIdFromGroupDetails(groupDetails);
  const attached = collectAttachedVariantIdsFromCatalogGroupDetails(
    groupDetails,
  );

  return {
    ...base,
    variants: applySellingPlanIdToBoxCatalogVariantsV2(
      base.variants,
      planId,
      attached,
    ),
  };
};

const fetchBoxV2CatalogGroupDetails = async (
  admin: CatalogAdmin,
  groupId: string,
  productId: string,
): Promise<ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null> => {
  const response = await admin.graphql(
    BOX_V2_CATALOG_SELLING_PLAN_GROUP_DETAILS_QUERY,
    {
      variables: { groupId, productId },
    },
  );
  const json = (await response.json()) as BoxV2CatalogByHandleResponse;
  const errors = graphqlErrorMessages(json);

  if (errors.length > 0) {
    throw new Error(
      errors.join(" ") ||
        "Impossible de charger le groupe d’abonnement Box V2.",
    );
  }

  return json.data?.sellingPlanGroup ?? null;
};

/**
 * Fetch the live Box Mileyo V2 product by handle (QUERY A + optional QUERY B).
 * Returns [] when the product is absent. Throws on GraphQL / ambiguous handle.
 */
export const fetchBoxCatalogProductsByHandleV2 = async (
  admin: CatalogAdmin,
): Promise<BoxCatalogProductV2[]> => {
  const response = await admin.graphql(BOX_V2_CATALOG_PRODUCT_BY_HANDLE_QUERY, {
    variables: { query: `handle:${BOX_V2_PRODUCT_HANDLE}` },
  });
  const json = (await response.json()) as BoxV2CatalogByHandleResponse;
  const errors = graphqlErrorMessages(json);

  if (errors.length > 0) {
    throw new Error(
      errors.join(" ") || "Impossible de charger le catalogue Box V2.",
    );
  }

  const lookup = resolveBoxV2CatalogProductByHandle(
    json.data?.products?.nodes ?? [],
  );

  if (lookup.status === "absent" || lookup.status === "handleMismatch") {
    return [];
  }

  if (lookup.status === "ambiguous") {
    throw new Error(
      `Plusieurs produits correspondent au handle ${BOX_V2_PRODUCT_HANDLE}.`,
    );
  }

  const product = lookup.product;
  const groups = collectExactMileyoCatalogGroupSummaries(product);
  let groupDetails: ShopifyBoxCatalogSellingPlanGroupDetailsV2 | null = null;

  if (groups.length === 1) {
    groupDetails = await fetchBoxV2CatalogGroupDetails(
      admin,
      groups[0].id,
      product.id,
    );
  }

  return [buildBoxCatalogProductV2FromHandleNode(product, groupDetails)];
};

/**
 * Trusted Box V2 options for the builder path (handle fetch).
 * sellingPlanId may still be null at this layer — filter in the builder adapter.
 */
export const fetchTrustedBoxCatalogOptionsByHandleV2 = async (
  admin: CatalogAdmin,
): Promise<TrustedBoxCatalogOptionV2[]> => {
  const products = await fetchBoxCatalogProductsByHandleV2(admin);
  return toTrustedBoxCatalogOptionsV2(products);
};
