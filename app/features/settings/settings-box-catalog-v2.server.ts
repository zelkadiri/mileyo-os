/**
 * Box Mileyo V2 catalog provisioning (CREATE-only via productSet).
 *
 * Isolated from the legacy Box Mileyo collection and from selling-plan V2.
 * productSet is used ONLY when the handle is absent — never for repair/resync.
 */

import {
  BOX_V2_MEAL_COUNT_OPTION_LABEL,
  BOX_V2_MEAL_COUNT_OPTION_NAME,
  BOX_V2_MEAL_COUNTS,
  BOX_V2_OBJECTIVE_OPTION_LABEL,
  BOX_V2_OBJECTIVE_OPTION_NAME,
  BOX_V2_PRODUCT_HANDLE,
  BOX_V2_PRODUCT_STATUS,
  BOX_V2_PRODUCT_TITLE,
  getBoxV2VariantSpecs,
  type BoxV2VariantSpec,
} from "../../constants/subscriptionBoxCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import { parseMealCountMetafield } from "../../utils/mealCountMetafield";
import { parseSubscriptionObjective } from "../../utils/subscriptionObjective";
import { ensureInventoryItemsActivatedAtEligibleLocations } from "./settings-box-v2-inventory-activation.server";

export const SETUP_V2_BOX_CATALOG_INTENT = "setupV2BoxCatalog" as const;

export const BOX_V2_EXPECTED_VARIANT_COUNT = BOX_V2_MEAL_COUNTS.length *
  SUBSCRIPTION_OBJECTIVES.length;

type SettingsAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type BoxV2CatalogProductSnapshot = {
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
    mealCountMetafield?: { value?: string | null } | null;
  }[];
};

export type BoxV2CatalogDecision =
  | { action: "create" }
  | { action: "alreadyConfigured"; productId: string }
  | { action: "blocked"; reasons: string[] };

export type BoxV2CatalogSetupStatus =
  | "created"
  | "alreadyConfigured"
  | "blocked"
  | "error";

export type SetupV2BoxCatalogResult = {
  errors: string[];
  message: string;
  ok: boolean;
  productId?: string;
  reasons?: string[];
  status: BoxV2CatalogSetupStatus;
};

export type BoxV2ProductSetVariantInput = {
  optionValues: { optionName: string; name: string }[];
  price: string;
  inventoryPolicy: "CONTINUE";
  inventoryItem: {
    tracked: false;
  };
  metafields: {
    namespace: string;
    key: string;
    type: string;
    value: string;
  }[];
};

export type BoxV2ProductSetInput = {
  title: string;
  handle: string;
  status: "DRAFT";
  productOptions: {
    name: string;
    position: number;
    values: { name: string }[];
  }[];
  variants: BoxV2ProductSetVariantInput[];
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
    nodes: BoxV2CatalogProductSnapshot["variants"];
  };
};

type GraphqlErrorResponse = {
  data?: {
    productSet?: {
      product?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message: string }[];
    };
    products?: {
      nodes: GraphqlProductNode[];
    };
  };
  errors?: { message?: string | null }[];
};

export const BOX_V2_PRODUCT_BY_HANDLE_QUERY = `#graphql
  query BoxV2ProductByHandle($query: String!) {
    products(first: 5, query: $query) {
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
        variants(first: 50) {
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
            mealCountMetafield: metafield(namespace: "mileyo", key: "meal_count") {
              value
            }
          }
        }
      }
    }
  }
`;

