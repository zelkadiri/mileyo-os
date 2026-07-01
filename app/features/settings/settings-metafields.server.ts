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
