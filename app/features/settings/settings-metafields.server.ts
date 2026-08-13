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

/** Meal V2 PRODUCTVARIANT macros — keys match subscriptionMealCatalog 13B parsers. */
export const VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION = {
  description: "Calories de la portion pour cette variante repas.",
  key: "calories",
  name: "Calories (variante)",
  namespace: "custom",
  ownerType: "PRODUCTVARIANT",
  type: "number_integer",
} as const;

export const VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION = {
  description: "Protéines (g) de la portion pour cette variante repas.",
  key: "proteins",
  name: "Protéines (variante)",
  namespace: "custom",
  ownerType: "PRODUCTVARIANT",
  type: "number_decimal",
} as const;

export const VARIANT_MEAL_CARBS_METAFIELD_DEFINITION = {
  description: "Glucides (g) de la portion pour cette variante repas.",
  key: "carbs",
  name: "Glucides (variante)",
  namespace: "custom",
  ownerType: "PRODUCTVARIANT",
  type: "number_decimal",
} as const;

export const VARIANT_MEAL_FAT_METAFIELD_DEFINITION = {
  description: "Lipides (g) de la portion pour cette variante repas.",
  key: "fat",
  name: "Lipides (variante)",
  namespace: "custom",
  ownerType: "PRODUCTVARIANT",
  type: "number_decimal",
} as const;

export const VARIANT_MEAL_PORTION_GRAMS_METAFIELD_DEFINITION = {
  description: "Poids de portion (g) pour cette variante repas.",
  key: "portion_grams",
  name: "Portion grammes (variante)",
  namespace: "custom",
  ownerType: "PRODUCTVARIANT",
  type: "number_integer",
} as const;

/** Ordered meal V2 definitions — objective + macros. Never deletes definitions. */
export const MEAL_V2_METAFIELD_DEFINITIONS = [
  VARIANT_OBJECTIVE_METAFIELD_DEFINITION,
  VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION,
  VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION,
  VARIANT_MEAL_CARBS_METAFIELD_DEFINITION,
  VARIANT_MEAL_FAT_METAFIELD_DEFINITION,
  VARIANT_MEAL_PORTION_GRAMS_METAFIELD_DEFINITION,
] as const;

export const CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT =
  "createVariantObjectiveMetafieldDefinition" as const;

export const CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT =
  "createVariantMealCountMetafieldDefinition" as const;

export const SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT =
  "setupMealV2MetafieldDefinitions" as const;

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

type MetafieldDefinitionLookupNode = {
  id: string;
  namespace: string;
  key: string;
  ownerType: string;
  type: { name: string };
};

type MetafieldDefinitionLookupResponse = {
  data?: {
    metafieldDefinitions?: {
      nodes: MetafieldDefinitionLookupNode[];
    };
  };
  errors?: { message?: string | null }[];
};

export const METAFIELD_DEFINITION_LOOKUP_QUERY = `#graphql
  query LookupMetafieldDefinition(
    $ownerType: MetafieldOwnerType!
    $namespace: String!
    $key: String!
  ) {
    metafieldDefinitions(
      first: 5
      ownerType: $ownerType
      namespace: $namespace
      key: $key
    ) {
      nodes {
        id
        namespace
        key
        ownerType
        type {
          name
        }
      }
    }
  }
`;

export type MealV2MetafieldDefinitionItemResult = {
  alreadyExisted: boolean;
  blocked: boolean;
  created: boolean;
  errors: string[];
  key: string;
  namespace: string;
  ownerType: string;
  type: string;
};

export type SetupMealV2MetafieldDefinitionsResult = {
  alreadyPresent: number;
  blocked: number;
  created: number;
  errors: string[];
  items: MealV2MetafieldDefinitionItemResult[];
  message: string;
  ok: boolean;
};

const lookupMetafieldDefinition = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  definition: MetafieldDefinitionInput,
): Promise<{ errors: string[]; nodes: MetafieldDefinitionLookupNode[] }> => {
  const response = await admin.graphql(METAFIELD_DEFINITION_LOOKUP_QUERY, {
    variables: {
      ownerType: definition.ownerType,
      namespace: definition.namespace,
      key: definition.key,
    },
  });
  const json = (await response.json()) as MetafieldDefinitionLookupResponse;
  const errors = (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  return {
    errors,
    nodes: json.data?.metafieldDefinitions?.nodes ?? [],
  };
};

export const ensureMetafieldDefinition = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  definition: MetafieldDefinitionInput,
): Promise<MealV2MetafieldDefinitionItemResult> => {
  const base = {
    key: definition.key,
    namespace: definition.namespace,
    ownerType: definition.ownerType,
    type: definition.type,
  };

  const lookup = await lookupMetafieldDefinition(admin, definition);
  if (lookup.errors.length > 0) {
    return {
      ...base,
      alreadyExisted: false,
      blocked: true,
      created: false,
      errors: lookup.errors,
    };
  }

  if (lookup.nodes.length > 0) {
    const incompatible = lookup.nodes.find(
      (node) => node.type.name !== definition.type,
    );
    if (incompatible) {
      return {
        ...base,
        alreadyExisted: false,
        blocked: true,
        created: false,
        errors: [
          `${definition.namespace}.${definition.key} (${definition.ownerType}) existe avec le type ${incompatible.type.name}, attendu ${definition.type}.`,
        ],
      };
    }

    return {
      ...base,
      alreadyExisted: true,
      blocked: false,
      created: false,
      errors: [],
    };
  }

  const userErrors = await createMetafieldDefinition(admin, definition);
  const outcome = toMetafieldDefinitionCreateOutcome(userErrors);

  if (outcome.errors.length > 0) {
    return {
      ...base,
      alreadyExisted: false,
      blocked: true,
      created: false,
      errors: outcome.errors,
    };
  }

  return {
    ...base,
    alreadyExisted: outcome.alreadyExisted,
    blocked: false,
    created: !outcome.alreadyExisted,
    errors: [],
  };
};

export const formatMealV2MetafieldDefinitionsMessage = (
  result: Omit<SetupMealV2MetafieldDefinitionsResult, "message">,
): string =>
  `Définitions Repas V2 : ${result.created} créées, ${result.alreadyPresent} déjà présentes, ${result.blocked} bloquées.`;

export const setupMealV2MetafieldDefinitions = async (admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): Promise<SetupMealV2MetafieldDefinitionsResult> => {
  const items: MealV2MetafieldDefinitionItemResult[] = [];

  for (const definition of MEAL_V2_METAFIELD_DEFINITIONS) {
    items.push(await ensureMetafieldDefinition(admin, definition));
  }

  const created = items.filter((item) => item.created).length;
  const alreadyPresent = items.filter((item) => item.alreadyExisted).length;
  const blocked = items.filter((item) => item.blocked).length;
  const errors = items.flatMap((item) => item.errors);
  const summary = {
    alreadyPresent,
    blocked,
    created,
    errors,
    items,
    ok: blocked === 0 && errors.length === 0,
  };

  return {
    ...summary,
    message: formatMealV2MetafieldDefinitionsMessage(summary),
  };
};
