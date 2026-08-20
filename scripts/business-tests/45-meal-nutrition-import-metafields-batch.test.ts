/**
 * Business regression — 14C-E meal nutrition metafieldsSet batching.
 *
 * Shopify metafieldsSet accepts max 25 inputs per call.
 * Writer must chunk; appliedVariantCount only counts fully written variants.
 */
import {
  applyMealNutritionMetafields,
  chunkMealNutritionWritePlans,
  SHOPIFY_METAFIELDS_SET_MAX_INPUT,
} from "../../app/services/mealNutritionImport.server";
import {
  buildMealNutritionWritePlans,
  type MealNutritionImportRow,
} from "../../app/utils/mealNutritionImport";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const validRow = (
  index: number,
  overrides: Partial<MealNutritionImportRow> = {},
): MealNutritionImportRow => ({
  variantId: `gid://shopify/ProductVariant/${1000 + index}`,
  productTitle: `Plat ${index}`,
  objective: "balanced",
  calories: 450 + index,
  proteins: 38.5,
  carbs: 35,
  fat: 12,
  portionGrams: 350,
  ...overrides,
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => validRow(index + 1));

type GraphqlCall = {
  query: string;
  variables?: Record<string, unknown>;
};

const createMockAdmin = (options?: {
  /** Fail on 1-based batch call number. */
  failOnCall?: number;
  failMessage?: string;
}) => {
  const calls: GraphqlCall[] = [];
  let callNumber = 0;

  return {
    admin: {
      graphql: async (
        query: string,
        graphqlOptions?: { variables?: Record<string, unknown> },
      ) => {
        callNumber += 1;
        calls.push({ query, variables: graphqlOptions?.variables });

        if (options?.failOnCall === callNumber) {
          return Response.json({
            data: {
              metafieldsSet: {
                metafields: [],
                userErrors: [
                  {
                    elementIndex: 0,
                    message:
                      options.failMessage ??
                      "Exceeded the maximum metafields input limit of 25.",
                  },
                ],
              },
            },
          });
        }

        const metafields = (graphqlOptions?.variables?.metafields ??
          []) as unknown[];
        return Response.json({
          data: {
            metafieldsSet: {
              metafields: metafields.map((_, index) => ({
                id: `gid://shopify/Metafield/${callNumber}-${index}`,
                key: "calories",
                value: "1",
              })),
              userErrors: [],
            },
          },
        });
      },
    },
    calls,
  };
};

const metafieldCountInCall = (call: GraphqlCall) => {
  const metafields = call.variables?.metafields;
  return Array.isArray(metafields) ? metafields.length : 0;
};

const runSuite = async () => {
  const ctx = createBusinessTestContext(
    "45-meal-nutrition-import-metafields-batch",
  );

  ctx.scenario("A. Chunk helper respects Shopify 25 limit without splitting variants");
  ctx.assertEqual(
    "Shopify metafieldsSet max constant",
    SHOPIFY_METAFIELDS_SET_MAX_INPUT,
    25,
  );
  const sixPlans = buildMealNutritionWritePlans(rows(6));
  const sixBatches = chunkMealNutritionWritePlans(sixPlans);
  ctx.assertEqual("6 variants → 2 batches", sixBatches.length, 2);
  ctx.assertEqual("batch1 variants", sixBatches[0]?.length, 5);
  ctx.assertEqual("batch2 variants", sixBatches[1]?.length, 1);
  ctx.assertEqual(
    "batch1 metafields",
    sixBatches[0]?.reduce((sum, plan) => sum + plan.metafields.length, 0),
    25,
  );
  ctx.assertEqual(
    "batch2 metafields",
    sixBatches[1]?.reduce((sum, plan) => sum + plan.metafields.length, 0),
    5,
  );
  ctx.assertTrue(
    "each batch <= 25",
    sixBatches.every(
      (batch) =>
        batch.reduce((sum, plan) => sum + plan.metafields.length, 0) <=
        SHOPIFY_METAFIELDS_SET_MAX_INPUT,
    ),
  );

  const fortyFiveBatches = chunkMealNutritionWritePlans(
    buildMealNutritionWritePlans(rows(45)),
  );
  ctx.assertEqual("45 variants → 9 batches", fortyFiveBatches.length, 9);
  ctx.assertTrue(
    "all 45-variant batches <= 25",
    fortyFiveBatches.every(
      (batch) =>
        batch.reduce((sum, plan) => sum + plan.metafields.length, 0) <= 25,
    ),
  );

  ctx.scenario("B. Large import issues multiple metafieldsSet calls");
  const largeMock = createMockAdmin();
  const largeResult = await applyMealNutritionMetafields(
    largeMock.admin,
    rows(6),
  );
  ctx.assertEqual("large import errors empty", largeResult.errors.length, 0);
  ctx.assertEqual("large import applied count", largeResult.appliedVariantCount, 6);
  ctx.assertEqual("large import graphql calls", largeMock.calls.length, 2);
  ctx.assertTrue(
    "all calls are metafieldsSet",
    largeMock.calls.every((call) => call.query.includes("metafieldsSet")),
  );
  ctx.assertEqual(
    "first call size",
    metafieldCountInCall(largeMock.calls[0]!),
    25,
  );
  ctx.assertEqual(
    "second call size",
    metafieldCountInCall(largeMock.calls[1]!),
    5,
  );
  ctx.assertTrue(
    "no call exceeds 25",
    largeMock.calls.every(
      (call) => metafieldCountInCall(call) <= SHOPIFY_METAFIELDS_SET_MAX_INPUT,
    ),
  );

  const fortyFiveMock = createMockAdmin();
  const fortyFiveResult = await applyMealNutritionMetafields(
    fortyFiveMock.admin,
    rows(45),
  );
  ctx.assertEqual("45 import applied", fortyFiveResult.appliedVariantCount, 45);
  ctx.assertEqual("45 import calls", fortyFiveMock.calls.length, 9);
  ctx.assertTrue(
    "45 import every call <= 25",
    fortyFiveMock.calls.every(
      (call) => metafieldCountInCall(call) <= SHOPIFY_METAFIELDS_SET_MAX_INPUT,
    ),
  );

  ctx.scenario("C. Small import still uses a single metafieldsSet call");
  const smallMock = createMockAdmin();
  const smallResult = await applyMealNutritionMetafields(
    smallMock.admin,
    rows(3),
  );
  ctx.assertEqual("small applied", smallResult.appliedVariantCount, 3);
  ctx.assertEqual("small calls", smallMock.calls.length, 1);
  ctx.assertEqual("small call size", metafieldCountInCall(smallMock.calls[0]!), 15);
  ctx.assertEqual("small errors", smallResult.errors.length, 0);

  const fiveMock = createMockAdmin();
  const fiveResult = await applyMealNutritionMetafields(
    fiveMock.admin,
    rows(5),
  );
  ctx.assertEqual("exact-25 applied", fiveResult.appliedVariantCount, 5);
  ctx.assertEqual("exact-25 calls", fiveMock.calls.length, 1);
  ctx.assertEqual("exact-25 size", metafieldCountInCall(fiveMock.calls[0]!), 25);

  ctx.scenario("D. Failed batch does not inflate appliedVariantCount");
  const failMock = createMockAdmin({
    failOnCall: 2,
    failMessage: "Exceeded the maximum metafields input limit of 25.",
  });
  const failResult = await applyMealNutritionMetafields(
    failMock.admin,
    rows(6),
  );
  ctx.assertEqual(
    "partial success applied = first batch only",
    failResult.appliedVariantCount,
    5,
  );
  ctx.assertTrue("partial has errors", failResult.errors.length > 0);
  ctx.assertTrue(
    "error mentions variant or limit",
    failResult.errors.some(
      (message) =>
        message.includes("Exceeded the maximum metafields") ||
        message.includes("Plat "),
    ),
  );
  ctx.assertEqual(
    "stops after failing batch (no third call)",
    failMock.calls.length,
    2,
  );

  const failFirstMock = createMockAdmin({
    failOnCall: 1,
    failMessage: "Shopify write denied.",
  });
  const failFirstResult = await applyMealNutritionMetafields(
    failFirstMock.admin,
    rows(6),
  );
  ctx.assertEqual("first-batch fail applied", failFirstResult.appliedVariantCount, 0);
  ctx.assertEqual("first-batch fail calls", failFirstMock.calls.length, 1);
  ctx.assertTrue(
    "first-batch fail has error",
    failFirstResult.errors.some((message) =>
      message.includes("Shopify write denied."),
    ),
  );

  return finishSuite("45-meal-nutrition-import-metafields-batch", ctx);
};

process.exitCode = await runSuite();
