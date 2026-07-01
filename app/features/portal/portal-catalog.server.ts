import type { PortalMeal } from "./portal-types";

type ShopifyProduct = {
  id: string;
  title: string;
  featuredImage?: { altText?: string | null; url: string } | null;
  variants: {
    nodes: {
      id: string;
      title: string;
    }[];
  };
};

type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: { nodes: ShopifyProduct[] };
    } | null;
  };
};

const collectionProductsQuery = `#graphql
  query PortalMealProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            altText
            url
          }
          variants(first: 1) {
            nodes {
              id
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

export const toPortalMeals = (products: ShopifyProduct[]): PortalMeal[] =>
  products.map((product) => {
    const firstVariant = product.variants.nodes[0];

    return {
      id: product.id,
      imageAlt: product.featuredImage?.altText ?? product.title,
      imageUrl: product.featuredImage?.url ?? null,
      title: product.title,
      variantTitle: firstVariant?.title ?? "Variante standard",
    };
  });
