import type { SubscriptionObjective } from "../constants/subscriptionObjective";
import {
  parseVariantCaloriesMetafield,
  parseVariantCarbsMetafield,
  parseVariantFatMetafield,
  parseVariantFiberMetafield,
  parseVariantPortionGramsMetafield,
  parseVariantProteinsMetafield,
  parseVariantSaltMetafield,
  parseVariantSaturatedFatMetafield,
  parseVariantSugarsMetafield,
} from "../utils/mealMacroMetafields";
import {
  parseAllergenesMetafield,
  parseListMetafield,
  parseMealBadges,
} from "../utils/mealMetafields";
import { parseSubscriptionObjective } from "../utils/subscriptionObjective";

export type MealCatalogVariant = {
  variantId: string;
  variantTitle: string;
  objective: SubscriptionObjective | null;
  calories: number | null;
  proteins: number | null;
  carbs: number | null;
  fat: number | null;
  saturatedFat: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  portionGrams: number | null;
};

export type MealCatalogProduct = {
  id: string;
  title: string;
  /** Admin Product.description — HTML already stripped by Shopify. */
  description: string | null;
  imageAlt: string;
  imageUrl: string | null;
  allergenes: string[];
  badges: string[];
  ingredients: string[];
  variants: MealCatalogVariant[];
};

export type ShopifyMealCatalogProductNode = {
  id: string;
  title: string;
  /** Plain-text description (HTML tags removed by Shopify Admin API). */
  description?: string | null;
  featuredImage?: { altText?: string | null; url: string } | null;
  badge1Metafield?: { value: string } | null;
  badge2Metafield?: { value: string } | null;
  badge3Metafield?: { value: string } | null;
  allergenesMetafield?: { value: string } | null;
  ingredientsMetafield?: { value: string } | null;
  variants: {
    nodes: ShopifyMealCatalogVariantNode[];
  };
};

/** Admin collection.products sort keys we use. */
export type MealCatalogSortKey = "TITLE" | "COLLECTION_DEFAULT";

export type ShopifyMealCatalogVariantNode = {
  id: string;
  title: string;
  objectiveMetafield?: { value: string } | null;
  caloriesMetafield?: { value: string } | null;
  proteinsMetafield?: { value: string } | null;
  carbsMetafield?: { value: string } | null;
  fatMetafield?: { value: string } | null;
  saturatedFatMetafield?: { value: string } | null;
  sugarsMetafield?: { value: string } | null;
  fiberMetafield?: { value: string } | null;
  saltMetafield?: { value: string } | null;
  portionGramsMetafield?: { value: string } | null;
};

const mealCollectionProductsQuery = `#graphql
  query SubscriptionMealCatalogProducts(
    $id: ID!
    $sortKey: ProductCollectionSortKeys!
    $first: Int!
    $after: String
  ) {
    collection(id: $id) {
      products(first: $first, after: $after, sortKey: $sortKey) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          description
          featuredImage {
            altText
            url
          }
          badge1Metafield: metafield(namespace: "custom", key: "badge_1") {
            value
          }
          badge2Metafield: metafield(namespace: "custom", key: "badge_2") {
            value
          }
          badge3Metafield: metafield(namespace: "custom", key: "badge_3") {
            value
          }
          allergenesMetafield: metafield(namespace: "custom", key: "allergenes") {
            value
          }
          ingredientsMetafield: metafield(namespace: "custom", key: "ingredients") {
            value
          }
          variants(first: 10) {
            nodes {
              id
              title
              objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
                value
              }
              caloriesMetafield: metafield(namespace: "custom", key: "calories") {
                value
              }
              proteinsMetafield: metafield(namespace: "custom", key: "proteins") {
                value
              }
              carbsMetafield: metafield(namespace: "custom", key: "carbs") {
                value
              }
              fatMetafield: metafield(namespace: "custom", key: "fat") {
                value
              }
              saturatedFatMetafield: metafield(
                namespace: "custom"
                key: "saturated_fat"
              ) {
                value
              }
              sugarsMetafield: metafield(namespace: "custom", key: "sugars") {
                value
              }
              fiberMetafield: metafield(namespace: "custom", key: "fiber") {
                value
              }
              saltMetafield: metafield(namespace: "custom", key: "salt") {
                value
              }
              portionGramsMetafield: metafield(
                namespace: "custom"
                key: "portion_grams"
              ) {
                value
              }
            }
          }
        }
      }
    }
  }
`;

/** Page size for meal collection product fetches (Builder / Portal / create). */
export const MEAL_CATALOG_PRODUCTS_PAGE_SIZE = 50;

/**
 * Hard ceiling for paginated meal catalog reads.
 * Never silently truncates — fails closed past this many pages.
 */
export const MEAL_CATALOG_PRODUCTS_MAX_PAGES = 20;

const mealCollectionTitlesQuery = `#graphql
  query SubscriptionMealCatalogTitles(
    $id: ID!
    $first: Int!
    $after: String
  ) {
    collection(id: $id) {
      id
      products(first: $first, after: $after, sortKey: TITLE) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
        }
      }
    }
  }
`;

type MealCollectionProductsResponse = {
  data?: {
    collection?: {
      products: {
        pageInfo?: {
          hasNextPage?: boolean | null;
          endCursor?: string | null;
        } | null;
        nodes: ShopifyMealCatalogProductNode[];
      };
    } | null;
  };
  errors?: { message?: string | null }[];
};

type MealCollectionTitlesResponse = {
  data?: {
    collection?: {
      id?: string | null;
      products?: {
        pageInfo?: {
          hasNextPage?: boolean | null;
          endCursor?: string | null;
        } | null;
        nodes?: Array<{ id: string; title: string }>;
      } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

export const toMealCatalogVariant = (
  variant: ShopifyMealCatalogVariantNode,
): MealCatalogVariant => ({
  variantId: variant.id,
  variantTitle: variant.title,
  objective: parseSubscriptionObjective(variant.objectiveMetafield?.value),
  calories: parseVariantCaloriesMetafield(variant.caloriesMetafield?.value),
  proteins: parseVariantProteinsMetafield(variant.proteinsMetafield?.value),
  carbs: parseVariantCarbsMetafield(variant.carbsMetafield?.value),
  fat: parseVariantFatMetafield(variant.fatMetafield?.value),
  saturatedFat: parseVariantSaturatedFatMetafield(
    variant.saturatedFatMetafield?.value,
  ),
  sugars: parseVariantSugarsMetafield(variant.sugarsMetafield?.value),
  fiber: parseVariantFiberMetafield(variant.fiberMetafield?.value),
  salt: parseVariantSaltMetafield(variant.saltMetafield?.value),
  portionGrams: parseVariantPortionGramsMetafield(
    variant.portionGramsMetafield?.value,
  ),
});

const normalizePlainDescription = (
  value: string | null | undefined,
): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const toMealCatalogProduct = (
  product: ShopifyMealCatalogProductNode,
): MealCatalogProduct => ({
  id: product.id,
  title: product.title,
  description: normalizePlainDescription(product.description),
  imageAlt: product.featuredImage?.altText ?? product.title,
  imageUrl: product.featuredImage?.url ?? null,
  allergenes: parseAllergenesMetafield(product.allergenesMetafield?.value),
  badges: parseMealBadges(
    product.badge1Metafield?.value,
    product.badge2Metafield?.value,
    product.badge3Metafield?.value,
  ),
  ingredients: parseListMetafield(product.ingredientsMetafield?.value),
  variants: (product.variants?.nodes ?? []).map(toMealCatalogVariant),
});

export const toMealCatalogProducts = (
  products: ShopifyMealCatalogProductNode[],
): MealCatalogProduct[] => products.map(toMealCatalogProduct);

/**
 * Load meal products from AppSettings.mealCollectionId via Admin GraphQL.
 *
 * Default sortKey TITLE preserves historical Builder ordering.
 * Pass COLLECTION_DEFAULT for storefront / theme collection order
 * (matches Liquid `collection.products` when sort is merchant/manual).
 *
 * Paginated (cursor) — never silently truncates. Fails closed past
 * MEAL_CATALOG_PRODUCTS_PAGE_SIZE × MEAL_CATALOG_PRODUCTS_MAX_PAGES.
 *
 * Note: Admin client typings in callers often declare only `{ id, sortKey? }`.
 * Pagination variables are passed at runtime (asserted) to keep those callers
 * assignable without a repo-wide Admin typing refactor.
 */
export const fetchMealCatalogProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: {
        variables?: { id: string; sortKey?: MealCatalogSortKey };
      },
    ) => Promise<Response>;
  },
  mealCollectionId: string,
  options?: { sortKey?: MealCatalogSortKey },
) => {
  const sortKey = options?.sortKey ?? "TITLE";
  const products: ShopifyMealCatalogProductNode[] = [];
  let after: string | null = null;
  let page = 0;

  while (page < MEAL_CATALOG_PRODUCTS_MAX_PAGES) {
    page += 1;
    const response = await admin.graphql(mealCollectionProductsQuery, {
      variables: {
        id: mealCollectionId,
        sortKey,
        first: MEAL_CATALOG_PRODUCTS_PAGE_SIZE,
        after,
      } as { id: string; sortKey?: MealCatalogSortKey },
    });
    const json = (await response.json()) as MealCollectionProductsResponse;

    if (json.errors?.length) {
      throw new Error(
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Impossible de charger le catalogue repas.",
      );
    }

    const connection = json.data?.collection?.products;
    for (const node of connection?.nodes ?? []) {
      if (node?.id) {
        products.push(node);
      }
    }

    if (!connection?.pageInfo?.hasNextPage) {
      return toMealCatalogProducts(products);
    }

    const endCursor = connection.pageInfo.endCursor?.trim() ?? "";
    if (!endCursor) {
      throw new Error(
        "Pagination catalogue repas incomplète (endCursor manquant).",
      );
    }
    after = endCursor;
  }

  throw new Error(
    `La collection repas dépasse ${
      MEAL_CATALOG_PRODUCTS_PAGE_SIZE * MEAL_CATALOG_PRODUCTS_MAX_PAGES
    } produits. Catalogue incomplet refusé.`,
  );
};

