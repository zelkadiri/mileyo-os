import {
  MILEYO_SELLING_PLAN_GROUP_NAME,
  MILEYO_SELLING_PLAN_NAME,
} from "../../constants/subscriptionSellingPlan";
import type {
  BoxSellingPlanProductsResponse,
  SellingPlanMutationResponse,
} from "./settings-types";

const boxSellingPlanProductsQuery = `#graphql
  query BoxSellingPlanProducts($id: ID!) {
    collection(id: $id) {
      products(first: 50, sortKey: TITLE) {
        nodes {
          id
          metafield(namespace: "custom", key: "prix_abonnement") {
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
  ) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

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
    name: MILEYO_SELLING_PLAN_NAME,
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
    merchantCode: MILEYO_SELLING_PLAN_GROUP_NAME,
    name: MILEYO_SELLING_PLAN_GROUP_NAME,
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

export const createOrUpdateWeeklySellingPlans = async (
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
        `${product.title}: metafield custom.prix_abonnement manquant.`,
      );
      continue;
    }

    const fixedDiscountAmount = variantPrice - subscriptionPrice;

    if (fixedDiscountAmount < 0) {
      errors.push(
        `${product.title}: le prix abonnement ne peut pas dépasser le prix achat unique.`,
      );
      continue;
    }

    const existingGroup = product.sellingPlanGroups.nodes.find(
      (group) => group.name === MILEYO_SELLING_PLAN_GROUP_NAME,
    );
    const existingSellingPlan = existingGroup?.sellingPlans.nodes.find(
      (sellingPlan) => sellingPlan.name === MILEYO_SELLING_PLAN_NAME,
    );
    const input = getSellingPlanInput(fixedDiscountAmount, existingSellingPlan?.id);
    const response = await admin.graphql(
      existingGroup
        ? sellingPlanGroupUpdateMutation
        : sellingPlanGroupCreateMutation,
      {
        variables: existingGroup
          ? { id: existingGroup.id, input }
          : {
              input,
              resources: {
                productIds: [product.id],
                productVariantIds: [variantId],
              },
            },
      },
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
