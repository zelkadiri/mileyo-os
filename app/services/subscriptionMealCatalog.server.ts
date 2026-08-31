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
  query SubscriptionMealCatalogProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        pageInfo {
          hasNextPage
        }
        nodes {
          id
          title
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

export const MEAL_CATALOG_PRODUCTS_PAGE_SIZE = 50;

type MealCollectionProductsResponse = {
  data?: {
    collection?: {
      products: {
        pageInfo?: { hasNextPage?: boolean | null } | null;
        nodes: ShopifyMealCatalogProductNode[];
      };
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

export const toMealCatalogProduct = (
  product: ShopifyMealCatalogProductNode,
): MealCatalogProduct => ({
  id: product.id,
  title: product.title,
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

export const fetchMealCatalogProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  mealCollectionId: string,
) => {
  const response = await admin.graphql(mealCollectionProductsQuery, {
    variables: { id: mealCollectionId },
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

  if (json.data?.collection?.products.pageInfo?.hasNextPage) {
    throw new Error(
      `La collection repas dépasse ${MEAL_CATALOG_PRODUCTS_PAGE_SIZE} produits. Catalogue incomplet refusé.`,
    );
  }

  return toMealCatalogProducts(json.data?.collection?.products.nodes ?? []);
};