/**
 * Lightweight paginated title list for create-meal capacity + uniqueness gates.
 * Same pagination contract as fetchMealCatalogProducts (fail-closed, no truncate).
 */
export const fetchMealCatalogProductTitles = async (
  admin: {
    graphql: (
      query: string,
      options?: {
        variables?: { id: string; sortKey?: MealCatalogSortKey };
      },
    ) => Promise<Response>;
  },
  mealCollectionId: string,
): Promise<
  | { ok: true; titles: Array<{ id: string; title: string }> }
  | { ok: false; errors: string[] }
> => {
  if (!mealCollectionId.trim()) {
    return {
      ok: false,
      errors: ["Collection de plats manquante dans les réglages."],
    };
  }

  const titles: Array<{ id: string; title: string }> = [];
  let after: string | null = null;
  let page = 0;

  while (page < MEAL_CATALOG_PRODUCTS_MAX_PAGES) {
    page += 1;
    const response = await admin.graphql(mealCollectionTitlesQuery, {
      variables: {
        id: mealCollectionId,
        first: MEAL_CATALOG_PRODUCTS_PAGE_SIZE,
        after,
      } as { id: string; sortKey?: MealCatalogSortKey },
    });
    const json = (await response.json()) as MealCollectionTitlesResponse;

    if (json.errors?.length) {
      return {
        ok: false,
        errors: json.errors
          .map((error) => error.message)
          .filter((message): message is string => Boolean(message)),
      };
    }

    if (!json.data?.collection?.id) {
      return {
        ok: false,
        errors: ["Collection de plats introuvable dans Shopify."],
      };
    }

    const connection = json.data.collection.products;
    for (const node of connection?.nodes ?? []) {
      if (node?.id) {
        titles.push({ id: node.id, title: node.title });
      }
    }

    if (!connection?.pageInfo?.hasNextPage) {
      return { ok: true, titles };
    }

    const endCursor = connection.pageInfo.endCursor?.trim() ?? "";
    if (!endCursor) {
      return {
        ok: false,
        errors: [
          "Pagination catalogue repas incomplète (endCursor manquant).",
        ],
      };
    }
    after = endCursor;
  }

  return {
    ok: false,
    errors: [
      `La collection repas dépasse ${
        MEAL_CATALOG_PRODUCTS_PAGE_SIZE * MEAL_CATALOG_PRODUCTS_MAX_PAGES
      } produits. Opération annulée.`,
    ],
  };
};
