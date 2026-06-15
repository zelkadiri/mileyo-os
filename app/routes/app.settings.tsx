import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

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

type BoxSellingPlanProduct = {
  id: string;
  metafield?: {
    value: string;
  } | null;
  title: string;
  variants: {
    nodes: {
      id: string;
      price?: string | null;
    }[];
  };
  sellingPlanGroups: {
    nodes: {
      id: string;
      name: string;
      sellingPlans: {
        nodes: {
          id: string;
          name: string;
        }[];
      };
    }[];
  };
};

type BoxSellingPlanProductsResponse = {
  data?: {
    collection?: {
      products: {
        nodes: BoxSellingPlanProduct[];
      };
    } | null;
  };
};

type SellingPlanMutationResponse = {
  data?: {
    sellingPlanGroupCreate?: {
      userErrors: {
        field?: string[] | null;
        message: string;
      }[];
    };
    sellingPlanGroupUpdate?: {
      userErrors: {
        field?: string[] | null;
        message: string;
      }[];
    };
  };
};

type MetafieldDefinitionMutationResponse = {
  data?: {
    metafieldDefinitionCreate?: {
      createdDefinition?: {
        id: string;
      } | null;
      userErrors: {
        field?: string[] | null;
        message: string;
      }[];
    };
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

const boxSellingPlanProductsQuery = `#graphql
  query BoxSellingPlanProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          metafield(namespace: "mileyo", key: "subscription_price") {
            value
          }
          title
          variants(first: 1) {
            nodes {
              id
              price
            }
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
`;

const metafieldDefinitionCreateMutation = `#graphql
  mutation CreateSubscriptionPriceMetafieldDefinition(
    $definition: MetafieldDefinitionInput!
  ) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const sellingPlanGroupCreateMutation = `#graphql
  mutation CreateWeeklySellingPlanGroup(
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput!
  ) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      userErrors {
        field
        message
      }
    }
  }
