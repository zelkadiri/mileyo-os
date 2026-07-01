import prisma from "../../db.server";
import type {
  CollectionProductsResponse,
  CollectionResponse,
  CollectionsResponse,
  ShopifyCollection,
  ShopifyProduct,
} from "./settings-types";

const collectionsQuery = `#graphql
  query MealCatalogCollections {
    collections(first: 100, sortKey: TITLE) {
      nodes {
        id
        handle
        title
      }
    }
  }
`;

const collectionQuery = `#graphql
  query MealCatalogCollection($id: ID!) {
    collection(id: $id) {
      id
      handle
      title
    }
  }
`;

const collectionProductsQuery = `#graphql
  query MealCatalogProducts($id: ID!) {
    collection(id: $id) {
      products(first: 20, sortKey: TITLE) {
        nodes {
          id
          title
          handle
          status
          publishedAt
          featuredImage {
            altText
            url
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

export const getCollections = async (admin: {
  graphql: (query: string) => Promise<Response>;
}) => {
  const response = await admin.graphql(collectionsQuery);
  const json = (await response.json()) as CollectionsResponse;

  return json.data?.collections?.nodes ?? [];
};

export const getCollection = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
) => {
  const response = await admin.graphql(collectionQuery, {
    variables: { id },
  });
  const json = (await response.json()) as CollectionResponse;

  return json.data?.collection ?? null;
};

export const getCollectionProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id?: string | null,
): Promise<ShopifyProduct[]> => {
  if (!id) {
    return [];
  }

  const response = await admin.graphql(collectionProductsQuery, {
    variables: { id },
  });
  const json = (await response.json()) as CollectionProductsResponse;

  return json.data?.collection?.products.nodes ?? [];
};

export const getFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

export const getSelectedCollection = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
): Promise<ShopifyCollection | null> => {
  if (!id) {
    return null;
  }

  const collection = await getCollection(admin, id);

  if (!collection) {
    throw new Response("Collection not found", { status: 404 });
  }

  return collection;
};

export const loadSettingsPageData = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  shop: string,
) => {
  const settings = await prisma.appSettings.upsert({
    create: { shop },
    update: {},
    where: { shop },
  });
  const collections = await getCollections(admin);
  const [boxProducts, mealProducts] = await Promise.all([
    getCollectionProducts(admin, settings.boxCollectionId),
    getCollectionProducts(admin, settings.mealCollectionId),
  ]);

  return { boxProducts, collections, mealProducts, settings, shop };
};
