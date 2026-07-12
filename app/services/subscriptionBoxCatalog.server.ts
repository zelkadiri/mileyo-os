import {
  parseMealCountMetafield,
  warnMissingMealCountMetafield,
} from "../utils/mealCountMetafield";

export const MILEYO_SELLING_PLAN_GROUP_NAME = "Mileyo abonnement hebdomadaire";
export const MILEYO_SELLING_PLAN_NAME = "Abonnement hebdomadaire";

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
