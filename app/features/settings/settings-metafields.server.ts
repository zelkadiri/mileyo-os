import type { MetafieldDefinitionMutationResponse } from "./settings-types";

/** Legacy PRODUCT definition — mileyo.meal_count (unchanged contract). */
export const PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION = {
  description: "Nombre de repas inclus dans cette box Mileyo.",
  key: "meal_count",
  name: "Nombre de repas",
  namespace: "mileyo",
  ownerType: "PRODUCT",
  type: "number_integer",
} as const;

/** V2 PRODUCTVARIANT definition — mileyo.objective. */
export const VARIANT_OBJECTIVE_METAFIELD_DEFINITION = {
  description: "Objectif nutritionnel associé à cette variante produit.",
  key: "objective",
  name: "Objectif",
  namespace: "mileyo",
  ownerType: "PRODUCTVARIANT",
  type: "single_line_text_field",
} as const;

/** V2 PRODUCTVARIANT definition — mileyo.meal_count (coexists with PRODUCT). */
export const VARIANT_MEAL_COUNT_METAFIELD_DEFINITION = {
  description: "Nombre de repas associé à cette variante box Mileyo.",
  key: "meal_count",
  name: "Nombre de repas",
  namespace: "mileyo",
  ownerType: "PRODUCTVARIANT",
  type: "number_integer",
} as const;

export const CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT =
  "createVariantObjectiveMetafieldDefinition" as const;

export const CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT =
  "createVariantMealCountMetafieldDefinition" as const;

type MetafieldDefinitionInput = {
  description?: string;
  key: string;
  name: string;
  namespace: string;
  ownerType: string;
  type: string;
};

type MetafieldDefinitionUserError = {
  code?: string | null;
  field?: string[] | null;
  message: string;
};

export type MetafieldDefinitionCreateOutcome = {
  alreadyExisted: boolean;
  errors: string[];
};

const metafieldDefinitionCreateMutation = `#graphql
  mutation CreateMetafieldDefinition(
    $definition: MetafieldDefinitionInput!
  ) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/** Reliable Shopify code for an already-existing metafield definition. */
export const isMetafieldDefinitionAlreadyExistsError = (
  error: MetafieldDefinitionUserError,
): boolean => error.code === "TAKEN";

export const toMetafieldDefinitionCreateOutcome = (
  userErrors: MetafieldDefinitionUserError[],
): MetafieldDefinitionCreateOutcome => {
  const blockingErrors = userErrors.filter(
    (error) => !isMetafieldDefinitionAlreadyExistsError(error),
  );
  const alreadyExisted =
    userErrors.length > 0 && blockingErrors.length === 0;

  return {
    alreadyExisted,
    errors: blockingErrors.map((error) => error.message),
  };
};

const createMetafieldDefinition = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  definition: MetafieldDefinitionInput,
): Promise<MetafieldDefinitionUserError[]> => {
  const response = await admin.graphql(metafieldDefinitionCreateMutation, {
    variables: { definition },
  });
  const json = (await response.json()) as MetafieldDefinitionMutationResponse;

  return json.data?.metafieldDefinitionCreate?.userErrors ?? [];
};

export const createSubscriptionPriceMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) => {
  const userErrors = await createMetafieldDefinition(admin, {
    key: "prix_abonnement",
    name: "Prix abonnement",
    namespace: "custom",
    ownerType: "PRODUCT",
    type: "number_integer",
  });

  return userErrors.map((error) => error.message);
};

export const createMealCountMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) => {
  const userErrors = await createMetafieldDefinition(
    admin,
    PRODUCT_MEAL_COUNT_METAFIELD_DEFINITION,
  );

  return userErrors.map((error) => error.message);
};

export const createVariantObjectiveMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): Promise<MetafieldDefinitionCreateOutcome> => {
  const userErrors = await createMetafieldDefinition(
    admin,
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION,
  );

  return toMetafieldDefinitionCreateOutcome(userErrors);
};

export const createVariantMealCountMetafieldDefinition = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): Promise<MetafieldDefinitionCreateOutcome> => {
  const userErrors = await createMetafieldDefinition(
    admin,
    VARIANT_MEAL_COUNT_METAFIELD_DEFINITION,
  );

  return toMetafieldDefinitionCreateOutcome(userErrors);
};
