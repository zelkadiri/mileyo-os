import {
  parseMealCountMetafield,
  warnMissingMealCountMetafield,
} from "../../utils/mealCountMetafield";
import type {
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
            namespace: "mileyo"
            key: "subscription_price"
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

/** Meal collection products — no mileyo.meal_count validation or warnings. */
export const toBuilderMeals = (products: ShopifyProduct[]): BuilderProduct[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      mealCount: null,
      sellingPlanId: null,
      subscriptionPrice: null,
      title: product.title,
      variantId: firstVariant?.id ?? "",
      variantPrice: firstVariant?.price ?? null,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });
