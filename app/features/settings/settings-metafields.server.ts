import type { MetafieldDefinitionMutationResponse } from "./settings-types";

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

export const createSubscriptionPriceMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) => {
  const response = await admin.graphql(metafieldDefinitionCreateMutation, {
    variables: {
      definition: {
        key: "prix_abonnement",
        name: "Prix abonnement",
        namespace: "custom",
        ownerType: "PRODUCT",
        type: "number_integer",
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

export const createMealCountMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) => {
  const response = await admin.graphql(metafieldDefinitionCreateMutation, {
    variables: {
      definition: {
        description:
          "Nombre de repas inclus dans cette box Mileyo.",
        key: "meal_count",
        name: "Nombre de repas",
        namespace: "mileyo",
        ownerType: "PRODUCT",
        type: "number_integer",
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
