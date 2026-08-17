/**
 * Business regression — Box V2 inventory location activation (13I-B).
 *
 * Pure helpers + mocked Admin GraphQL only. No live Shopify mutations.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOX_V2_ELIGIBLE_LOCATIONS_QUERY,
  BOX_V2_EXPECTED_INVENTORY_ITEM_COUNT,
  BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION,
  BOX_V2_LOCATIONS_PAGE_SIZE,
  BOX_V2_PRODUCT_INVENTORY_ITEMS_QUERY,
  buildInventoryActivationUpdates,
  collectEligibleLocationIds,
  collectInventoryItemIds,
  ensureInventoryItemsActivatedAtEligibleLocations,
  isEligibleMerchantLocation,
} from "../../app/features/settings/settings-box-v2-inventory-activation.server";
import { setupV2BoxCatalog } from "../../app/features/settings/settings-box-catalog-v2.server";
import { BOX_V2_PRODUCT_HANDLE } from "../../app/constants/subscriptionBoxCatalogV2";
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

const EIGHTEEN_ITEMS = Array.from({ length: 18 }, (_, index) => ({
  id: `gid://shopify/ProductVariant/v2-${index + 1}`,
  inventoryItem: { id: `gid://shopify/InventoryItem/v2-${index + 1}` },
}));

const ELIGIBLE_LOCATION = {
  id: "gid://shopify/Location/online-1",
  name: "Entrepôt principal",
  isActive: true,
  fulfillsOnlineOrders: true,
  isFulfillmentService: false,
};

const ELIGIBLE_LOCATION_PAGE_2 = {
  id: "gid://shopify/Location/online-2",
  name: "Atelier",
  isActive: true,
  fulfillsOnlineOrders: true,
  isFulfillmentService: false,
};

const FRANCE_LIKE_LOCATION = {
  id: "gid://shopify/Location/france",
  name: "France",
  isActive: true,
  fulfillsOnlineOrders: false,
  isFulfillmentService: false,
};

const INELIGIBLE_3PL_LOCATION = {
  id: "gid://shopify/Location/3pl",
  name: "Fulfillment app",
  isActive: true,
  fulfillsOnlineOrders: true,
  isFulfillmentService: true,
};

type LocationPage = {
  after: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  nodes: unknown[];
};

const createActivationAdmin = ({
  inventoryNodes = EIGHTEEN_ITEMS,
  locations = [ELIGIBLE_LOCATION],
  locationPages,
  activationUserErrors = [] as { code?: string; message: string }[],
  inventoryQueryErrors,
  locationQueryErrors,
}: {
  inventoryNodes?: typeof EIGHTEEN_ITEMS;
  locations?: unknown[];
  locationPages?: LocationPage[];
  activationUserErrors?: { code?: string; message: string }[];
  inventoryQueryErrors?: { message: string }[];
  locationQueryErrors?: { message: string }[];
} = {}) => {
  const calls: GraphqlCall[] = [];
  const pages =
    locationPages ??
    ([
      {
        after: null,
        endCursor: null,
        hasNextPage: false,
        nodes: locations,
      },
    ] satisfies LocationPage[]);

  return {
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        calls.push({ query, variables: options?.variables });

        if (query.includes("BoxV2ProductInventoryItems")) {
          return jsonResponse({
            data: {
              product: {
                variants: { nodes: inventoryNodes },
              },
            },
            errors: inventoryQueryErrors,
          });
        }

        if (query.includes("BoxV2EligibleLocations")) {
          const after =
            typeof options?.variables?.after === "string"
              ? options.variables.after
              : null;
          const page =
            pages.find((candidate) => candidate.after === after) ?? pages[0];

          return jsonResponse({
            data: {
              locations: {
                nodes: page.nodes,
                pageInfo: {
                  hasNextPage: page.hasNextPage,
                  endCursor: page.endCursor,
                },
              },
            },
            errors: locationQueryErrors,
          });
        }

        if (query.includes("inventoryBulkToggleActivation")) {
          return jsonResponse({
            data: {
              inventoryBulkToggleActivation: {
                inventoryItem: { id: options?.variables?.inventoryItemId },
                userErrors: activationUserErrors,
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
    "23-settings-v2-box-inventory-activation",
  );
  const helperSource = readRepoFile(
    "app/features/settings/settings-box-v2-inventory-activation.server.ts",
  );
  const catalogSource = readRepoFile(
    "app/features/settings/settings-box-catalog-v2.server.ts",
  );
  const devToml = readRepoFile("shopify.app.dev.toml");
  const productionToml = readRepoFile("shopify.app.production.toml");

  ctx.scenario("A. Eligible merchant location filter");
  ctx.assertTrue(
    "TEST A — active online merchant location is eligible",
    isEligibleMerchantLocation(ELIGIBLE_LOCATION),
  );
  ctx.assertTrue(
    "TEST B — active merchant location that does not fulfill online orders is eligible",
    isEligibleMerchantLocation(FRANCE_LIKE_LOCATION),
  );
  ctx.assertFalse(
    "TEST D — inactive location is not eligible",
    isEligibleMerchantLocation({
      ...ELIGIBLE_LOCATION,
      isActive: false,
    }),
  );
  ctx.assertFalse(
    "TEST C — third-party fulfillment service is not eligible",
    isEligibleMerchantLocation({
      ...ELIGIBLE_LOCATION,
      isFulfillmentService: true,
    }),
  );
  ctx.assertFalse(
    "TEST C — fulfillment service is excluded even if it fulfills online orders",
    isEligibleMerchantLocation({
      ...INELIGIBLE_3PL_LOCATION,
      fulfillsOnlineOrders: true,
    }),
  );
  ctx.assertFalse(
    "missing id is not eligible",
    isEligibleMerchantLocation({
      ...ELIGIBLE_LOCATION,
      id: "  ",
    }),
  );
  ctx.assertEqual(
    "collects merchant locations including France-like, excludes inactive and 3PL",
    JSON.stringify(
      collectEligibleLocationIds([
        ELIGIBLE_LOCATION,
        { ...ELIGIBLE_LOCATION, id: "gid://shopify/Location/inactive", isActive: false },
        FRANCE_LIKE_LOCATION,
        {
          ...ELIGIBLE_LOCATION,
          id: "gid://shopify/Location/3pl",
          isFulfillmentService: true,
        },
        ELIGIBLE_LOCATION,
        ELIGIBLE_LOCATION_PAGE_2,
      ]),
    ),
    JSON.stringify([
      "gid://shopify/Location/online-1",
      "gid://shopify/Location/france",
      "gid://shopify/Location/online-2",
    ]),
  );
  ctx.assertFalse(
    "helper no longer excludes on fulfillsOnlineOrders",
    helperSource.includes("fulfillsOnlineOrders !== true") ||
      helperSource.includes("fulfillsOnlineOrders === true"),
  );

  ctx.scenario("B. Inventory item IDs and activation payload");
  ctx.assertEqual(
    "expected inventory item count is 18",
    BOX_V2_EXPECTED_INVENTORY_ITEM_COUNT,
    18,
  );
  ctx.assertEqual(
    "collects unique inventory item ids",
    collectInventoryItemIds(EIGHTEEN_ITEMS).length,
    18,
  );
  const updates = buildInventoryActivationUpdates([
    "gid://shopify/Location/online-1",
    "gid://shopify/Location/online-2",
  ]);
  ctx.assertEqual("one update per location", updates.length, 2);
  ctx.assertTrue(
    "every update is activate true",
    updates.every((update) => update.activate === true),
  );
  ctx.assertFalse(
    "payload has no quantity",
    JSON.stringify(updates).includes("quantity") ||
      JSON.stringify(updates).includes("availableQuantity") ||
      JSON.stringify(updates).includes("available"),
  );
  ctx.assertTrue(
    "mutation is inventoryBulkToggleActivation",
    BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION.includes(
      "inventoryBulkToggleActivation",
    ),
  );
  ctx.assertFalse(
    "mutation does not set quantities",
    BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION.includes(
      "inventorySetQuantities",
    ) ||
      BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION.includes(
        "inventoryAdjustQuantities",
      ) ||
      BOX_V2_INVENTORY_BULK_TOGGLE_ACTIVATION_MUTATION.includes("availableQuantity"),
  );
  ctx.assertTrue(
    "inventory item query reads inventoryItem.id",
    BOX_V2_PRODUCT_INVENTORY_ITEMS_QUERY.includes("inventoryItem"),
  );
  ctx.assertTrue(
    "locations query still reads fulfillsOnlineOrders for diagnostics",
    BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("isActive") &&
      BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("fulfillsOnlineOrders") &&
      BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("isFulfillmentService"),
  );
  ctx.assertTrue(
    "locations query is paginated with pageInfo",
    BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("$after") &&
      BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("pageInfo") &&
      BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("hasNextPage") &&
      BOX_V2_ELIGIBLE_LOCATIONS_QUERY.includes("endCursor"),
  );
  ctx.assertEqual("locations page size", BOX_V2_LOCATIONS_PAGE_SIZE, 50);

  ctx.scenario("C. TEST 1 — 18 items activated at eligible locations, no quantity");
  const successMock = createActivationAdmin();
  const success = await ensureInventoryItemsActivatedAtEligibleLocations(
    successMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertTrue("activation ok", success.ok);
  ctx.assertEqual("no errors", success.errors.length, 0);
  ctx.assertEqual(
    "18 activation mutations",
    successMock.calls.filter((call) =>
      call.query.includes("inventoryBulkToggleActivation"),
    ).length,
    18,
  );
  const firstActivation = successMock.calls.find((call) =>
    call.query.includes("inventoryBulkToggleActivation"),
  );
  const firstUpdates = firstActivation?.variables?.inventoryItemUpdates as
    | { activate?: boolean; locationId?: string }[]
    | undefined;
  ctx.assertEqual("one location in updates", firstUpdates?.length, 1);
  ctx.assertEqual(
    "activate true",
    firstUpdates?.[0]?.activate,
    true,
  );
  ctx.assertEqual(
    "eligible location id",
    firstUpdates?.[0]?.locationId,
    ELIGIBLE_LOCATION.id,
  );
  ctx.assertFalse(
    "no quantity in activation variables",
    JSON.stringify(firstActivation?.variables ?? {}).includes("quantity") ||
      JSON.stringify(firstActivation?.variables ?? {}).includes("availableQuantity"),
  );

  ctx.scenario("C2. TEST B — France-like merchant location is activated");
  const franceMock = createActivationAdmin({
    locations: [ELIGIBLE_LOCATION, FRANCE_LIKE_LOCATION],
  });
  const franceResult = await ensureInventoryItemsActivatedAtEligibleLocations(
    franceMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertTrue("France-like activation ok", franceResult.ok);
  const franceActivation = franceMock.calls.find((call) =>
    call.query.includes("inventoryBulkToggleActivation"),
  );
  const franceUpdates = franceActivation?.variables?.inventoryItemUpdates as
    | { activate?: boolean; locationId?: string }[]
    | undefined;
  ctx.assertEqual(
    "online + France-like locations both activated",
    JSON.stringify((franceUpdates ?? []).map((update) => update.locationId)),
    JSON.stringify([ELIGIBLE_LOCATION.id, FRANCE_LIKE_LOCATION.id]),
  );
  ctx.assertTrue(
    "France-like updates remain activate true",
    (franceUpdates ?? []).every((update) => update.activate === true),
  );

  ctx.scenario("D. TEST 2 — tracked false / CONTINUE remain target config");
  ctx.assertTrue(
    "helper never writes tracked true",
    !helperSource.includes("tracked: true") &&
      !helperSource.includes('tracked: true'),
  );
  ctx.assertTrue(
    "catalog create input sets CONTINUE",
    catalogSource.includes('inventoryPolicy: "CONTINUE"'),
  );
  ctx.assertTrue(
    "catalog create input sets tracked false",
    catalogSource.includes("tracked: false"),
  );
  ctx.assertFalse(
    "helper has no inventorySetQuantities",
    helperSource.includes("inventorySetQuantities"),
  );
  ctx.assertFalse(
    "helper has no inventoryAdjustQuantities",
    helperSource.includes("inventoryAdjustQuantities"),
  );
  ctx.assertFalse(
    "helper never deactivates",
    helperSource.includes("activate: false") ||
      helperSource.includes("activate: false as"),
  );

  ctx.scenario("E. TEST 3 — rerun with empty userErrors reconverges");
  ctx.assertFalse(
    "no text-based already-stocked heuristic",
    helperSource.toLowerCase().includes("already stocked") ||
      helperSource.toLowerCase().includes("already activated") ||
      helperSource.includes("isBenignInventoryActivationUserError") ||
      helperSource.includes('code.includes("ALREADY")'),
  );
  const rerunMock = createActivationAdmin();
  const rerun = await ensureInventoryItemsActivatedAtEligibleLocations(
    rerunMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertTrue("rerun still ok when Shopify accepts activate true", rerun.ok);
  ctx.assertEqual("rerun has no errors", rerun.errors.length, 0);
  ctx.assertEqual(
    "rerun still sends 18 activate-true mutations",
    rerunMock.calls.filter((call) =>
      call.query.includes("inventoryBulkToggleActivation"),
    ).length,
    18,
  );

  ctx.scenario("F. TEST 4 — any Shopify userError fails provisioning");
  const alreadyMessageMock = createActivationAdmin({
    activationUserErrors: [
      { message: "Inventory item is already stocked at this location" },
    ],
  });
  const alreadyMessage = await ensureInventoryItemsActivatedAtEligibleLocations(
    alreadyMessageMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertFalse(
    "already-stocked message is not treated as success",
    alreadyMessage.ok,
  );
  ctx.assertTrue(
    "already-stocked message remains a userError",
    alreadyMessage.errors.some((error) =>
      error.includes("already stocked at this location"),
    ),
  );

  const failingMock = createActivationAdmin({
    activationUserErrors: [
      { code: "LOCATION_NOT_FOUND", message: "Location not found" },
    ],
  });
  const failing = await ensureInventoryItemsActivatedAtEligibleLocations(
    failingMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertFalse("activation not ok", failing.ok);
  ctx.assertTrue(
    "surfaces location activation failure",
    failing.errors.some((error) =>
      error.includes("Impossible d’activer Box Mileyo V2"),
    ),
  );
  ctx.assertTrue(
    "keeps Shopify userError",
    failing.errors.some((error) => error.includes("Location not found")),
  );

  const catalogFailingAdmin = {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("BoxV2ProductByHandle")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: "gid://shopify/Product/v2-exact",
                  title: "Box Mileyo V2",
                  handle: BOX_V2_PRODUCT_HANDLE,
                  status: "DRAFT",
                  options: [],
                  variants: { nodes: [] },
                },
              ],
            },
          },
        });
      }
      return failingMock.admin.graphql(query, options);
    },
  };
  const blockedStructure = await setupV2BoxCatalog(catalogFailingAdmin);
  ctx.assertEqual(
    "mismatched existing product stays blocked, not a fake created success",
    blockedStructure.status,
    "blocked",
  );
  ctx.assertFalse("blocked is not ok", blockedStructure.ok);

  ctx.scenario("G. TEST 5 — zero eligible locations");
  const emptyLocations = createActivationAdmin({
    locations: [
      {
        ...ELIGIBLE_LOCATION,
        id: "gid://shopify/Location/3pl",
        isFulfillmentService: true,
      },
    ],
  });
  const emptyResult = await ensureInventoryItemsActivatedAtEligibleLocations(
    emptyLocations.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertFalse("zero eligible locations is not ok", emptyResult.ok);
  ctx.assertTrue(
    "clear zero-location error",
    emptyResult.errors.some((error) =>
      error.includes("Aucun emplacement Shopify éligible"),
    ),
  );
  ctx.assertEqual(
    "does not attempt activation without locations",
    emptyLocations.calls.filter((call) =>
      call.query.includes("inventoryBulkToggleActivation"),
    ).length,
    0,
  );

  ctx.scenario("H. TEST E — pagination uses merchant locations from page 1 and page 2");
  const page2Cursor = "cursor-locations-page-2";
  const pagedMock = createActivationAdmin({
    locationPages: [
      {
        after: null,
        endCursor: page2Cursor,
        hasNextPage: true,
        nodes: [ELIGIBLE_LOCATION, INELIGIBLE_3PL_LOCATION],
      },
      {
        after: page2Cursor,
        endCursor: "cursor-locations-end",
        hasNextPage: false,
        nodes: [FRANCE_LIKE_LOCATION],
      },
    ],
  });
  const paged = await ensureInventoryItemsActivatedAtEligibleLocations(
    pagedMock.admin,
    "gid://shopify/Product/v2",
  );
  ctx.assertTrue("paginated activation ok", paged.ok);
  const locationQueries = pagedMock.calls.filter((call) =>
    call.query.includes("BoxV2EligibleLocations"),
  );
  ctx.assertEqual("fetches two location pages", locationQueries.length, 2);
  ctx.assertEqual(
    "page 1 starts without cursor",
    locationQueries[0]?.variables?.after ?? null,
    null,
  );
  ctx.assertEqual(
    "page 1 requests page size",
    locationQueries[0]?.variables?.first,
    BOX_V2_LOCATIONS_PAGE_SIZE,
  );
  ctx.assertEqual(
    "page 2 uses endCursor",
    locationQueries[1]?.variables?.after,
    page2Cursor,
  );
  const pagedActivation = pagedMock.calls.find((call) =>
    call.query.includes("inventoryBulkToggleActivation"),
  );
  const pagedUpdates = pagedActivation?.variables?.inventoryItemUpdates as
    | { activate?: boolean; locationId?: string }[]
    | undefined;
  ctx.assertEqual(
    "eligible merchant locations from both pages including France-like",
    JSON.stringify((pagedUpdates ?? []).map((update) => update.locationId)),
    JSON.stringify([ELIGIBLE_LOCATION.id, FRANCE_LIKE_LOCATION.id]),
  );
  ctx.assertFalse(
    "3PL from page 1 is not activated",
    (pagedUpdates ?? []).some(
      (update) => update.locationId === INELIGIBLE_3PL_LOCATION.id,
    ),
  );
  ctx.assertTrue(
    "paginated updates remain activate true only",
    (pagedUpdates ?? []).every((update) => update.activate === true),
  );

  ctx.scenario("I. TEST 6 — selling plan / publication / pricing not touched");
  ctx.assertFalse(
    "helper does not mention sellingPlan",
    helperSource.toLowerCase().includes("sellingplan"),
  );
  ctx.assertFalse(
    "helper does not publish products",
    helperSource.includes("publishablePublish") ||
      helperSource.includes("productUpdate"),
  );
  ctx.assertFalse(
    "helper does not change prices",
    helperSource.includes("price"),
  );
  ctx.assertFalse(
    "helper does not touch launch discount",
    helperSource.includes("FIRST_BOX_LAUNCH_DISCOUNT"),
  );
  ctx.assertTrue(
    "catalog still create-only via productSet",
    catalogSource.includes("BOX_V2_PRODUCT_SET_CREATE_MUTATION"),
  );

  ctx.scenario("J. Scopes — only locations + write_inventory");
  ctx.assertTrue(
    "dev toml adds read_locations",
    devToml.includes("read_locations"),
  );
  ctx.assertTrue(
    "dev toml adds write_inventory",
    devToml.includes("write_inventory"),
  );
  ctx.assertTrue(
    "production toml adds read_locations",
    productionToml.includes("read_locations"),
  );
  ctx.assertTrue(
    "production toml adds write_inventory",
    productionToml.includes("write_inventory"),
  );
  ctx.assertFalse(
    "dev toml does not add read_inventory",
    /scopes = ".*read_inventory/.test(devToml),
  );
  ctx.assertFalse(
    "production toml does not add read_inventory",
    /scopes = ".*read_inventory/.test(productionToml),
  );

  return finishSuite("23-settings-v2-box-inventory-activation", ctx);
};

runSuite()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
