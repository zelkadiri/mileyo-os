/**
 * Business regression — Meal V2 catalog provisioning (13F-A).
 *
 * Pure helpers + mocked Admin GraphQL only. No live Shopify mutations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEAL_V2_CLASSIFICATION,
  MEAL_V2_EXPECTED_VARIANT_COUNT,
  MEAL_V2_VARIANT_PRICE,
  SHOPIFY_DEFAULT_OPTION_NAME,
  getMealV2VariantSpecs,
} from "../../app/constants/subscriptionMealCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
  SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
  SUBSCRIPTION_OBJECTIVES,
} from "../../app/constants/subscriptionObjective";
import {
  MEAL_V2_COLLECTION_PRODUCTS_PAGE_SIZE,
  MEAL_V2_PRODUCT_SET_UPDATE_MUTATION,
  SETUP_V2_MEAL_CATALOG_INTENT,
  assertMealV2ProductSetInputPreservesIdentity,
  buildMealV2ProductSetInput,
  classifyMealProductV2,
  formatV2MealCatalogSetupMessage,
  planMealV2CatalogMutations,
  setupV2MealCatalog,
  type MealV2CatalogProductSnapshot,
} from "../../app/features/settings/settings-meal-catalog-v2.server";
import {
  MEAL_V2_METAFIELD_DEFINITIONS,
  SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT,
  VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION,
  VARIANT_MEAL_CARBS_METAFIELD_DEFINITION,
  VARIANT_MEAL_FAT_METAFIELD_DEFINITION,
  VARIANT_MEAL_PORTION_GRAMS_METAFIELD_DEFINITION,
  VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION,
  VARIANT_OBJECTIVE_METAFIELD_DEFINITION,
  ensureMetafieldDefinition,
  formatMealV2MetafieldDefinitionsMessage,
  isMetafieldDefinitionAlreadyExistsError,
  setupMealV2MetafieldDefinitions,
  toMetafieldDefinitionCreateOutcome,
} from "../../app/features/settings/settings-metafields.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const jsonResponse = (body: unknown) =>
  ({ json: async () => body }) as unknown as Response;

type GraphqlCall = {
  query: string;
  variables?: Record<string, unknown>;
};

const buildLegacySnapshot = (
  overrides: Partial<MealV2CatalogProductSnapshot> = {},
): MealV2CatalogProductSnapshot => ({
  id: "gid://shopify/Product/1001",
  title: "Poulet curry",
  handle: "poulet-curry",
  status: "ACTIVE",
  options: [
    {
      name: SHOPIFY_DEFAULT_OPTION_NAME,
      values: [{ name: "Default Title" }],
    },
  ],
  variants: [
    {
      id: "gid://shopify/ProductVariant/2001",
      title: "Default Title",
      price: "0.00",
      selectedOptions: [
        { name: SHOPIFY_DEFAULT_OPTION_NAME, value: "Default Title" },
      ],
      objectiveMetafield: null,
    },
  ],
  ...overrides,
});

const buildConfiguredSnapshot = (
  overrides: Partial<MealV2CatalogProductSnapshot> = {},
): MealV2CatalogProductSnapshot => {
  const specs = getMealV2VariantSpecs();
  return {
    id: "gid://shopify/Product/1001",
    title: "Poulet curry",
    handle: "poulet-curry",
    status: "ACTIVE",
    options: [
      {
        name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
        values: specs.map((spec) => ({ name: spec.objectiveOptionLabel })),
      },
    ],
    variants: specs.map((spec, index) => ({
      id: `gid://shopify/ProductVariant/300${index + 1}`,
      title: spec.objectiveOptionLabel,
      price: MEAL_V2_VARIANT_PRICE,
      selectedOptions: [
        {
          name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
          value: spec.objectiveOptionLabel,
        },
      ],
      objectiveMetafield: { value: spec.objectiveMetafieldValue },
    })),
    ...overrides,
  };
};

const toGraphqlNode = (snapshot: MealV2CatalogProductSnapshot) => ({
  id: snapshot.id,
  title: snapshot.title,
  handle: snapshot.handle,
  status: snapshot.status,
  options: snapshot.options.map((option) => ({
    id: option.id ?? null,
    name: option.name,
    values: option.values.map((value) => value.name),
    optionValues: option.values,
  })),
  variants: {
    nodes: snapshot.variants,
  },
});

const createMealCatalogMockAdmin = ({
  products = [] as MealV2CatalogProductSnapshot[],
  hasNextPage = false,
  collectionMissing = false,
  queryErrors,
  productSetUserErrors = [] as { message: string }[],
}: {
  products?: MealV2CatalogProductSnapshot[];
  hasNextPage?: boolean;
  collectionMissing?: boolean;
  queryErrors?: { message: string }[];
  productSetUserErrors?: { message: string }[];
} = {}) => {
  const calls: GraphqlCall[] = [];

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("MealV2CollectionProducts")) {
          return jsonResponse({
            data: collectionMissing
              ? { collection: null }
              : {
                  collection: {
                    id: "gid://shopify/Collection/meal",
                    title: "Recettes",
                    products: {
                      pageInfo: { hasNextPage },
                      nodes: products.map(toGraphqlNode),
                    },
                  },
                },
            errors: queryErrors,
          });
        }

        if (query.includes("productSet")) {
          const productId = (options?.variables?.input as { id?: string })?.id;
          return jsonResponse({
            data: {
              productSet: {
                product: productSetUserErrors.length
                  ? null
                  : {
                      id: productId,
                      handle: "poulet-curry",
                      status: "ACTIVE",
                      title: "Poulet curry",
                    },
                userErrors: productSetUserErrors,
              },
            },
          });
        }

        throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 120)}`);
      },
    },
    calls,
  };
};

const createDefinitionsMockAdmin = ({
  existing = [] as {
    namespace: string;
    key: string;
    ownerType: string;
    typeName: string;
  }[],
  createUserErrors = [] as { code?: string; message: string }[],
}: {
  existing?: {
    namespace: string;
    key: string;
    ownerType: string;
    typeName: string;
  }[];
  createUserErrors?: { code?: string; message: string }[];
} = {}) => {
  const calls: GraphqlCall[] = [];

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("LookupMetafieldDefinition")) {
          const namespace = String(options?.variables?.namespace ?? "");
          const key = String(options?.variables?.key ?? "");
          const ownerType = String(options?.variables?.ownerType ?? "");
          const nodes = existing
            .filter(
              (definition) =>
                definition.namespace === namespace &&
                definition.key === key &&
                definition.ownerType === ownerType,
            )
            .map((definition) => ({
              id: `gid://shopify/MetafieldDefinition/${definition.key}`,
              namespace: definition.namespace,
              key: definition.key,
              ownerType: definition.ownerType,
              type: { name: definition.typeName },
            }));
          return jsonResponse({ data: { metafieldDefinitions: { nodes } } });
        }

        if (query.includes("metafieldDefinitionCreate")) {
          return jsonResponse({
            data: {
              metafieldDefinitionCreate: {
                createdDefinition: createUserErrors.length
                  ? null
                  : { id: "gid://shopify/MetafieldDefinition/new" },
                userErrors: createUserErrors,
              },
            },
          });
        }

        throw new Error(`Unexpected GraphQL operation: ${query.slice(0, 120)}`);
      },
    },
    calls,
  };
};

const runSuite = async () => {
  const ctx = createBusinessTestContext(
    "18-settings-v2-meal-catalog-provisioning",
  );

  ctx.scenario("A. Shared objective option labels");
  ctx.assertEqual(
    "option name Objectif",
    SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
    "Objectif",
  );
  ctx.assertEqual(
    "weight_loss label",
    SUBSCRIPTION_OBJECTIVE_OPTION_LABEL.weight_loss,
    "Perte de poids",
  );
  ctx.assertEqual(
    "balanced label",
    SUBSCRIPTION_OBJECTIVE_OPTION_LABEL.balanced,
    "Équilibré",
  );
  ctx.assertEqual(
    "bulk label",
    SUBSCRIPTION_OBJECTIVE_OPTION_LABEL.bulk,
    "Prise de masse",
  );
  ctx.assertTrue(
    "labels are not canonical keys",
    SUBSCRIPTION_OBJECTIVE_OPTION_LABEL.weight_loss !== "weight_loss",
  );

  ctx.scenario("B. Metafield definitions contracts");
  ctx.assertEqual(
    "definitions count is 6",
    MEAL_V2_METAFIELD_DEFINITIONS.length,
    6,
  );
  ctx.assertEqual(
    "objective owner PRODUCTVARIANT",
    VARIANT_OBJECTIVE_METAFIELD_DEFINITION.ownerType,
    "PRODUCTVARIANT",
  );
  ctx.assertEqual(
    "calories type number_integer",
    VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION.type,
    "number_integer",
  );
  ctx.assertEqual(
    "proteins type number_decimal",
    VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION.type,
    "number_decimal",
  );
  ctx.assertEqual(
    "carbs type number_decimal",
    VARIANT_MEAL_CARBS_METAFIELD_DEFINITION.type,
    "number_decimal",
  );
  ctx.assertEqual(
    "fat type number_decimal",
    VARIANT_MEAL_FAT_METAFIELD_DEFINITION.type,
    "number_decimal",
  );
  ctx.assertEqual(
    "portion_grams type number_integer",
    VARIANT_MEAL_PORTION_GRAMS_METAFIELD_DEFINITION.type,
    "number_integer",
  );
  ctx.assertEqual(
    "calories namespace custom",
    VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION.namespace,
    "custom",
  );
  ctx.assertEqual(
    "proteins key",
    VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION.key,
    "proteins",
  );
  ctx.assertEqual(
    "portion_grams key",
    VARIANT_MEAL_PORTION_GRAMS_METAFIELD_DEFINITION.key,
    "portion_grams",
  );
  ctx.assertEqual(
    "definitions intent",
    SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT,
    "setupMealV2MetafieldDefinitions",
  );

  ctx.scenario("C. Definitions TAKEN / incompatible helpers");
  ctx.assertTrue(
    "TAKEN is soft success",
    isMetafieldDefinitionAlreadyExistsError({
      code: "TAKEN",
      message: "Key is taken",
    }),
  );
  const takenOutcome = toMetafieldDefinitionCreateOutcome([
    { code: "TAKEN", message: "Key is taken" },
  ]);
  ctx.assertTrue("TAKEN alreadyExisted", takenOutcome.alreadyExisted);
  ctx.assertEqual("TAKEN no blocking errors", takenOutcome.errors.length, 0);

  const incompatibleAdmin = createDefinitionsMockAdmin({
    existing: [
      {
        namespace: "custom",
        key: "calories",
        ownerType: "PRODUCTVARIANT",
        typeName: "single_line_text_field",
      },
    ],
  });

  ctx.scenario("D. ensureMetafieldDefinition behaviors");
  const createAdmin = createDefinitionsMockAdmin();
  const created = await ensureMetafieldDefinition(
    createAdmin.admin,
    VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION,
  );
  ctx.assertTrue("missing definition creates", created.created);
  ctx.assertFalse("created not blocked", created.blocked);

  const existingAdmin = createDefinitionsMockAdmin({
    existing: [
      {
        namespace: "custom",
        key: "calories",
        ownerType: "PRODUCTVARIANT",
        typeName: "number_integer",
      },
    ],
  });
  const already = await ensureMetafieldDefinition(
    existingAdmin.admin,
    VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION,
  );
  ctx.assertTrue("matching type alreadyExisted", already.alreadyExisted);
  ctx.assertFalse("matching type not created", already.created);
  ctx.assertFalse("matching type not blocked", already.blocked);

  const badType = await ensureMetafieldDefinition(
    incompatibleAdmin.admin,
    VARIANT_MEAL_CALORIES_METAFIELD_DEFINITION,
  );
  ctx.assertTrue("wrong type blocked", badType.blocked);
  ctx.assertFalse("wrong type not created", badType.created);
  ctx.assertTrue(
    "wrong type message mentions type",
    badType.errors[0]?.includes("single_line_text_field") === true,
  );

  const takenCreateAdmin = createDefinitionsMockAdmin({
    createUserErrors: [{ code: "TAKEN", message: "Key is taken" }],
  });
  const taken = await ensureMetafieldDefinition(
    takenCreateAdmin.admin,
    VARIANT_MEAL_PROTEINS_METAFIELD_DEFINITION,
  );
  ctx.assertTrue("TAKEN treated as alreadyExisted", taken.alreadyExisted);
  ctx.assertFalse("TAKEN not blocked", taken.blocked);

  const batchAdmin = createDefinitionsMockAdmin({
    existing: [
      {
        namespace: "mileyo",
        key: "objective",
        ownerType: "PRODUCTVARIANT",
        typeName: "single_line_text_field",
      },
    ],
  });
  const batch = await setupMealV2MetafieldDefinitions(batchAdmin.admin);
  ctx.assertEqual(
    "batch alreadyPresent includes objective",
    batch.alreadyPresent,
    1,
  );
  ctx.assertEqual("batch created remaining", batch.created, 5);
  ctx.assertEqual("batch blocked", batch.blocked, 0);
  ctx.assertTrue("batch ok", batch.ok);
  ctx.assertEqual(
    "batch message format",
    batch.message,
    formatMealV2MetafieldDefinitionsMessage(batch),
  );

  ctx.scenario("E. Classification LEGACY_ELIGIBLE");
  const legacy = classifyMealProductV2(buildLegacySnapshot());
  ctx.assertEqual(
    "legacy mono-default",
    legacy.classification,
    MEAL_V2_CLASSIFICATION.LEGACY_ELIGIBLE,
  );

  ctx.scenario("F. Classification ALREADY_CONFIGURED");
  const configured = classifyMealProductV2(buildConfiguredSnapshot());
  ctx.assertEqual(
    "exact 3 objectives",
    configured.classification,
    MEAL_V2_CLASSIFICATION.ALREADY_CONFIGURED,
  );

  ctx.scenario("G. Classification BLOCKED cases");
  const twoVariants = classifyMealProductV2(
    buildLegacySnapshot({
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "A",
          price: "0.00",
          selectedOptions: [
            { name: SHOPIFY_DEFAULT_OPTION_NAME, value: "A" },
          ],
        },
        {
          id: "gid://shopify/ProductVariant/2",
          title: "B",
          price: "0.00",
          selectedOptions: [
            { name: SHOPIFY_DEFAULT_OPTION_NAME, value: "B" },
          ],
        },
      ],
      options: [
        {
          name: SHOPIFY_DEFAULT_OPTION_NAME,
          values: [{ name: "A" }, { name: "B" }],
        },
      ],
    }),
  );
  ctx.assertEqual(
    "2 variants blocked",
    twoVariants.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  const fourVariants = classifyMealProductV2(
    buildConfiguredSnapshot({
      variants: [
        ...buildConfiguredSnapshot().variants,
        {
          id: "gid://shopify/ProductVariant/extra",
          title: "Extra",
          price: "0.00",
          selectedOptions: [
            {
              name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
              value: "Extra",
            },
          ],
          objectiveMetafield: { value: "weight_loss" },
        },
      ],
    }),
  );
  ctx.assertEqual(
    "4 variants blocked",
    fourVariants.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  const duplicate = classifyMealProductV2(
    buildConfiguredSnapshot({
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "Perte de poids",
          price: "0.00",
          selectedOptions: [
            {
              name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
              value: "Perte de poids",
            },
          ],
          objectiveMetafield: { value: "weight_loss" },
        },
        {
          id: "gid://shopify/ProductVariant/2",
          title: "Perte de poids 2",
          price: "0.00",
          selectedOptions: [
            {
              name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
              value: "Équilibré",
            },
          ],
          objectiveMetafield: { value: "weight_loss" },
        },
        {
          id: "gid://shopify/ProductVariant/3",
          title: "Prise de masse",
          price: "0.00",
          selectedOptions: [
            {
              name: SUBSCRIPTION_OBJECTIVE_OPTION_NAME,
              value: "Prise de masse",
            },
          ],
          objectiveMetafield: { value: "bulk" },
        },
      ],
    }),
  );
  ctx.assertEqual(
    "duplicate weight_loss blocked",
    duplicate.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );
  ctx.assertTrue(
    "duplicate reason mentions duplicate",
    duplicate.reasons.some((reason) => reason.includes("duplicate")),
  );

  const invalidObjective = classifyMealProductV2(
    buildConfiguredSnapshot({
      variants: buildConfiguredSnapshot().variants.map((variant, index) =>
        index === 0
          ? { ...variant, objectiveMetafield: { value: "lose_weight" } }
          : variant,
      ),
    }),
  );
  ctx.assertEqual(
    "invalid objective blocked",
    invalidObjective.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  const missingObjective = classifyMealProductV2(
    buildConfiguredSnapshot({
      variants: buildConfiguredSnapshot().variants.map((variant, index) =>
        index === 1 ? { ...variant, objectiveMetafield: null } : variant,
      ),
    }),
  );
  ctx.assertEqual(
    "missing objective blocked",
    missingObjective.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  const unexpectedOptions = classifyMealProductV2(
    buildLegacySnapshot({
      options: [
        {
          name: "Taille",
          values: [{ name: "M" }],
        },
      ],
      variants: [
        {
          id: "gid://shopify/ProductVariant/9",
          title: "M",
          price: "0.00",
          selectedOptions: [{ name: "Taille", value: "M" }],
          objectiveMetafield: null,
        },
      ],
    }),
  );
  ctx.assertEqual(
    "unexpected options blocked",
    unexpectedOptions.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  const partialObjective = classifyMealProductV2(
    buildLegacySnapshot({
      variants: [
        {
          id: "gid://shopify/ProductVariant/2001",
          title: "Default Title",
          price: "0.00",
          selectedOptions: [
            { name: SHOPIFY_DEFAULT_OPTION_NAME, value: "Default Title" },
          ],
          objectiveMetafield: { value: "weight_loss" },
        },
      ],
    }),
  );
  ctx.assertEqual(
    "partial objective on legacy blocked",
    partialObjective.classification,
    MEAL_V2_CLASSIFICATION.BLOCKED,
  );

  ctx.scenario("H. Target variants / productSet input");
  const input = buildMealV2ProductSetInput("gid://shopify/Product/1001");
  ctx.assertEqual(
    "exactly 3 variants",
    input.variants.length,
    MEAL_V2_EXPECTED_VARIANT_COUNT,
  );
  ctx.assertEqual(
    "order weight_loss first",
    input.variants[0]?.metafields[0]?.value,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "order balanced second",
    input.variants[1]?.metafields[0]?.value,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertEqual(
    "order bulk third",
    input.variants[2]?.metafields[0]?.value,
    SUBSCRIPTION_OBJECTIVE.BULK,
  );
  ctx.assertEqual(
    "label weight_loss",
    input.variants[0]?.optionValues[0]?.name,
    "Perte de poids",
  );
  ctx.assertEqual(
    "label balanced",
    input.variants[1]?.optionValues[0]?.name,
    "Équilibré",
  );
  ctx.assertEqual(
    "label bulk",
    input.variants[2]?.optionValues[0]?.name,
    "Prise de masse",
  );
  ctx.assertTrue(
    "all prices 0.00",
    input.variants.every((variant) => variant.price === MEAL_V2_VARIANT_PRICE),
  );
  ctx.assertTrue(
    "only objective metafields",
    input.variants.every(
      (variant) =>
        variant.metafields.length === 1 &&
        variant.metafields[0]?.namespace === "mileyo" &&
        variant.metafields[0]?.key === "objective",
    ),
  );
  const preservation = assertMealV2ProductSetInputPreservesIdentity(input);
  ctx.assertTrue("preservation ok", preservation.ok);
  ctx.assertEqual("input id preserved", input.id, "gid://shopify/Product/1001");
  ctx.assertFalse("no title on input", "title" in input);
  ctx.assertFalse("no handle on input", "handle" in input);
  ctx.assertFalse("no status on input", "status" in input);
  ctx.assertFalse("no collections on input", "collections" in input);
  ctx.assertFalse("no media on input", "media" in input);

  ctx.scenario("I. Idempotence / mutation plan");
  const planLegacy = planMealV2CatalogMutations([buildLegacySnapshot()]);
  ctx.assertEqual("legacy plans convert", planLegacy.toConvert.length, 1);
  ctx.assertEqual(
    "legacy no alreadyConfigured",
    planLegacy.alreadyConfigured.length,
    0,
  );

  const planConfigured = planMealV2CatalogMutations([buildConfiguredSnapshot()]);
  ctx.assertEqual(
    "configured plans no convert",
    planConfigured.toConvert.length,
    0,
  );
  ctx.assertEqual(
    "configured alreadyConfigured",
    planConfigured.alreadyConfigured.length,
    1,
  );

  const planBlocked = planMealV2CatalogMutations([
    buildLegacySnapshot({
      options: [{ name: "Color", values: [{ name: "Red" }] }],
      variants: [
        {
          id: "gid://shopify/ProductVariant/x",
          title: "Red",
          price: "0.00",
          selectedOptions: [{ name: "Color", value: "Red" }],
        },
      ],
    }),
  ]);
  ctx.assertEqual("blocked plans no convert", planBlocked.toConvert.length, 0);
  ctx.assertEqual("blocked count", planBlocked.blocked.length, 1);

  ctx.scenario("J. setupV2MealCatalog mocked flows");
  const convertMock = createMealCatalogMockAdmin({
    products: [buildLegacySnapshot()],
  });
  const convertResult = await setupV2MealCatalog(
    convertMock.admin,
    "gid://shopify/Collection/meal",
  );
  ctx.assertEqual("convert count", convertResult.converted, 1);
  ctx.assertEqual("convert blocked", convertResult.blocked, 0);
  ctx.assertTrue("convert ok", convertResult.ok);
  ctx.assertTrue(
    "convert used productSet",
    convertMock.calls.some((call) => call.query.includes("productSet")),
  );
  const setCall = convertMock.calls.find((call) =>
    call.query.includes("productSet"),
  );
  const setInput = setCall?.variables?.input as Record<string, unknown>;
  ctx.assertEqual(
    "productSet keeps product id",
    setInput.id,
    "gid://shopify/Product/1001",
  );
  ctx.assertFalse("productSet omits title", "title" in setInput);
  ctx.assertFalse("productSet omits collections", "collections" in setInput);

  const secondRunMock = createMealCatalogMockAdmin({
    products: [buildConfiguredSnapshot()],
  });
  const secondRun = await setupV2MealCatalog(
    secondRunMock.admin,
    "gid://shopify/Collection/meal",
  );
  ctx.assertEqual("second run converted", secondRun.converted, 0);
  ctx.assertEqual(
    "second run alreadyConfigured",
    secondRun.alreadyConfigured,
    1,
  );
  ctx.assertFalse(
    "second run no productSet",
    secondRunMock.calls.some((call) => call.query.includes("productSet")),
  );

  const blockedMock = createMealCatalogMockAdmin({
    products: [
      buildLegacySnapshot({
        options: [{ name: "Color", values: [{ name: "Red" }] }],
        variants: [
          {
            id: "gid://shopify/ProductVariant/x",
            title: "Red",
            price: "0.00",
            selectedOptions: [{ name: "Color", value: "Red" }],
          },
        ],
      }),
    ],
  });
  const blockedRun = await setupV2MealCatalog(
    blockedMock.admin,
    "gid://shopify/Collection/meal",
  );
  ctx.assertEqual("blocked converted", blockedRun.converted, 0);
  ctx.assertEqual("blocked count", blockedRun.blocked, 1);
  ctx.assertFalse(
    "blocked no productSet",
    blockedMock.calls.some((call) => call.query.includes("productSet")),
  );

  const pagedMock = createMealCatalogMockAdmin({
    products: [buildLegacySnapshot()],
    hasNextPage: true,
  });
  const paged = await setupV2MealCatalog(
    pagedMock.admin,
    "gid://shopify/Collection/meal",
  );
  ctx.assertFalse("hasNextPage aborts", paged.ok);
  ctx.assertEqual("hasNextPage converted", paged.converted, 0);
  ctx.assertFalse(
    "hasNextPage no mutation",
    pagedMock.calls.some((call) => call.query.includes("productSet")),
  );

  const missingCollection = await setupV2MealCatalog(
    createMealCatalogMockAdmin({ collectionMissing: true }).admin,
    "gid://shopify/Collection/missing",
  );
  ctx.assertFalse("missing collection not ok", missingCollection.ok);
  ctx.assertTrue(
    "missing collection message",
    missingCollection.message.includes("introuvable"),
  );

  const emptyCollectionId = await setupV2MealCatalog(
    createMealCatalogMockAdmin().admin,
    null,
  );
  ctx.assertFalse("null collection id not ok", emptyCollectionId.ok);

  ctx.assertEqual(
    "collection page size 50",
    MEAL_V2_COLLECTION_PRODUCTS_PAGE_SIZE,
    50,
  );
  ctx.assertTrue(
    "mutation export present",
    MEAL_V2_PRODUCT_SET_UPDATE_MUTATION.includes("productSet"),
  );
  ctx.assertEqual(
    "catalog intent",
    SETUP_V2_MEAL_CATALOG_INTENT,
    "setupV2MealCatalog",
  );
  ctx.assertEqual(
    "message formatter",
    formatV2MealCatalogSetupMessage({
      alreadyConfigured: 2,
      blocked: 1,
      converted: 15,
      errors: [],
      ignored: 0,
      items: [],
      ok: false,
    }),
    "Catalogue Repas V2 : 15 convertis, 2 déjà configurés, 0 ignorés, 1 bloqués.",
  );

  ctx.scenario("K. Mixed continue on blocked");
  const mixedMock = createMealCatalogMockAdmin({
    products: [
      buildLegacySnapshot({
        id: "gid://shopify/Product/ok",
        title: "OK meal",
      }),
      buildLegacySnapshot({
        id: "gid://shopify/Product/bad",
        title: "Bad meal",
        options: [{ name: "Color", values: [{ name: "Red" }] }],
        variants: [
          {
            id: "gid://shopify/ProductVariant/bad",
            title: "Red",
            price: "0.00",
            selectedOptions: [{ name: "Color", value: "Red" }],
          },
        ],
      }),
    ],
  });
  const mixed = await setupV2MealCatalog(
    mixedMock.admin,
    "gid://shopify/Collection/meal",
  );
  ctx.assertEqual("mixed converted", mixed.converted, 1);
  ctx.assertEqual("mixed blocked", mixed.blocked, 1);
  ctx.assertFalse("mixed not fully ok", mixed.ok);

  ctx.scenario("L. Legacy builder safety (static + identity)");
  const builderClient = readRepoFile("app/features/builder/builder-client.ts");
  const builderCatalog = readRepoFile(
    "app/features/builder/builder-catalog.server.ts",
  );
  const builderTypes = readRepoFile("app/features/builder/builder-types.ts");
  const loader = readRepoFile("app/routes/apps.box-builder.tsx");

  ctx.assertTrue(
    "builder meals use variantId for selectedMeals",
    builderClient.includes("selectedMeals[meal.variantId]"),
  );
  ctx.assertTrue(
    "builder Plat N uses meal.title",
    builderClient.includes('properties["Plat " + propertyIndex] = meal.title'),
  );
  ctx.assertTrue(
    "legacy getCollectionProducts still has variants(first: 1) for other callers",
    builderCatalog.includes("variants(first: 1)"),
  );
  ctx.assertTrue(
    "BuilderMealOption uses productId + title",
    builderTypes.includes("export type BuilderMealOption") &&
      builderTypes.includes("productId: string") &&
      builderTypes.includes("title: string"),
  );
  ctx.assertTrue(
    "loader uses fetchBuilderMealOptions",
    loader.includes("fetchBuilderMealOptions"),
  );
  ctx.assertTrue(
    "loader still uses mealCollectionId",
    loader.includes("mealCollectionId"),
  );

  const convertedIdentity = buildMealV2ProductSetInput(
    "gid://shopify/Product/1001",
  );
  ctx.assertEqual(
    "conversion keeps same productId",
    convertedIdentity.id,
    "gid://shopify/Product/1001",
  );
  ctx.assertEqual(
    "first target variant is weight_loss",
    convertedIdentity.variants[0]?.optionValues[0]?.name,
    "Perte de poids",
  );
  ctx.assertTrue(
    "variants(first:1) would still return a readable first variant",
    convertedIdentity.variants.length >= 1,
  );

  ctx.scenario("M. Settings wiring present / builder not wired to meal V2");
  const actions = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const render = readRepoFile("app/features/settings/settings-render.tsx");
  const mealService = readRepoFile(
    "app/features/settings/settings-meal-catalog-v2.server.ts",
  );
  const mealCatalogService = readRepoFile(
    "app/services/subscriptionMealCatalog.server.ts",
  );

  ctx.assertTrue(
    "actions wire definitions intent",
    actions.includes("SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT"),
  );
  ctx.assertTrue(
    "actions wire catalog intent",
    actions.includes("SETUP_V2_MEAL_CATALOG_INTENT"),
  );
  ctx.assertTrue(
    "render has definitions button",
    render.includes("Créer / vérifier définitions Repas V2"),
  );
  ctx.assertTrue(
    "render has catalog button",
    render.includes("Préparer catalogue Repas V2"),
  );
  ctx.assertTrue(
    "catalog uses mealCollectionId not hardcode",
    mealService.includes("mealCollectionId") &&
      !mealService.includes("gid://shopify/Collection/332162793612"),
  );
  ctx.assertTrue(
    "parser 13B still has variants(first: 10)",
    mealCatalogService.includes("variants(first: 10)"),
  );
  ctx.assertTrue(
    "parser 13B still reads custom.calories",
    mealCatalogService.includes('key: "calories"'),
  );
  ctx.assertFalse(
    "builder-client not importing meal catalog v2 settings",
    builderClient.includes("settings-meal-catalog-v2"),
  );
  ctx.assertFalse(
    "builder-catalog not importing meal catalog v2 settings",
    builderCatalog.includes("settings-meal-catalog-v2"),
  );
  ctx.assertEqual("objectives length 3", SUBSCRIPTION_OBJECTIVES.length, 3);

  return finishSuite("18-settings-v2-meal-catalog-provisioning", ctx);
};

runSuite()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
