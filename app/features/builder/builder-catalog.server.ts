import {
  fetchTrustedBoxCatalogOptionsByHandleV2,
  type TrustedBoxCatalogOptionV2,
} from "../../services/subscriptionBoxCatalog.server";
import {
  parseAllergenesMetafield,
  parseCaloriesMetafield,
  parseListMetafield,
  parseMealBadges,
} from "../../utils/mealMetafields";
import {
  parseMealCountMetafield,
  warnMissingMealCountMetafield,
} from "../../utils/mealCountMetafield";
import type {
  BuilderBoxOption,
  BuilderMeal,
  BuilderProduct,
  CollectionProductsResponse,
  ShopifyProduct,
} from "./builder-types";

const collectionProductsQuery = `#graphql
  query BoxBuilderProducts($id: ID!) {
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
          caloriesMetafield: metafield(namespace: "custom", key: "calories") {
            value
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

export const getCollectionProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
) => {
  const response = await admin.graphql(collectionProductsQuery, {
    variables: { id },
  });
  const json = (await response.json()) as CollectionProductsResponse;

  return json.data?.collection?.products.nodes ?? [];
};

/** @deprecated Legacy one-product-per-box adapter — kept for historical callers/tests. */
export const toBuilderProducts = (products: ShopifyProduct[]): BuilderProduct[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];
    const mealCount = parseMealCountMetafield(
      product.mealCountMetafield?.value,
    );

    if (mealCount === null) {
      warnMissingMealCountMetafield(product.id, product.title);
    }

    const weeklySellingPlanGroup = product.sellingPlanGroups?.nodes.find(
      (group) => group.name === "Mileyo abonnement hebdomadaire",
    );
    const weeklySellingPlan =
      weeklySellingPlanGroup?.sellingPlans.nodes.find(
        (sellingPlan) => sellingPlan.name === "Abonnement hebdomadaire",
      ) ?? null;

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      mealCount,
      sellingPlanId: weeklySellingPlan?.id ?? null,
      subscriptionPrice: product.subscriptionPriceMetafield?.value ?? null,
      title: product.title,
      variantId: firstVariant?.id ?? "",
      variantPrice: firstVariant?.price ?? null,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });

/**
 * Checkout-ready builder options — requires a non-null sellingPlanId.
 * Does not silently harden TrustedBoxCatalogOptionV2 (13C contract preserved).
 */
export const toBuilderBoxOptions = (
  options: TrustedBoxCatalogOptionV2[],
): BuilderBoxOption[] => {
  const builderOptions: BuilderBoxOption[] = [];

  for (const option of options) {
    if (!option.sellingPlanId) {
      continue;
    }

    builderOptions.push({
      mealCount: option.mealCount,
      objective: option.objective,
      price: option.price,
      productId: option.productId,
      productTitle: option.productTitle,
      sellingPlanId: option.sellingPlanId,
      variantId: option.variantId,
      variantTitle: option.variantTitle,
    });
  }

  return builderOptions.sort((left, right) => {
    if (left.objective !== right.objective) {
      return left.objective.localeCompare(right.objective);
    }
    return left.mealCount - right.mealCount;
  });
};

export const fetchBuilderBoxOptions = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, string> },
  ) => Promise<Response>;
}): Promise<BuilderBoxOption[]> => {
  const trusted = await fetchTrustedBoxCatalogOptionsByHandleV2(admin);
  return toBuilderBoxOptions(trusted);
};

/** Meal collection products — no mileyo.meal_count validation or warnings. */
export const toBuilderMeals = (products: ShopifyProduct[]): BuilderMeal[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];

    return {
      allergenes: parseAllergenesMetafield(product.allergenesMetafield?.value),
      badges: parseMealBadges(
        product.badge1Metafield?.value,
        product.badge2Metafield?.value,
        product.badge3Metafield?.value,
      ),
      calories: parseCaloriesMetafield(product.caloriesMetafield?.value),
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      ingredients: parseListMetafield(product.ingredientsMetafield?.value),
      title: product.title,
      variantId: firstVariant?.id ?? "",
      variantPrice: firstVariant?.price ?? null,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });
