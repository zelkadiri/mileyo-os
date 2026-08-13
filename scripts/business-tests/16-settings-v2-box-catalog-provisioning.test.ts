/**
 * Business regression — Box V2 catalog provisioning (13E-A2c1).
 *
 * Pure helpers + mocked Admin GraphQL only. No live Shopify mutations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  getTemporaryV2VariantPrice,
  TEMPORARY_V2_BASE_PRICE_BY_MEAL_COUNT,
  TEMPORARY_V2_OBJECTIVE_PRICE_OFFSET,
} from "../../app/constants/subscriptionBoxCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVES,
} from "../../app/constants/subscriptionObjective";
import {
  BOX_V2_EXPECTED_VARIANT_COUNT,
  BOX_V2_PRODUCT_SET_CREATE_MUTATION,
  SETUP_V2_BOX_CATALOG_INTENT,
  buildBoxV2ProductSetInput,
  resolveV2BoxCatalogDecision,
  setupV2BoxCatalog,
  validateBoxV2ProductSnapshot,
  type BoxV2CatalogProductSnapshot,
} from "../../app/features/settings/settings-box-catalog-v2.server";
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

const createMockAdmin = ({
  createUserErrors = [],
  products = [],
  productId = "gid://shopify/Product/v2-created",
  queryErrors,
}: {
  createUserErrors?: { message: string }[];
  products?: unknown[];
  productId?: string;
  queryErrors?: { message: string }[];
} = {}) => {
  const calls: GraphqlCall[] = [];

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("BoxV2ProductByHandle")) {
          return jsonResponse({
            data: { products: { nodes: products } },
            errors: queryErrors,
          });
        }

        if (query.includes("productSet")) {
          return jsonResponse({
            data: {
              productSet: {
                product: createUserErrors.length
                  ? null
                  : { id: productId, handle: BOX_V2_PRODUCT_HANDLE, status: "DRAFT" },
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

const buildExactSnapshot = (): BoxV2CatalogProductSnapshot => {
  const specs = getBoxV2VariantSpecs();
  return {
    id: "gid://shopify/Product/v2-exact",
    title: BOX_V2_PRODUCT_TITLE,
    handle: BOX_V2_PRODUCT_HANDLE,
    status: BOX_V2_PRODUCT_STATUS,
    options: [
      {
        name: BOX_V2_MEAL_COUNT_OPTION_NAME,
        values: BOX_V2_MEAL_COUNTS.map((mealCount) => ({
          name: BOX_V2_MEAL_COUNT_OPTION_LABEL[mealCount],
        })),
      },
      {
        name: BOX_V2_OBJECTIVE_OPTION_NAME,
        values: SUBSCRIPTION_OBJECTIVES.map((objective) => ({
          name: BOX_V2_OBJECTIVE_OPTION_LABEL[objective],
        })),
      },
    ],
    variants: specs.map((spec, index) => ({
      id: `gid://shopify/ProductVariant/v2-${index + 1}`,
      title: `${spec.mealCountOptionLabel} / ${spec.objectiveOptionLabel}`,
      price: spec.price,
      selectedOptions: [
        {
          name: BOX_V2_MEAL_COUNT_OPTION_NAME,
          value: spec.mealCountOptionLabel,
        },
        {
          name: BOX_V2_OBJECTIVE_OPTION_NAME,
          value: spec.objectiveOptionLabel,
        },
      ],
      objectiveMetafield: { value: spec.objectiveMetafieldValue },
      mealCountMetafield: { value: spec.mealCountMetafieldValue },
    })),
  };
};

const buildExactGraphqlNode = () => {
  const snapshot = buildExactSnapshot();
  return {
    id: snapshot.id,
    title: snapshot.title,
    handle: snapshot.handle,
    status: snapshot.status,
    options: snapshot.options.map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values.map((value) => value.name),
      optionValues: option.values,
    })),
    variants: {
      nodes: snapshot.variants,
    },
  };
};

const mutationCalls = (calls: GraphqlCall[]) =>
  calls.filter((call) => call.query.includes("productSet"));

const runSuite = async () => {
  const ctx = createBusinessTestContext(
    "16-settings-v2-box-catalog-provisioning",
  );
  const catalogSource = readRepoFile(
    "app/features/settings/settings-box-catalog-v2.server.ts",
  );
  const constantsSource = readRepoFile(
    "app/constants/subscriptionBoxCatalogV2.ts",
  );
  const actionsSource = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const uiSource = readRepoFile("app/features/settings/settings-render.tsx");
  const sellingPlansV2Source = readRepoFile(
    "app/features/settings/settings-selling-plans-v2.server.ts",
  );

  ctx.scenario("A. Meal counts and objectives");
  ctx.assertEqual(
    "meal counts exact",
    JSON.stringify([...BOX_V2_MEAL_COUNTS]),
    JSON.stringify([8, 10, 12, 16, 20, 24]),
  );
  ctx.assertEqual(
    "objectives from shared source of truth",
    JSON.stringify([...SUBSCRIPTION_OBJECTIVES]),
    JSON.stringify(["weight_loss", "balanced", "bulk"]),
  );
  ctx.assertFalse(
    "constants do not redefine weight_loss literal as local SOURCES",
    /export const SUBSCRIPTION_OBJECTIVE/.test(constantsSource),
  );
  ctx.assertTrue(
    "constants import SUBSCRIPTION_OBJECTIVES",
    constantsSource.includes('from "./subscriptionObjective"'),
  );

  ctx.scenario("B. Spec generation — 18 stable combinations");
  const specs = getBoxV2VariantSpecs();
  ctx.assertEqual("18 specs", specs.length, BOX_V2_EXPECTED_VARIANT_COUNT);
  ctx.assertEqual("expected variant count constant", BOX_V2_EXPECTED_VARIANT_COUNT, 18);
  ctx.assertEqual("first is 8/weight_loss", `${specs[0].mealCount}/${specs[0].objective}`, "8/weight_loss");
  ctx.assertEqual("second is 8/balanced", `${specs[1].mealCount}/${specs[1].objective}`, "8/balanced");
  ctx.assertEqual("third is 8/bulk", `${specs[2].mealCount}/${specs[2].objective}`, "8/bulk");
  ctx.assertEqual("fourth is 10/weight_loss", `${specs[3].mealCount}/${specs[3].objective}`, "10/weight_loss");
  ctx.assertEqual(
    "last is 24/bulk",
    `${specs[17].mealCount}/${specs[17].objective}`,
    "24/bulk",
  );
  const pairs = new Set(specs.map((spec) => `${spec.objective}:${spec.mealCount}`));
  ctx.assertEqual("no duplicate pairs", pairs.size, 18);

  ctx.scenario("C. Labels distinct from canonical values");
  ctx.assertEqual("8 label", BOX_V2_MEAL_COUNT_OPTION_LABEL[8], "8 repas");
  ctx.assertEqual("16 label without Duo", BOX_V2_MEAL_COUNT_OPTION_LABEL[16], "16 repas");
  ctx.assertEqual("20 label without Duo", BOX_V2_MEAL_COUNT_OPTION_LABEL[20], "20 repas");
  ctx.assertEqual("24 label without Duo", BOX_V2_MEAL_COUNT_OPTION_LABEL[24], "24 repas");
  ctx.assertEqual(
    "weight_loss label",
    BOX_V2_OBJECTIVE_OPTION_LABEL.weight_loss,
    "Perte de poids",
  );
  ctx.assertEqual(
    "balanced label",
    BOX_V2_OBJECTIVE_OPTION_LABEL.balanced,
    "Équilibré",
  );
  ctx.assertEqual("bulk label", BOX_V2_OBJECTIVE_OPTION_LABEL.bulk, "Prise de masse");
  ctx.assertTrue(
    "UI label differs from canonical objective",
    BOX_V2_OBJECTIVE_OPTION_LABEL.weight_loss !== "weight_loss",
  );
  ctx.assertFalse(
    "no Duo in constants",
    constantsSource.toLowerCase().includes("duo"),
  );

  ctx.scenario("D. Metafield values");
  const eightWeightLoss = specs.find(
    (spec) =>
      spec.mealCount === 8 &&
      spec.objective === SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  const twelveBalanced = specs.find(
    (spec) =>
      spec.mealCount === 12 &&
      spec.objective === SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  const twentyFourBulk = specs.find(
    (spec) =>
      spec.mealCount === 24 && spec.objective === SUBSCRIPTION_OBJECTIVE.BULK,
  );
  ctx.assertEqual(
    "8/weight_loss objective metafield",
    eightWeightLoss?.objectiveMetafieldValue,
    "weight_loss",
  );
  ctx.assertEqual(
    "8/weight_loss meal_count metafield",
    eightWeightLoss?.mealCountMetafieldValue,
    "8",
  );
  ctx.assertEqual(
    "12/balanced objective metafield",
    twelveBalanced?.objectiveMetafieldValue,
    "balanced",
  );
  ctx.assertEqual(
    "12/balanced meal_count metafield",
    twelveBalanced?.mealCountMetafieldValue,
    "12",
  );
  ctx.assertEqual(
    "24/bulk objective metafield",
    twentyFourBulk?.objectiveMetafieldValue,
    "bulk",
  );
  ctx.assertEqual(
    "24/bulk meal_count metafield",
    twentyFourBulk?.mealCountMetafieldValue,
    "24",
  );

  ctx.scenario("E. Temporary placeholder prices");
  ctx.assertEqual("base 8", TEMPORARY_V2_BASE_PRICE_BY_MEAL_COUNT[8], 76);
  ctx.assertEqual("offset weight_loss", TEMPORARY_V2_OBJECTIVE_PRICE_OFFSET.weight_loss, 0.11);
  ctx.assertEqual(
    "8/weight_loss price",
    getTemporaryV2VariantPrice(8, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "76.11",
  );
  ctx.assertEqual(
    "8/balanced price",
    getTemporaryV2VariantPrice(8, SUBSCRIPTION_OBJECTIVE.BALANCED),
    "76.22",
  );
  ctx.assertEqual(
    "8/bulk price",
    getTemporaryV2VariantPrice(8, SUBSCRIPTION_OBJECTIVE.BULK),
    "76.33",
  );
  ctx.assertEqual(
    "10/weight_loss price",
    getTemporaryV2VariantPrice(10, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "96.11",
  );
  ctx.assertEqual(
    "12/balanced price",
    getTemporaryV2VariantPrice(12, SUBSCRIPTION_OBJECTIVE.BALANCED),
    "125.22",
  );
  ctx.assertEqual(
    "16/bulk price",
    getTemporaryV2VariantPrice(16, SUBSCRIPTION_OBJECTIVE.BULK),
    "158.33",
  );
  ctx.assertEqual(
    "20/weight_loss price",
    getTemporaryV2VariantPrice(20, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "180.11",
  );
  ctx.assertEqual(
    "24/bulk price",
    getTemporaryV2VariantPrice(24, SUBSCRIPTION_OBJECTIVE.BULK),
    "200.33",
  );
  ctx.assertTrue(
    "all 18 prices are two-decimal strings",
    specs.every((spec) => /^\d+\.\d{2}$/.test(spec.price)),
  );
  ctx.assertTrue(
    "TEMPORARY naming present for base cents",
    constantsSource.includes("TEMPORARY_V2_BASE_PRICE_CENTS_BY_MEAL_COUNT"),
  );
  ctx.assertTrue(
    "TEMPORARY placeholder comment present",
    constantsSource.includes("TEMPORARY PLACEHOLDER PRICING"),
  );

  ctx.scenario("F. ProductSet create input");
  const input = buildBoxV2ProductSetInput();
  ctx.assertEqual("title", input.title, BOX_V2_PRODUCT_TITLE);
  ctx.assertEqual("handle", input.handle, BOX_V2_PRODUCT_HANDLE);
  ctx.assertEqual("status DRAFT", input.status, "DRAFT");
  ctx.assertEqual("two options", input.productOptions.length, 2);
  ctx.assertEqual(
    "option 1 name",
    input.productOptions[0].name,
    BOX_V2_MEAL_COUNT_OPTION_NAME,
  );
  ctx.assertEqual(
    "option 2 name",
    input.productOptions[1].name,
    BOX_V2_OBJECTIVE_OPTION_NAME,
  );
  ctx.assertEqual("18 variants in input", input.variants.length, 18);
  const firstVariant = input.variants[0];
  ctx.assertEqual("first variant option count", firstVariant.optionValues.length, 2);
  ctx.assertEqual("first variant price", firstVariant.price, "76.11");
  ctx.assertEqual("first variant metafield count", firstVariant.metafields.length, 2);
  ctx.assertEqual(
    "first objective metafield",
    firstVariant.metafields.find((field) => field.key === "objective")?.value,
    "weight_loss",
  );
  ctx.assertEqual(
    "first meal_count metafield",
    firstVariant.metafields.find((field) => field.key === "meal_count")?.value,
    "8",
  );
  const serialized = JSON.stringify(input);
  ctx.assertFalse("no legacy collection id", serialized.includes("Collection/"));
  ctx.assertFalse("no selling plan", serialized.toLowerCase().includes("sellingplan"));
  ctx.assertFalse("no prix_abonnement", serialized.includes("prix_abonnement"));
  ctx.assertFalse(
    "no PRODUCT meal_count metafield on product input",
    Object.prototype.hasOwnProperty.call(input, "metafields"),
  );
  ctx.assertTrue(
    "mutation uses productSet",
    BOX_V2_PRODUCT_SET_CREATE_MUTATION.includes("productSet"),
  );
  ctx.assertTrue(
    "mutation is synchronous create path",
    BOX_V2_PRODUCT_SET_CREATE_MUTATION.includes("$synchronous"),
  );

  ctx.scenario("G. Idempotence decisions");
  ctx.assertEqual(
    "absent → CREATE",
    resolveV2BoxCatalogDecision([]).action,
    "create",
  );

  const exact = buildExactSnapshot();
  const exactDecision = resolveV2BoxCatalogDecision([exact]);
  ctx.assertEqual("exact → ALREADY_CONFIGURED", exactDecision.action, "alreadyConfigured");
  ctx.assertTrue(
    "exact validation ok",
    validateBoxV2ProductSnapshot(exact).ok,
  );

  const seventeen = buildExactSnapshot();
  seventeen.variants = seventeen.variants.slice(0, 17);
  ctx.assertEqual(
    "17 variants → BLOCKED",
    resolveV2BoxCatalogDecision([seventeen]).action,
    "blocked",
  );

  const nineteen = buildExactSnapshot();
  nineteen.variants = [
    ...nineteen.variants,
    {
      ...nineteen.variants[0],
      id: "gid://shopify/ProductVariant/extra",
    },
  ];
  ctx.assertEqual(
    "19 variants → BLOCKED",
    resolveV2BoxCatalogDecision([nineteen]).action,
    "blocked",
  );

  const duplicate = buildExactSnapshot();
  duplicate.variants[1] = {
    ...duplicate.variants[0],
    id: "gid://shopify/ProductVariant/dup",
  };
  ctx.assertEqual(
    "duplicate pair → BLOCKED",
    resolveV2BoxCatalogDecision([duplicate]).action,
    "blocked",
  );

  const badObjective = buildExactSnapshot();
  badObjective.variants[0] = {
    ...badObjective.variants[0],
    objectiveMetafield: { value: "keto" },
  };
  ctx.assertEqual(
    "invalid objective → BLOCKED",
    resolveV2BoxCatalogDecision([badObjective]).action,
    "blocked",
  );

  const badMealCount = buildExactSnapshot();
  badMealCount.variants[0] = {
    ...badMealCount.variants[0],
    mealCountMetafield: { value: "7" },
  };
  ctx.assertEqual(
    "incorrect meal_count → BLOCKED",
    resolveV2BoxCatalogDecision([badMealCount]).action,
    "blocked",
  );

  const badPrice = buildExactSnapshot();
  badPrice.variants[0] = {
    ...badPrice.variants[0],
    price: "76.00",
  };
  ctx.assertEqual(
    "different price → BLOCKED",
    resolveV2BoxCatalogDecision([badPrice]).action,
    "blocked",
  );

  const missingOption = buildExactSnapshot();
  missingOption.options = missingOption.options.slice(0, 1);
  ctx.assertEqual(
    "missing option → BLOCKED",
    resolveV2BoxCatalogDecision([missingOption]).action,
    "blocked",
  );

  const activeStatus = buildExactSnapshot();
  activeStatus.status = "ACTIVE";
  ctx.assertEqual(
    "non-DRAFT status → BLOCKED",
    resolveV2BoxCatalogDecision([activeStatus]).action,
    "blocked",
  );

  ctx.assertEqual(
    "multiple candidates → BLOCKED",
    resolveV2BoxCatalogDecision([exact, { ...exact, id: "gid://shopify/Product/other" }])
      .action,
    "blocked",
  );

  ctx.scenario("H. Mutation only on CREATE");
  const createMock = createMockAdmin({ products: [] });
  const createResult = await setupV2BoxCatalog(createMock.admin);
  ctx.assertEqual("create status", createResult.status, "created");
  ctx.assertEqual("create productSet calls", mutationCalls(createMock.calls).length, 1);
  ctx.assertEqual(
    "create uses synchronous true",
    createMock.calls.find((call) => call.query.includes("productSet"))?.variables
      ?.synchronous,
    true,
  );
  const createInput = createMock.calls.find((call) =>
    call.query.includes("productSet"),
  )?.variables?.input as { handle?: string; status?: string; variants?: unknown[] };
  ctx.assertEqual("create handle", createInput?.handle, BOX_V2_PRODUCT_HANDLE);
  ctx.assertEqual("create status DRAFT", createInput?.status, "DRAFT");
  ctx.assertEqual("create 18 variants", createInput?.variants?.length, 18);

  const alreadyMock = createMockAdmin({ products: [buildExactGraphqlNode()] });
  const alreadyResult = await setupV2BoxCatalog(alreadyMock.admin);
  ctx.assertEqual("alreadyConfigured status", alreadyResult.status, "alreadyConfigured");
  ctx.assertEqual(
    "alreadyConfigured performs no productSet",
    mutationCalls(alreadyMock.calls).length,
    0,
  );

  const blockedMock = createMockAdmin({
    products: [
      (() => {
        const node = buildExactGraphqlNode();
        node.variants.nodes = node.variants.nodes.slice(0, 17);
        return node;
      })(),
    ],
  });
  const blockedResult = await setupV2BoxCatalog(blockedMock.admin);
  ctx.assertEqual("blocked status", blockedResult.status, "blocked");
  ctx.assertEqual(
    "blocked performs no productSet",
    mutationCalls(blockedMock.calls).length,
    0,
  );
  ctx.assertTrue(
    "blocked surfaces reasons",
    (blockedResult.errors?.length ?? 0) > 0,
  );

  ctx.scenario("I. Settings intent and UI");
  const catalogIntent: string = SETUP_V2_BOX_CATALOG_INTENT;
  ctx.assertEqual("catalog intent", catalogIntent, "setupV2BoxCatalog");
  ctx.assertTrue(
    "distinct from selling-plan V2 intent",
    catalogIntent !== "setupV2WeeklySellingPlans",
  );
  ctx.assertTrue(
    "distinct from legacy selling-plan intent",
    catalogIntent !== "setupWeeklySellingPlans",
  );
  ctx.assertTrue(
    "actions handle catalog intent",
    actionsSource.includes("SETUP_V2_BOX_CATALOG_INTENT"),
  );
  const catalogIntentIndex = actionsSource.indexOf(
    "if (intent === SETUP_V2_BOX_CATALOG_INTENT)",
  );
  const catalogBlock = actionsSource.slice(
    catalogIntentIndex,
    actionsSource.indexOf(
      "if (intent === SETUP_V2_WEEKLY_SELLING_PLANS_INTENT)",
      catalogIntentIndex,
    ),
  );
  ctx.assertTrue(
    "catalog intent calls setupV2BoxCatalog",
    catalogBlock.includes("setupV2BoxCatalog("),
  );
  ctx.assertFalse(
    "catalog intent does not call selling plan V2",
    catalogBlock.includes("setupV2WeeklySellingPlans("),
  );
  ctx.assertFalse(
    "catalog intent does not call legacy selling plans",
    catalogBlock.includes("createOrUpdateWeeklySellingPlans("),
  );
  ctx.assertTrue(
    "UI has Catalogue Box V2 section",
    uiSource.includes('heading="Catalogue Box V2"'),
  );
  ctx.assertTrue(
    "UI button label",
    uiSource.includes("Créer / vérifier catalogue Box V2"),
  );
  ctx.assertTrue(
    "UI posts setupV2BoxCatalog",
    uiSource.includes('value="setupV2BoxCatalog"'),
  );
  ctx.assertTrue(
    "UI mentions temporary prices",
    uiSource.includes("TEMPORAIRES"),
  );
  ctx.assertTrue(
    "UI mentions DRAFT",
    uiSource.includes("DRAFT"),
  );
  ctx.assertTrue(
    "Abonnements Box V2 section remains",
    uiSource.includes('heading="Abonnements Box V2"'),
  );

  ctx.scenario("J. Isolation — no selling plan / legacy / A2b edits");
  ctx.assertFalse(
    "catalog service does not import selling-plans-v2",
    catalogSource.includes("settings-selling-plans-v2"),
  );
  ctx.assertFalse(
    "catalog service does not import legacy selling plans",
    catalogSource.includes("settings-selling-plans.server"),
  );
  ctx.assertFalse(
    "catalog service has no collectionAdd",
    catalogSource.includes("collectionAdd") ||
      catalogSource.includes("collectionCreate"),
  );
  ctx.assertFalse(
    "catalog service has no AppSettings boxCollection write",
    catalogSource.includes("boxCollectionId"),
  );
  ctx.assertFalse(
    "catalog create input has no collections field",
    JSON.stringify(buildBoxV2ProductSetInput()).includes('"collections"'),
  );
  ctx.assertFalse(
    "A2b selling-plan service unchanged by this task (no box-mileyo-v2 handle)",
    sellingPlansV2Source.includes(BOX_V2_PRODUCT_HANDLE),
  );
  ctx.assertFalse(
    "no destructive productSet repair path for blocked",
    catalogSource.includes("sellingPlanGroupDelete") ||
      catalogSource.includes("productDelete"),
  );

  return finishSuite("16-settings-v2-box-catalog-provisioning", ctx);
};

runSuite()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
