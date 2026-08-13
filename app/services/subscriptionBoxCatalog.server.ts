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
