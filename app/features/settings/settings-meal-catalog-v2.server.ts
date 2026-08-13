/**
 * Meal catalog V2 provisioning — in-place conversion of legacy mono-variant recipes.
 *
 * Uses productSet WITH product id to replace Default Title → Objectif × 3 variants.
 * Omits title/handle/status/collections/media/product metafields so they are preserved.
 * Never invents macro values. Never mutates automatically — Settings action only.
 */

import {
  MEAL_V2_CLASSIFICATION,
  MEAL_V2_EXPECTED_VARIANT_COUNT,
  MEAL_V2_OBJECTIVE_METAFIELD,
  MEAL_V2_VARIANT_PRICE,
  SHOPIFY_DEFAULT_OPTION_NAME,
  getMealV2VariantSpecs,
  type MealV2Classification,
  type MealV2VariantSpec,
} from "../../constants/subscriptionMealCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";

export const SETUP_V2_MEAL_CATALOG_INTENT = "setupV2MealCatalog" as const;

export const MEAL_V2_COLLECTION_PRODUCTS_PAGE_SIZE = 50;

type SettingsAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type MealV2CatalogProductSnapshot = {
  id: string;
  title: string;
  handle: string;
  status: string;
  options: {
    id?: string | null;
    name: string;
    values: { name: string }[];
  }[];
  variants: {
    id: string;
    title: string;
    price?: string | null;
    selectedOptions: { name: string; value: string }[];
    objectiveMetafield?: { value?: string | null } | null;
  }[];
};

export type MealV2ClassifyResult = {
  classification: MealV2Classification;
  productId: string;
  reasons: string[];
  title: string;
};

export type MealV2ProductSetVariantInput = {
  optionValues: { optionName: string; name: string }[];
  price: string;
  metafields: {
    namespace: string;
    key: string;
    type: string;
    value: string;
  }[];
};

/** Update payload — intentionally omits title/handle/status/collections/media. */
export type MealV2ProductSetInput = {
  id: string;
  productOptions: {
    name: string;
    position: number;
    values: { name: string }[];
  }[];
  variants: MealV2ProductSetVariantInput[];
};

export type SetupV2MealCatalogResult = {
  alreadyConfigured: number;
  blocked: number;
  converted: number;
  errors: string[];
  ignored: number;
  items: MealV2ClassifyResult[];
  message: string;
  ok: boolean;
};

type GraphqlProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  options?: {
    id?: string | null;
    name: string;
    values?: unknown;
    optionValues?: { name: string }[] | null;
  }[];
  variants?: {
    nodes: MealV2CatalogProductSnapshot["variants"];
  };
};

type GraphqlErrorResponse = {
  data?: {
    collection?: {
      id?: string | null;
      title?: string | null;
      products?: {
        pageInfo?: { hasNextPage?: boolean | null } | null;
        nodes: GraphqlProductNode[];
      } | null;
    } | null;
    productSet?: {
      product?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message: string }[];
    };
  };
  errors?: { message?: string | null }[];
};

export const MEAL_V2_COLLECTION_PRODUCTS_QUERY = `#graphql
  query MealV2CollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      id
      title
      products(first: $first, sortKey: TITLE) {
        pageInfo {
          hasNextPage
        }
        nodes {
          id
          title
          handle
          status
          options {
            id
            name
            values
            optionValues {
              name
            }
          }
          variants(first: 10) {
            nodes {
              id
              title
              price
              selectedOptions {
                name
                value
              }
              objectiveMetafield: metafield(namespace: "mileyo", key: "objective") {
                value
              }
            }
          }
        }
      }
    }
  }
`;

