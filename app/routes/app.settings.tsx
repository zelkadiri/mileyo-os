import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type ShopifyCollection = {
  id: string;
  handle: string;
  title: string;
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status?: string | null;
  publishedAt?: string | null;
  featuredImage?: {
    altText?: string | null;
    url: string;
  } | null;
  variants: {
    nodes: {
      id: string;
      price?: string | null;
      title: string;
    }[];
  };
};

type CollectionsResponse = {
  data?: {
    collections?: {
      nodes: ShopifyCollection[];
    };
  };
};

type CollectionResponse = {
  data?: {
    collection?: ShopifyCollection | null;
  };
};

type CollectionProductsResponse = {
  data?: {
    collection?: {
      products: {
        nodes: ShopifyProduct[];
      };
    } | null;
  };
};

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

const getCollections = async (admin: {
  graphql: (query: string) => Promise<Response>;
}) => {
  const response = await admin.graphql(collectionsQuery);
  const json = (await response.json()) as CollectionsResponse;

  return json.data?.collections?.nodes ?? [];
};

const getCollection = async (
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

const getCollectionProducts = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id?: string | null,
) => {
  if (!id) {
    return [];
  }

  const response = await admin.graphql(collectionProductsQuery, {
    variables: { id },
  });
  const json = (await response.json()) as CollectionProductsResponse;

  return json.data?.collection?.products.nodes ?? [];
};

const getFormString = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const getSelectedCollection = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
) => {
  if (!id) {
    return null;
  }

  const collection = await getCollection(admin, id);

  if (!collection) {
    throw new Response("Collection not found", { status: 404 });
  }

  return collection;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
  const collections = await getCollections(admin);
  const [boxProducts, mealProducts] = await Promise.all([
    getCollectionProducts(admin, settings.boxCollectionId),
    getCollectionProducts(admin, settings.mealCollectionId),
  ]);

  return { boxProducts, collections, mealProducts, settings, shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const boxCollectionId = getFormString(formData, "boxCollectionId");
  const mealCollectionId = getFormString(formData, "mealCollectionId");
  const [boxCollection, mealCollection] = await Promise.all([
    getSelectedCollection(admin, boxCollectionId),
    getSelectedCollection(admin, mealCollectionId),
  ]);

  await prisma.appSettings.upsert({
    where: { shop },
    update: {
      boxCollectionHandle: boxCollection?.handle ?? null,
      boxCollectionId: boxCollection?.id ?? null,
      boxCollectionTitle: boxCollection?.title ?? null,
      mealCollectionHandle: mealCollection?.handle ?? null,
      mealCollectionId: mealCollection?.id ?? null,
      mealCollectionTitle: mealCollection?.title ?? null,
    },
    create: {
      shop,
      boxCollectionHandle: boxCollection?.handle ?? null,
      boxCollectionId: boxCollection?.id ?? null,
      boxCollectionTitle: boxCollection?.title ?? null,
      mealCollectionHandle: mealCollection?.handle ?? null,
      mealCollectionId: mealCollection?.id ?? null,
      mealCollectionTitle: mealCollection?.title ?? null,
    },
  });

  return { ok: true };
};

const fieldStyle = {
  display: "grid",
  gap: "0.25rem",
} as const;

const selectStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "0.5rem",
  font: "inherit",
  padding: "0.6rem 0.75rem",
} as const;

const productGridStyle = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
} as const;

const productImageStyle = {
  borderRadius: "0.5rem",
  height: "96px",
  objectFit: "cover",
  width: "96px",
} as const;

function ProductPreview({
  emptyMessage,
  products,
  showVariantPrice = false,
}: {
  emptyMessage: string;
  products: ShopifyProduct[];
  showVariantPrice?: boolean;
}) {
  if (products.length === 0) {
    return <s-text>{emptyMessage}</s-text>;
  }

  return (
    <div style={productGridStyle}>
      {products.map((product) => {
        const firstVariant = product.variants.nodes[0];

        return (
          <s-box
            key={product.id}
            borderRadius="base"
            borderWidth="base"
            padding="base"
          >
            <s-stack gap="small">
              {product.featuredImage ? (
                <img
                  alt={product.featuredImage.altText ?? product.title}
                  src={product.featuredImage.url}
                  style={productImageStyle}
                />
              ) : null}
              <s-text>
                <strong>{product.title}</strong>
              </s-text>
              <s-text>Handle : {product.handle}</s-text>
              <s-text>
                Variante ID : {firstVariant?.id ?? "Aucune variante"}
              </s-text>
              <s-text>
                Variante titre : {firstVariant?.title ?? "Aucune variante"}
              </s-text>
              {showVariantPrice ? (
                <s-text>
                  Variante prix : {firstVariant?.price ?? "Non disponible"}
                </s-text>
              ) : (
                <>
                  <s-text>
                    Status : {product.status ?? "Non disponible"}
                  </s-text>
                  <s-text>
                    Publication : {product.publishedAt ? "Publié" : "Non publié"}
                  </s-text>
                </>
              )}
            </s-stack>
          </s-box>
        );
      })}
    </div>
  );
}

export default function Settings() {
  const { boxProducts, collections, mealProducts, settings, shop } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Réglages">
      <s-section heading="Collections Shopify">
        <s-stack gap="base">
          <s-text>Shop : {shop}</s-text>
          <Form method="post">
            <s-stack gap="base">
              <label style={fieldStyle}>
                Collection des box
                <select
                  defaultValue={settings.boxCollectionId ?? ""}
                  name="boxCollectionId"
                  style={selectStyle}
                >
                  <option value="">Aucune collection sélectionnée</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.title}
                    </option>
                  ))}
                </select>
              </label>
              <s-text>
                Les produits de cette collection seront utilisés comme box dans
                le builder client.
              </s-text>
              <label style={fieldStyle}>
                Collection de plats
                <select
                  defaultValue={settings.mealCollectionId ?? ""}
                  name="mealCollectionId"
                  style={selectStyle}
                >
                  <option value="">Aucune collection sélectionnée</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.title}
                    </option>
                  ))}
                </select>
              </label>
              <s-button type="submit">Enregistrer</s-button>
            </s-stack>
          </Form>
          {settings.boxCollectionTitle ? (
            <s-text>
              Collection des box :{" "}
              <strong>{settings.boxCollectionTitle}</strong> (
              {settings.boxCollectionHandle})
            </s-text>
          ) : (
            <s-text>Aucune collection de box n’est configurée.</s-text>
          )}
          {settings.mealCollectionTitle ? (
            <s-text>
              Collection de plats :{" "}
              <strong>{settings.mealCollectionTitle}</strong> (
              {settings.mealCollectionHandle})
            </s-text>
          ) : (
            <s-text>Aucune collection de plats n’est configurée.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Aperçu des plats">
        <ProductPreview
          emptyMessage="Sélectionnez une collection de plats contenant des produits pour afficher un aperçu."
          products={mealProducts}
        />
      </s-section>

      <s-section heading="Aperçu des box">
        <ProductPreview
          emptyMessage="Sélectionnez une collection de box contenant des produits pour afficher un aperçu."
          products={boxProducts}
          showVariantPrice
        />
      </s-section>
    </s-page>
  );
}