`;

const sellingPlanGroupUpdateMutation = `#graphql
  mutation UpdateWeeklySellingPlanGroup(
    $id: ID!
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput!
  ) {
    sellingPlanGroupUpdate(id: $id, input: $input, resources: $resources) {
      userErrors {
        field
        message
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

const getBoxProductsForSellingPlans = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  id: string,
) => {
  const response = await admin.graphql(boxSellingPlanProductsQuery, {
    variables: { id },
  });
  const json = (await response.json()) as BoxSellingPlanProductsResponse;

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

const weeklySellingPlanGroupName = "Mileyo abonnement hebdomadaire";
const weeklySellingPlanName = "Abonnement hebdomadaire";

const parsePrice = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const price = Number.parseFloat(value.replace(",", "."));

  return Number.isNaN(price) ? null : price;
};

const getSellingPlanInput = (
  fixedDiscountAmount: number,
  existingSellingPlanId?: string,
) => {
  const sellingPlanInput = {
    billingPolicy: {
      recurring: {
        interval: "WEEK",
        intervalCount: 1,
      },
    },
    category: "SUBSCRIPTION",
    deliveryPolicy: {
      recurring: {
        interval: "WEEK",
        intervalCount: 1,
      },
    },
    name: weeklySellingPlanName,
    options: ["Hebdomadaire"],
    pricingPolicies: [
      {
        fixed: {
          adjustmentType: "FIXED_AMOUNT",
          adjustmentValue: {
            fixedValue: fixedDiscountAmount.toFixed(2),
          },
        },
      },
    ],
  };

  return {
    merchantCode: weeklySellingPlanGroupName,
    name: weeklySellingPlanGroupName,
    options: ["Fréquence"],
    ...(existingSellingPlanId
      ? {
          sellingPlansToUpdate: [
            {
              id: existingSellingPlanId,
              ...sellingPlanInput,
            },
          ],
        }
      : {
          sellingPlansToCreate: [sellingPlanInput],
        }),
  };
};

const createOrUpdateWeeklySellingPlans = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  boxCollectionId: string,
) => {
  const products = await getBoxProductsForSellingPlans(admin, boxCollectionId);
  const errors: string[] = [];
  let processedCount = 0;

  for (const product of products) {
    const firstVariant = product.variants.nodes[0];
    const variantId = firstVariant?.id;
    const variantPrice = parsePrice(firstVariant?.price);
    const subscriptionPrice = parsePrice(product.metafield?.value);

    if (!variantId) {
      errors.push(`${product.title}: aucune variante disponible.`);
      continue;
    }

    if (variantPrice === null) {
      errors.push(`${product.title}: prix de variante invalide ou manquant.`);
      continue;
    }

    if (subscriptionPrice === null) {
      errors.push(
        `${product.title}: metafield mileyo.subscription_price manquant.`,
      );
      continue;
    }

    const fixedDiscountAmount = variantPrice - subscriptionPrice;

    if (fixedDiscountAmount <= 0) {
      errors.push(
        `${product.title}: le prix abonnement doit être inférieur au prix achat unique.`,
      );
      continue;
    }

    const existingGroup = product.sellingPlanGroups.nodes.find(
      (group) => group.name === weeklySellingPlanGroupName,
    );
    const existingSellingPlan = existingGroup?.sellingPlans.nodes.find(
      (sellingPlan) => sellingPlan.name === weeklySellingPlanName,
    );
    const variables = {
      input: getSellingPlanInput(fixedDiscountAmount, existingSellingPlan?.id),
      resources: {
        productIds: [product.id],
        productVariantIds: [variantId],
      },
      ...(existingGroup ? { id: existingGroup.id } : {}),
    };
    const response = await admin.graphql(
      existingGroup
        ? sellingPlanGroupUpdateMutation
        : sellingPlanGroupCreateMutation,
      { variables },
    );
    const json = (await response.json()) as SellingPlanMutationResponse;
    const userErrors =
      json.data?.sellingPlanGroupCreate?.userErrors ??
      json.data?.sellingPlanGroupUpdate?.userErrors ??
      [];

    if (userErrors.length > 0) {
      errors.push(
        `${product.title}: ${userErrors.map((error) => error.message).join(", ")}`,
      );
      continue;
    }

    processedCount += 1;
  }

  return { errors, processedCount };
};

const createSubscriptionPriceMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) => {
  const response = await admin.graphql(metafieldDefinitionCreateMutation, {
    variables: {
      definition: {
        key: "subscription_price",
        name: "Prix abonnement",
        namespace: "mileyo",
        ownerType: "PRODUCT",
        type: "number_decimal",
      },
    },
  });
  const json = (await response.json()) as MetafieldDefinitionMutationResponse;
  const userErrors =
    json.data?.metafieldDefinitionCreate?.userErrors.map(
      (error) => error.message,
    ) ?? [];

  return userErrors;
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
  const intent = getFormString(formData, "intent");

  if (intent === "createSubscriptionPriceMetafieldDefinition") {
    const errors = await createSubscriptionPriceMetafieldDefinition(admin);

    return {
      errors,
      message:
        errors.length === 0
          ? "Définition de metafield Prix abonnement créée."
          : "La définition existe peut-être déjà ou Shopify a retourné un avertissement.",
      ok: errors.length === 0,
    };
  }

  if (intent === "setupWeeklySellingPlans") {
    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    if (!settings?.boxCollectionId) {
      return {
        errors: ["Sélectionnez une collection de box avant de créer les abonnements."],
        ok: false,
      };
    }

    const result = await createOrUpdateWeeklySellingPlans(
      admin,
      settings.boxCollectionId,
    );

    return {
      errors: result.errors,
      message: `${result.processedCount} produit(s) box traité(s).`,
      ok: result.errors.length === 0,
    };
  }

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
  const actionData = useActionData<typeof action>();
  const { boxProducts, collections, mealProducts, settings, shop } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Réglages">
      <s-section heading="Collections Shopify">
        <s-stack gap="base">
          <s-text>Shop : {shop}</s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="saveSettings" />
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
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="createSubscriptionPriceMetafieldDefinition"
            />
            <s-button type="submit">
              Créer le champ Prix abonnement
            </s-button>
          </Form>
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="setupWeeklySellingPlans"
            />
            <s-button type="submit">
              Créer / mettre à jour les abonnements hebdomadaires
            </s-button>
          </Form>
          {actionData?.message ? <s-text>{actionData.message}</s-text> : null}
          {actionData?.errors?.length ? (
            <s-unordered-list>
              {actionData.errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          ) : null}
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