export const MEAL_V2_PRODUCT_SET_UPDATE_MUTATION = `#graphql
  mutation UpdateMealV2CatalogProduct(
    $input: ProductSetInput!
    $synchronous: Boolean!
  ) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        handle
        status
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const graphqlErrorMessages = (json: GraphqlErrorResponse) =>
  (json.errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

const isBlank = (value: string | null | undefined) =>
  value == null || value.trim() === "";

const normalizePrice = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2);
};

const optionValuesFromShopify = (values: unknown): { name: string }[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (typeof value === "string") return { name: value };
      if (
        value &&
        typeof value === "object" &&
        "name" in value &&
        typeof (value as { name: unknown }).name === "string"
      ) {
        return { name: (value as { name: string }).name };
      }
      return null;
    })
    .filter((value): value is { name: string } => value !== null);
};

export const toMealV2CatalogProductSnapshot = (
  node: GraphqlProductNode,
): MealV2CatalogProductSnapshot => ({
  id: node.id,
  title: node.title,
  handle: node.handle,
  status: node.status,
  options: (node.options ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    values:
      option.optionValues && option.optionValues.length > 0
        ? option.optionValues.map((value) => ({ name: value.name }))
        : optionValuesFromShopify(option.values),
  })),
  variants: node.variants?.nodes ?? [],
});

const selectedOptionValue = (
  selectedOptions: { name: string; value: string }[],
  optionName: string,
) =>
  selectedOptions.find((option) => option.name === optionName)?.value ?? null;

const hasAnyObjectiveMetafield = (
  product: MealV2CatalogProductSnapshot,
): boolean =>
  product.variants.some(
    (variant) => !isBlank(variant.objectiveMetafield?.value ?? null),
  );

const isLegacyDefaultOptionStructure = (
  product: MealV2CatalogProductSnapshot,
): boolean => {
  if (product.options.length !== 1) {
    return false;
  }

  const option = product.options[0];
  if (option.name !== SHOPIFY_DEFAULT_OPTION_NAME) {
    return false;
  }

  if (option.values.length !== 1) {
    return false;
  }

  return product.variants.length === 1;
};

const validateAlreadyConfigured = (
  product: MealV2CatalogProductSnapshot,
  specs: MealV2VariantSpec[] = getMealV2VariantSpecs(),
): { ok: true } | { ok: false; reasons: string[] } => {
  const reasons: string[] = [];

  if (product.options.length !== 1) {
    reasons.push(`expected 1 option, got ${product.options.length}`);
  }

  const objectiveOption = product.options.find(
    (option) => option.name === SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  );

  if (!objectiveOption) {
    reasons.push(`missing option "${SUBSCRIPTION_OBJECTIVE_OPTION_NAME}"`);
  } else {
    const expectedLabels = SUBSCRIPTION_OBJECTIVES.map(
      (objective) => SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[objective],
    );
    const actualLabels = objectiveOption.values.map((value) => value.name);
    if (
      expectedLabels.length !== actualLabels.length ||
      expectedLabels.some((label, index) => label !== actualLabels[index])
    ) {
      reasons.push("objective option values do not match expected labels/order");
    }
  }

  if (product.variants.length !== specs.length) {
    reasons.push(
      `expected ${specs.length} variants, got ${product.variants.length}`,
    );
  }

  const seenObjectives = new Set<SubscriptionObjective>();

  for (const variant of product.variants) {
    const rawObjective = variant.objectiveMetafield?.value ?? null;
    const objective = parseSubscriptionObjective(rawObjective);
    if (objective === null) {
      reasons.push(
        `variant ${variant.id}: invalid or missing objective metafield (${rawObjective ?? "null"})`,
      );
      continue;
    }

    if (seenObjectives.has(objective)) {
      reasons.push(`duplicate objective ${objective}`);
      continue;
    }
    seenObjectives.add(objective);

    const expected = specs.find((spec) => spec.objective === objective);
    if (!expected) {
      reasons.push(`unexpected objective ${objective}`);
      continue;
    }

    const objectiveLabel = selectedOptionValue(
      variant.selectedOptions,
      SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
    );
    if (objectiveLabel !== expected.objectiveOptionLabel) {
      reasons.push(
        `${objective}: option expected "${expected.objectiveOptionLabel}", got "${objectiveLabel ?? "null"}"`,
      );
    }

    const price = normalizePrice(variant.price);
    if (price !== expected.price) {
      reasons.push(
        `${objective}: price expected ${expected.price}, got ${variant.price ?? "null"}`,
      );
    }
  }

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    if (!seenObjectives.has(objective)) {
      reasons.push(`missing objective ${objective}`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true };
};

/**
 * Pure classification — no Shopify side effects.
 */
export const classifyMealProductV2 = (
  product: MealV2CatalogProductSnapshot,
): MealV2ClassifyResult => {
  const base = {
    productId: product.id,
    title: product.title,
  };

  if (isBlank(product.id)) {
    return {
      ...base,
      classification: MEAL_V2_CLASSIFICATION.BLOCKED,
      reasons: ["missing product id"],
    };
  }

  const configured = validateAlreadyConfigured(product);
  if (configured.ok) {
    return {
      ...base,
      classification: MEAL_V2_CLASSIFICATION.ALREADY_CONFIGURED,
      reasons: [],
    };
  }

  if (
    product.variants.length === 1 &&
    isLegacyDefaultOptionStructure(product) &&
    !hasAnyObjectiveMetafield(product)
  ) {
    return {
      ...base,
      classification: MEAL_V2_CLASSIFICATION.LEGACY_ELIGIBLE,
      reasons: [],
    };
  }

  return {
    ...base,
    classification: MEAL_V2_CLASSIFICATION.BLOCKED,
    reasons:
      configured.reasons.length > 0
        ? configured.reasons
        : ["structure does not match LEGACY_ELIGIBLE or ALREADY_CONFIGURED"],
  };
};

export const buildMealV2ProductSetInput = (
  productId: string,
  specs: MealV2VariantSpec[] = getMealV2VariantSpecs(),
): MealV2ProductSetInput => ({
  id: productId,
  productOptions: [
    {
      name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
      position: 1,
      values: specs.map((spec) => ({ name: spec.objectiveOptionLabel })),
    },
  ],
  variants: specs.map((spec) => ({
    optionValues: [
      {
        optionName: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
        name: spec.objectiveOptionLabel,
      },
    ],
    price: spec.price,
    metafields: [
      {
        namespace: MEAL_V2_OBJECTIVE_METAFIELD.namespace,
        key: MEAL_V2_OBJECTIVE_METAFIELD.key,
        type: MEAL_V2_OBJECTIVE_METAFIELD.type,
        value: spec.objectiveMetafieldValue,
      },
    ],
  })),
});

/** Confirms conversion payload never invents macros or rewrites identity fields. */
export const assertMealV2ProductSetInputPreservesIdentity = (
  input: MealV2ProductSetInput,
): { ok: true } | { ok: false; reasons: string[] } => {
  const reasons: string[] = [];
  const record = input as Record<string, unknown>;

  for (const forbidden of [
    "title",
    "handle",
    "status",
    "collections",
    "media",
    "files",
    "metafields",
  ]) {
    if (forbidden in record) {
      reasons.push(`input must not include ${forbidden}`);
    }
  }

  if (isBlank(input.id)) {
    reasons.push("missing product id");
  }

  if (input.variants.length !== MEAL_V2_EXPECTED_VARIANT_COUNT) {
    reasons.push(
      `expected ${MEAL_V2_EXPECTED_VARIANT_COUNT} variants, got ${input.variants.length}`,
    );
  }

  for (const variant of input.variants) {
    const hasMacro = variant.metafields.some(
      (metafield) =>
        metafield.namespace === "custom" &&
        ["calories", "proteins", "carbs", "fat", "portion_grams"].includes(
          metafield.key,
        ),
    );
    if (hasMacro) {
      reasons.push("variant metafields must not include macros during 13F-A");
    }

    if (variant.price !== MEAL_V2_VARIANT_PRICE) {
      reasons.push(`price expected ${MEAL_V2_VARIANT_PRICE}, got ${variant.price}`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true };
};

export const formatV2MealCatalogSetupMessage = (
  result: Omit<SetupV2MealCatalogResult, "message">,
): string =>
  `Catalogue Repas V2 : ${result.converted} convertis, ${result.alreadyConfigured} déjà configurés, ${result.ignored} ignorés, ${result.blocked} bloqués.`;

export const fetchMealV2CollectionProducts = async (
  admin: SettingsAdmin,
  mealCollectionId: string,
): Promise<{
  errors: string[];
  hasNextPage: boolean;
  products: MealV2CatalogProductSnapshot[];
}> => {
  if (isBlank(mealCollectionId)) {
    return {
      errors: ["Collection de plats manquante dans les réglages."],
      hasNextPage: false,
      products: [],
    };
  }

  const response = await admin.graphql(MEAL_V2_COLLECTION_PRODUCTS_QUERY, {
    variables: {
      id: mealCollectionId,
      first: MEAL_V2_COLLECTION_PRODUCTS_PAGE_SIZE,
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);
  if (errors.length > 0) {
    return { errors, hasNextPage: false, products: [] };
  }

  if (!json.data?.collection?.id) {
    return {
      errors: ["Collection de plats introuvable dans Shopify."],
      hasNextPage: false,
      products: [],
    };
  }

  const productsConnection = json.data.collection.products;
  return {
    errors: [],
    hasNextPage: Boolean(productsConnection?.pageInfo?.hasNextPage),
    products: (productsConnection?.nodes ?? []).map(toMealV2CatalogProductSnapshot),
  };
};

const convertLegacyMealProduct = async (
  admin: SettingsAdmin,
  productId: string,
): Promise<{ errors: string[] }> => {
  const input = buildMealV2ProductSetInput(productId);
  const preservation = assertMealV2ProductSetInputPreservesIdentity(input);
  if (!preservation.ok) {
    return { errors: preservation.reasons };
  }

  const response = await admin.graphql(MEAL_V2_PRODUCT_SET_UPDATE_MUTATION, {
    variables: {
      input,
      synchronous: true,
    },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const userErrors =
    json.data?.productSet?.userErrors?.map((error) => error.message) ?? [];
  const errors = [...graphqlErrorMessages(json), ...userErrors];
  if (errors.length > 0) {
    return { errors };
  }

  const returnedId = json.data?.productSet?.product?.id ?? null;
  if (!returnedId) {
    return { errors: ["productSet returned no product id"] };
  }

  if (returnedId !== productId) {
    return {
      errors: [
        `productSet returned unexpected product id ${returnedId} (expected ${productId})`,
      ],
    };
  }

  return { errors: [] };
};

export const setupV2MealCatalog = async (
  admin: SettingsAdmin,
  mealCollectionId: string | null | undefined,
): Promise<SetupV2MealCatalogResult> => {
  const empty = {
    alreadyConfigured: 0,
    blocked: 0,
    converted: 0,
    ignored: 0,
    items: [] as MealV2ClassifyResult[],
  };

  const lookup = await fetchMealV2CollectionProducts(
    admin,
    mealCollectionId ?? "",
  );

  if (lookup.errors.length > 0) {
    const summary = {
      ...empty,
      errors: lookup.errors,
      ok: false,
    };
    return {
      ...summary,
      message: lookup.errors[0] ?? "Impossible de lire la collection repas.",
    };
  }

  if (lookup.hasNextPage) {
    const message =
      `La collection repas dépasse ${MEAL_V2_COLLECTION_PRODUCTS_PAGE_SIZE} produits. ` +
      "Provisioning annulé pour éviter une conversion partielle silencieuse.";
    const summary = {
      ...empty,
      errors: [message],
      ok: false,
    };
    return { ...summary, message };
  }

  let converted = 0;
  let alreadyConfigured = 0;
  let blocked = 0;
  const ignored = 0;
  const errors: string[] = [];
  const items: MealV2ClassifyResult[] = [];

  for (const product of lookup.products) {
    const classified = classifyMealProductV2(product);
    items.push(classified);

    if (classified.classification === MEAL_V2_CLASSIFICATION.ALREADY_CONFIGURED) {
      alreadyConfigured += 1;
      continue;
    }

    if (classified.classification === MEAL_V2_CLASSIFICATION.BLOCKED) {
      blocked += 1;
      errors.push(
        `${product.title} (${product.id}): ${classified.reasons.join("; ") || "blocked"}`,
      );
      continue;
    }

    const mutation = await convertLegacyMealProduct(admin, product.id);
    if (mutation.errors.length > 0) {
      blocked += 1;
      errors.push(
        `${product.title} (${product.id}): ${mutation.errors.join("; ")}`,
      );
      continue;
    }

    converted += 1;
  }

  const summary = {
    alreadyConfigured,
    blocked,
    converted,
    errors,
    ignored,
    items,
    ok: blocked === 0 && errors.length === 0,
  };

  return {
    ...summary,
    message: formatV2MealCatalogSetupMessage(summary),
  };
};

/** Pure plan helper for tests — no GraphQL. */
export const planMealV2CatalogMutations = (
  products: MealV2CatalogProductSnapshot[],
): {
  alreadyConfigured: MealV2ClassifyResult[];
  blocked: MealV2ClassifyResult[];
  toConvert: MealV2ClassifyResult[];
} => {
  const alreadyConfigured: MealV2ClassifyResult[] = [];
  const blocked: MealV2ClassifyResult[] = [];
  const toConvert: MealV2ClassifyResult[] = [];

  for (const product of products) {
    const classified = classifyMealProductV2(product);
    if (classified.classification === MEAL_V2_CLASSIFICATION.LEGACY_ELIGIBLE) {
      toConvert.push(classified);
    } else if (
      classified.classification === MEAL_V2_CLASSIFICATION.ALREADY_CONFIGURED
    ) {
      alreadyConfigured.push(classified);
    } else {
      blocked.push(classified);
    }
  }

  return { alreadyConfigured, blocked, toConvert };
};