export const BOX_V2_PRODUCT_SET_CREATE_MUTATION = `#graphql
  mutation CreateV2BoxCatalogProduct(
    $input: ProductSetInput!
    $synchronous: Boolean!
  ) {
    productSet(input: $input, synchronous: $synchronous) {
      product {
        id
        handle
        status
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

const normalizePrice = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2);
};

const optionValuesFromShopify = (
  values: unknown,
): { name: string }[] => {
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

const toSnapshot = (node: GraphqlProductNode): BoxV2CatalogProductSnapshot => ({
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

export const buildBoxV2ProductSetInput = (
  specs: BoxV2VariantSpec[] = getBoxV2VariantSpecs(),
): BoxV2ProductSetInput => ({
  title: BOX_V2_PRODUCT_TITLE,
  handle: BOX_V2_PRODUCT_HANDLE,
  status: BOX_V2_PRODUCT_STATUS,
  productOptions: [
    {
      name: BOX_V2_MEAL_COUNT_OPTION_NAME,
      position: 1,
      values: BOX_V2_MEAL_COUNTS.map((mealCount) => ({
        name: BOX_V2_MEAL_COUNT_OPTION_LABEL[mealCount],
      })),
    },
    {
      name: BOX_V2_OBJECTIVE_OPTION_NAME,
      position: 2,
      values: SUBSCRIPTION_OBJECTIVES.map((objective) => ({
        name: BOX_V2_OBJECTIVE_OPTION_LABEL[objective],
      })),
    },
  ],
  variants: specs.map((spec) => ({
    optionValues: [
      {
        optionName: BOX_V2_MEAL_COUNT_OPTION_NAME,
        name: spec.mealCountOptionLabel,
      },
      {
        optionName: BOX_V2_OBJECTIVE_OPTION_NAME,
        name: spec.objectiveOptionLabel,
      },
    ],
    price: spec.price,
    inventoryPolicy: "CONTINUE",
    inventoryItem: {
      tracked: false,
    },
    metafields: [
      {
        namespace: "mileyo",
        key: "objective",
        type: "single_line_text_field",
        value: spec.objectiveMetafieldValue,
      },
      {
        namespace: "mileyo",
        key: "meal_count",
        type: "number_integer",
        value: spec.mealCountMetafieldValue,
      },
    ],
  })),
});

const expectedPairKey = (objective: string, mealCount: number) =>
  `${objective}:${mealCount}`;

const selectedOptionValue = (
  selectedOptions: { name: string; value: string }[],
  optionName: string,
) =>
  selectedOptions.find((option) => option.name === optionName)?.value ?? null;

export const validateBoxV2ProductSnapshot = (
  product: BoxV2CatalogProductSnapshot,
  specs: BoxV2VariantSpec[] = getBoxV2VariantSpecs(),
): { ok: true } | { ok: false; reasons: string[] } => {
  const reasons: string[] = [];

  if (product.handle !== BOX_V2_PRODUCT_HANDLE) {
    reasons.push(`handle expected ${BOX_V2_PRODUCT_HANDLE}, got ${product.handle}`);
  }

  if (product.title !== BOX_V2_PRODUCT_TITLE) {
    reasons.push(`title expected ${BOX_V2_PRODUCT_TITLE}, got ${product.title}`);
  }

  if (product.status !== BOX_V2_PRODUCT_STATUS) {
    reasons.push(`status expected ${BOX_V2_PRODUCT_STATUS}, got ${product.status}`);
  }

  if (product.options.length !== 2) {
    reasons.push(`expected 2 options, got ${product.options.length}`);
  }

  const mealCountOption = product.options.find(
    (option) => option.name === BOX_V2_MEAL_COUNT_OPTION_NAME,
  );
  const objectiveOption = product.options.find(
    (option) => option.name === BOX_V2_OBJECTIVE_OPTION_NAME,
  );

  if (!mealCountOption) {
    reasons.push(`missing option "${BOX_V2_MEAL_COUNT_OPTION_NAME}"`);
  } else {
    const expectedLabels = BOX_V2_MEAL_COUNTS.map(
      (mealCount) => BOX_V2_MEAL_COUNT_OPTION_LABEL[mealCount],
    );
    const actualLabels = mealCountOption.values.map((value) => value.name);
    if (
      expectedLabels.length !== actualLabels.length ||
      expectedLabels.some((label, index) => label !== actualLabels[index])
    ) {
      reasons.push("meal count option values do not match expected labels/order");
    }
  }

  if (!objectiveOption) {
    reasons.push(`missing option "${BOX_V2_OBJECTIVE_OPTION_NAME}"`);
  } else {
    const expectedLabels = SUBSCRIPTION_OBJECTIVES.map(
      (objective) => BOX_V2_OBJECTIVE_OPTION_LABEL[objective],
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

  const seenPairs = new Set<string>();
  const expectedByPair = new Map(
    specs.map((spec) => [
      expectedPairKey(spec.objective, spec.mealCount),
      spec,
    ]),
  );

  for (const variant of product.variants) {
    const rawObjective = variant.objectiveMetafield?.value ?? null;
    const objective = parseSubscriptionObjective(rawObjective);
    if (objective === null) {
      reasons.push(
        `variant ${variant.id}: invalid or missing objective metafield (${rawObjective ?? "null"})`,
      );
      continue;
    }

    const rawMealCount = variant.mealCountMetafield?.value ?? null;
    const mealCount = parseMealCountMetafield(rawMealCount);
    if (mealCount === null) {
      reasons.push(
        `variant ${variant.id}: invalid or missing meal_count metafield (${rawMealCount ?? "null"})`,
      );
      continue;
    }

    const pairKey = expectedPairKey(objective, mealCount);
    if (seenPairs.has(pairKey)) {
      reasons.push(`duplicate objective/mealCount combination ${pairKey}`);
      continue;
    }
    seenPairs.add(pairKey);

    const expected = expectedByPair.get(pairKey);
    if (!expected) {
      reasons.push(`unexpected combination ${pairKey}`);
      continue;
    }

    const mealCountLabel = selectedOptionValue(
      variant.selectedOptions,
      BOX_V2_MEAL_COUNT_OPTION_NAME,
    );
    const objectiveLabel = selectedOptionValue(
      variant.selectedOptions,
      BOX_V2_OBJECTIVE_OPTION_NAME,
    );

    if (mealCountLabel !== expected.mealCountOptionLabel) {
      reasons.push(
        `${pairKey}: meal count option expected "${expected.mealCountOptionLabel}", got "${mealCountLabel ?? "null"}"`,
      );
    }

    if (objectiveLabel !== expected.objectiveOptionLabel) {
      reasons.push(
        `${pairKey}: objective option expected "${expected.objectiveOptionLabel}", got "${objectiveLabel ?? "null"}"`,
      );
    }

    const price = normalizePrice(variant.price);
    if (price !== expected.price) {
      reasons.push(
        `${pairKey}: price expected ${expected.price}, got ${variant.price ?? "null"}`,
      );
    }
  }

  for (const spec of specs) {
    const pairKey = expectedPairKey(spec.objective, spec.mealCount);
    if (!seenPairs.has(pairKey)) {
      reasons.push(`missing combination ${pairKey}`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true };
};

export const resolveV2BoxCatalogDecision = (
  products: BoxV2CatalogProductSnapshot[],
): BoxV2CatalogDecision => {
  if (products.length === 0) {
    return { action: "create" };
  }

  if (products.length > 1) {
    return {
      action: "blocked",
      reasons: [
        `multiple products matched handle ${BOX_V2_PRODUCT_HANDLE} (${products.length})`,
      ],
    };
  }

  const product = products[0];
  const validation = validateBoxV2ProductSnapshot(product);
  if (!validation.ok) {
    return { action: "blocked", reasons: validation.reasons };
  }

  return { action: "alreadyConfigured", productId: product.id };
};

export const formatV2BoxCatalogSetupMessage = (
  result: SetupV2BoxCatalogResult,
): string => {
  switch (result.status) {
    case "created":
      return "Box Mileyo V2 créée avec 18 variantes en brouillon.";
    case "alreadyConfigured":
      return "Box Mileyo V2 est déjà correctement configurée.";
    case "blocked":
      return "Box Mileyo V2 existe mais sa structure ne correspond pas au modèle attendu.";
    case "error":
      return result.message || "Impossible de provisionner Box Mileyo V2.";
  }
};

export const findBoxV2ProductsByHandle = async (
  admin: SettingsAdmin,
): Promise<{ errors: string[]; products: BoxV2CatalogProductSnapshot[] }> => {
  const response = await admin.graphql(BOX_V2_PRODUCT_BY_HANDLE_QUERY, {
    variables: { query: `handle:${BOX_V2_PRODUCT_HANDLE}` },
  });
  const json = (await response.json()) as GraphqlErrorResponse;
  const errors = graphqlErrorMessages(json);
  if (errors.length > 0) {
    return { errors, products: [] };
  }

  const nodes = json.data?.products?.nodes ?? [];
  return {
    errors: [],
    products: nodes.map((node) => toSnapshot(node)),
  };
};

const createBoxV2Product = async (
  admin: SettingsAdmin,
): Promise<{ errors: string[]; productId?: string }> => {
  const response = await admin.graphql(BOX_V2_PRODUCT_SET_CREATE_MUTATION, {
    variables: {
      input: buildBoxV2ProductSetInput(),
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

  const productId = json.data?.productSet?.product?.id ?? undefined;
  if (!productId) {
    return { errors: ["productSet returned no product id"] };
  }

  return { errors: [], productId };
};

export const setupV2BoxCatalog = async (
  admin: SettingsAdmin,
): Promise<SetupV2BoxCatalogResult> => {
  const lookup = await findBoxV2ProductsByHandle(admin);
  if (lookup.errors.length > 0) {
    return {
      errors: lookup.errors,
      message: "Impossible de lire le catalogue Box V2.",
      ok: false,
      status: "error",
    };
  }

  const decision = resolveV2BoxCatalogDecision(lookup.products);

  if (decision.action === "alreadyConfigured") {
    const activation = await ensureInventoryItemsActivatedAtEligibleLocations(
      admin,
      decision.productId,
    );
    if (!activation.ok) {
      return {
        errors: activation.errors,
        message: "Impossible d’activer Box Mileyo V2 sur les emplacements de stock.",
        ok: false,
        productId: decision.productId,
        status: "error",
      };
    }

    return {
      errors: [],
      message: formatV2BoxCatalogSetupMessage({
        errors: [],
        message: "",
        ok: true,
        status: "alreadyConfigured",
      }),
      ok: true,
      productId: decision.productId,
      status: "alreadyConfigured",
    };
  }

  if (decision.action === "blocked") {
    return {
      errors: decision.reasons,
      message: formatV2BoxCatalogSetupMessage({
        errors: decision.reasons,
        message: "",
        ok: false,
        status: "blocked",
      }),
      ok: false,
      reasons: decision.reasons,
      status: "blocked",
    };
  }

  const created = await createBoxV2Product(admin);
  if (created.errors.length > 0) {
    return {
      errors: created.errors,
      message: "Impossible de créer Box Mileyo V2.",
      ok: false,
      status: "error",
    };
  }

  if (!created.productId) {
    return {
      errors: ["productSet returned no product id"],
      message: "Impossible de créer Box Mileyo V2.",
      ok: false,
      status: "error",
    };
  }

  const activation = await ensureInventoryItemsActivatedAtEligibleLocations(
    admin,
    created.productId,
  );
  if (!activation.ok) {
    return {
      errors: activation.errors,
      message: "Impossible d’activer Box Mileyo V2 sur les emplacements de stock.",
      ok: false,
      productId: created.productId,
      status: "error",
    };
  }

  return {
    errors: [],
    message: formatV2BoxCatalogSetupMessage({
      errors: [],
      message: "",
      ok: true,
      status: "created",
    }),
    ok: true,
    productId: created.productId,
    status: "created",
  };
};

/** Exported for tests — confirms objective label mapping without redefining objectives. */
export const boxV2ObjectiveLabels = (): Record<
  SubscriptionObjective,
  string
> => ({ ...BOX_V2_OBJECTIVE_OPTION_LABEL });
