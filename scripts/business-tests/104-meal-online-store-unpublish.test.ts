/**
 * Business regression — unpublish meal catalog from Online Store only.
 *
 * Pure helpers + mocked Admin GraphQL. No live Shopify mutations.
 * Never uses price == 0. Never touches non–Online Store publications.
 * Online Store resolved via AppCatalog apps.handle === "online_store".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONFIRM_UNPUBLISH_MEALS_ONLINE_STORE_FIELD,
  MEAL_COLLECTION_ONLINE_STORE_PUBLICATION_QUERY,
  MEAL_ONLINE_STORE_UNPUBLISH_MAX_PAGES,
  MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE,
  MEAL_PUBLICATION_OPTIONAL_SCOPE,
  MEAL_PUBLISHABLE_UNPUBLISH_MUTATION,
  ONLINE_STORE_APP_HANDLE,
  PUBLICATIONS_FOR_ONLINE_STORE_QUERY,
  REQUEST_MEAL_PUBLICATION_SCOPES_INTENT,
  UNPUBLISH_MEALS_ONLINE_STORE_INTENT,
  emptyMealOnlineStoreUnpublishResult,
  formatMealOnlineStoreUnpublishMessage,
  hasWritePublicationsScope,
  mergeMealCatalogSetupWithOnlineStoreProtection,
  partitionMealsByOnlineStorePublication,
  publicationHasOnlineStoreAppHandle,
  resolveOnlineStorePublicationId,
  unpublishMealsFromOnlineStore,
  unpublishProductFromOnlineStore,
  type MealOnlineStoreUnpublishResult,
  type MealPublicationProductNode,
  type ShopifyAppPublicationNode,
} from "../../app/services/mealOnlineStoreUnpublish.server";
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

const ONLINE_STORE_PUBLICATION_ID = "gid://shopify/Publication/online-1";
const FACEBOOK_PUBLICATION_ID = "gid://shopify/Publication/facebook-1";
const POS_PUBLICATION_ID = "gid://shopify/Publication/pos-1";
const MEAL_COLLECTION_ID = "gid://shopify/Collection/meal-1";

const appPublication = ({
  id,
  appHandle,
  catalogTitle = "Channel Catalog",
}: {
  id: string;
  appHandle: string | null;
  catalogTitle?: string;
}): ShopifyAppPublicationNode => ({
  id,
  catalog: {
    id: `gid://shopify/AppCatalog/${id}`,
    title: catalogTitle,
    apps: {
      nodes: appHandle
        ? [{ id: `gid://shopify/App/${appHandle}`, handle: appHandle, title: catalogTitle }]
        : [],
    },
  },
});

const mealProduct = (
  overrides: Partial<MealPublicationProductNode> & { id: string; title: string },
): MealPublicationProductNode => ({
  handle: overrides.handle ?? "meal-handle",
  status: overrides.status ?? "ACTIVE",
  publishedOnOnlineStore: overrides.publishedOnOnlineStore ?? true,
  ...overrides,
});

const createAdminMock = (handler: (call: GraphqlCall) => unknown) => {
  const calls: GraphqlCall[] = [];
  return {
    calls,
    admin: {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, unknown> },
      ) => {
        const call = { query, variables: options?.variables };
        calls.push(call);
        return jsonResponse(handler(call));
      },
    },
  };
};

const publicationsPayload = (nodes: ShopifyAppPublicationNode[]) => ({
  data: { publications: { nodes } },
});

const defaultPublications = () =>
  publicationsPayload([
    appPublication({
      id: FACEBOOK_PUBLICATION_ID,
      appHandle: "facebook",
      catalogTitle: "Facebook & Instagram",
    }),
    appPublication({
      id: ONLINE_STORE_PUBLICATION_ID,
      appHandle: ONLINE_STORE_APP_HANDLE,
      catalogTitle: "Canal boutique (libellé localisé quelconque)",
    }),
    appPublication({
      id: POS_PUBLICATION_ID,
      appHandle: "point_of_sale",
      catalogTitle: "Point of Sale",
    }),
  ]);

const collectionPagePayload = ({
  nodes,
  hasNextPage = false,
  endCursor = null as string | null,
  collectionId = MEAL_COLLECTION_ID,
}: {
  nodes: MealPublicationProductNode[];
  hasNextPage?: boolean;
  endCursor?: string | null;
  collectionId?: string;
}) => ({
  data: {
    collection: {
      id: collectionId,
      products: {
        pageInfo: { hasNextPage, endCursor },
        nodes,
      },
    },
  },
});

const unpublishOkPayload = (publishedOnPublication: boolean | null = false) => ({
  data: {
    publishableUnpublish: {
      publishable: {
        id: "gid://shopify/Product/1",
        publishedOnPublication,
      },
      userErrors: [],
    },
  },
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("104-meal-online-store-unpublish");

  ctx.scenario("A. Online Store resolved by app handle — not title");
  ctx.assertEqual("handle constant", ONLINE_STORE_APP_HANDLE, "online_store");
  ctx.assertTrue(
    "online_store handle matches",
    publicationHasOnlineStoreAppHandle(
      appPublication({
        id: ONLINE_STORE_PUBLICATION_ID,
        appHandle: "online_store",
        catalogTitle: "Anything localized",
      }),
    ),
  );
  ctx.assertFalse(
    "Facebook ignored despite Online Store-like title",
    publicationHasOnlineStoreAppHandle(
      appPublication({
        id: FACEBOOK_PUBLICATION_ID,
        appHandle: "facebook",
        catalogTitle: "Online Store",
      }),
    ),
  );
  ctx.assertFalse(
    "Boutique en ligne title alone does not match",
    publicationHasOnlineStoreAppHandle(
      appPublication({
        id: "gid://shopify/Publication/x",
        appHandle: "shop",
        catalogTitle: "Boutique en ligne",
      }),
    ),
  );

  const resolveOk = resolveOnlineStorePublicationId([
    appPublication({ id: FACEBOOK_PUBLICATION_ID, appHandle: "facebook" }),
    appPublication({
      id: ONLINE_STORE_PUBLICATION_ID,
      appHandle: "online_store",
      catalogTitle: "Channel Catalog uuid-localized",
    }),
    appPublication({ id: POS_PUBLICATION_ID, appHandle: "point_of_sale" }),
  ]);
  ctx.assertTrue("resolve ok", resolveOk.ok);
  if (resolveOk.ok) {
    ctx.assertEqual(
      "resolve publication id",
      resolveOk.publicationId,
      ONLINE_STORE_PUBLICATION_ID,
    );
  }

  ctx.assertFalse(
    "zero match fails",
    resolveOnlineStorePublicationId([
      appPublication({ id: FACEBOOK_PUBLICATION_ID, appHandle: "facebook" }),
    ]).ok,
  );
  ctx.assertFalse(
    "ambiguity fails",
    resolveOnlineStorePublicationId([
      appPublication({ id: "gid://shopify/Publication/a", appHandle: "online_store" }),
      appPublication({ id: "gid://shopify/Publication/b", appHandle: "online_store" }),
    ]).ok,
  );
  ctx.assertFalse(
    "no first-publication fallback",
    resolveOnlineStorePublicationId([
      appPublication({ id: FACEBOOK_PUBLICATION_ID, appHandle: "facebook" }),
      appPublication({ id: POS_PUBLICATION_ID, appHandle: null }),
    ]).ok,
  );

  ctx.scenario("B. Ambiguity => no publishableUnpublish");
  const ambiguousMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return publicationsPayload([
        appPublication({ id: "gid://shopify/Publication/a", appHandle: "online_store" }),
        appPublication({ id: "gid://shopify/Publication/b", appHandle: "online_store" }),
      ]);
    }
    return { data: {} };
  });
  const ambiguousResult = await unpublishMealsFromOnlineStore(
    ambiguousMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertFalse("ambiguous not ok", ambiguousResult.ok);
  ctx.assertEqual(
    "ambiguous no unpublish mutations",
    ambiguousMock.calls.filter((call) =>
      call.query.includes("publishableUnpublish"),
    ).length,
    0,
  );
  ctx.assertEqual(
    "ambiguous no collection scan",
    ambiguousMock.calls.filter((call) =>
      call.query.includes("MealCollectionOnlineStorePublication"),
    ).length,
    0,
  );

  ctx.scenario("C. Partition published vs already unpublished");
  const partition = partitionMealsByOnlineStorePublication([
    mealProduct({
      id: "gid://shopify/Product/published",
      title: "Published",
      publishedOnOnlineStore: true,
    }),
    mealProduct({
      id: "gid://shopify/Product/protected",
      title: "Protected",
      publishedOnOnlineStore: false,
    }),
  ]);
  ctx.assertEqual("toUnpublish count", partition.toUnpublish.length, 1);
  ctx.assertEqual(
    "alreadyUnpublished count",
    partition.alreadyUnpublished.length,
    1,
  );

  ctx.scenario("D. Published meal => publishableUnpublish + verified false");
  const publishedMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      return collectionPagePayload({
        nodes: [
          mealProduct({
            id: "gid://shopify/Product/meal-a",
            title: "Boulgour",
            publishedOnOnlineStore: true,
          }),
        ],
      });
    }
    if (call.query.includes("publishableUnpublish")) {
      return unpublishOkPayload(false);
    }
    return { data: {} };
  });
  const publishedResult = await unpublishMealsFromOnlineStore(
    publishedMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("published run ok", publishedResult.ok);
  ctx.assertEqual("unpublished", publishedResult.unpublished, 1);
  const unpublishCalls = publishedMock.calls.filter((call) =>
    call.query.includes("publishableUnpublish"),
  );
  ctx.assertEqual("one unpublish mutation", unpublishCalls.length, 1);
  ctx.assertEqual(
    "unpublish Online Store only",
    JSON.stringify(unpublishCalls[0]?.variables?.input),
    JSON.stringify([{ publicationId: ONLINE_STORE_PUBLICATION_ID }]),
  );
  ctx.assertFalse(
    "never Facebook",
    JSON.stringify(unpublishCalls[0]?.variables).includes(FACEBOOK_PUBLICATION_ID),
  );

  ctx.scenario("E. Post-unpublish verification required");
  const stillPublished = await unpublishProductFromOnlineStore(
    createAdminMock(() => unpublishOkPayload(true)).admin,
    "gid://shopify/Product/x",
    ONLINE_STORE_PUBLICATION_ID,
  );
  ctx.assertFalse("still published fails", stillPublished.ok);
  const missingFlag = await unpublishProductFromOnlineStore(
    createAdminMock(() => unpublishOkPayload(null)).admin,
    "gid://shopify/Product/y",
    ONLINE_STORE_PUBLICATION_ID,
  );
  ctx.assertFalse("null publishedOnPublication fails", missingFlag.ok);

  ctx.scenario("F. Already unpublished => no mutation");
  const protectedMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      return collectionPagePayload({
        nodes: [
          mealProduct({
            id: "gid://shopify/Product/meal-b",
            title: "Orzo",
            publishedOnOnlineStore: false,
          }),
        ],
      });
    }
    return { data: {} };
  });
  const protectedResult = await unpublishMealsFromOnlineStore(
    protectedMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("protected ok", protectedResult.ok);
  ctx.assertEqual("protected already", protectedResult.alreadyUnpublished, 1);
  ctx.assertEqual(
    "no mutation",
    protectedMock.calls.filter((call) =>
      call.query.includes("publishableUnpublish"),
    ).length,
    0,
  );

  ctx.scenario("G. Idempotent double run");
  let publishedOnStore = true;
  const idempotentMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      return collectionPagePayload({
        nodes: [
          mealProduct({
            id: "gid://shopify/Product/meal-c",
            title: "Poulet",
            publishedOnOnlineStore: publishedOnStore,
          }),
        ],
      });
    }
    if (call.query.includes("publishableUnpublish")) {
      publishedOnStore = false;
      return unpublishOkPayload(false);
    }
    return { data: {} };
  });
  const first = await unpublishMealsFromOnlineStore(
    idempotentMock.admin,
    MEAL_COLLECTION_ID,
  );
  const second = await unpublishMealsFromOnlineStore(
    idempotentMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertEqual("first unpublished", first.unpublished, 1);
  ctx.assertEqual("second already", second.alreadyUnpublished, 1);
  ctx.assertEqual(
    "one mutation total",
    idempotentMock.calls.filter((call) =>
      call.query.includes("publishableUnpublish"),
    ).length,
    1,
  );

  ctx.scenario("H. Empty collection / missing id / Shopify errors");
  const emptyMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      return collectionPagePayload({ nodes: [] });
    }
    return { data: {} };
  });
  const emptyResult = await unpublishMealsFromOnlineStore(
    emptyMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("empty ok", emptyResult.ok);
  ctx.assertEqual("empty total", emptyResult.totalMeals, 0);

  const missing = await unpublishMealsFromOnlineStore(
    createAdminMock(() => ({ data: {} })).admin,
    null,
  );
  ctx.assertFalse("missing collection not ok", missing.ok);

  const errorMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      return collectionPagePayload({
        nodes: [
          mealProduct({
            id: "gid://shopify/Product/meal-err",
            title: "Erreur",
            publishedOnOnlineStore: true,
          }),
        ],
      });
    }
    if (call.query.includes("publishableUnpublish")) {
      return {
        data: {
          publishableUnpublish: {
            publishable: null,
            userErrors: [{ message: "Access denied for publications" }],
          },
        },
      };
    }
    return { data: {} };
  });
  const errorResult = await unpublishMealsFromOnlineStore(
    errorMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertFalse("error not ok", errorResult.ok);
  ctx.assertEqual("failed", errorResult.failed, 1);

  ctx.scenario("I. Pagination");
  const page1Nodes = Array.from(
    { length: MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE },
    (_, i) =>
      mealProduct({
        id: `gid://shopify/Product/page1-${i + 1}`,
        title: `Meal ${i + 1}`,
        publishedOnOnlineStore: i === 0,
      }),
  );
  const pagedMock = createAdminMock((call) => {
    if (call.query.includes("AppPublicationsForOnlineStore")) {
      return defaultPublications();
    }
    if (call.query.includes("MealCollectionOnlineStorePublication")) {
      if (!call.variables?.after) {
        return collectionPagePayload({
          nodes: page1Nodes,
          hasNextPage: true,
          endCursor: "cursor-page-1",
        });
      }
      return collectionPagePayload({
        nodes: [
          mealProduct({
            id: "gid://shopify/Product/page2-1",
            title: "Meal page2",
            publishedOnOnlineStore: true,
          }),
        ],
      });
    }
    if (call.query.includes("publishableUnpublish")) {
      return unpublishOkPayload(false);
    }
    return { data: {} };
  });
  const paged = await unpublishMealsFromOnlineStore(
    pagedMock.admin,
    MEAL_COLLECTION_ID,
  );
  ctx.assertTrue("paged ok", paged.ok);
  ctx.assertEqual(
    "paged total",
    paged.totalMeals,
    MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE + 1,
  );
  ctx.assertEqual("paged unpublished", paged.unpublished, 2);

  ctx.scenario("J. Fail-closed order: protect before provisioning");
  const actionsSource = readRepoFile(
    "app/features/settings/settings-actions.server.ts",
  );
  const setupBlockStart = actionsSource.indexOf(
    'if (intent === SETUP_V2_MEAL_CATALOG_INTENT)',
  );
  const setupBlockEnd = actionsSource.indexOf(
    'if (intent === UNPUBLISH_MEALS_ONLINE_STORE_INTENT)',
    setupBlockStart,
  );
  ctx.assertTrue("setup intent block found", setupBlockStart >= 0);
  ctx.assertTrue("unpublish intent block found", setupBlockEnd > setupBlockStart);
  const setupBlock = actionsSource.slice(setupBlockStart, setupBlockEnd);
  const unpublishIdx = setupBlock.indexOf("unpublishMealsFromOnlineStore");
  const catalogIdx = setupBlock.indexOf("setupV2MealCatalog");
  const guardIdx = setupBlock.indexOf("if (!unpublishResult.ok)");
  ctx.assertTrue("setup block has unpublish", unpublishIdx >= 0);
  ctx.assertTrue("setup block has catalog", catalogIdx >= 0);
  ctx.assertTrue(
    "unpublish before catalog",
    unpublishIdx >= 0 && catalogIdx >= 0 && unpublishIdx < catalogIdx,
  );
  ctx.assertTrue(
    "guard before catalog",
    guardIdx >= 0 && catalogIdx >= 0 && guardIdx < catalogIdx,
  );
  ctx.assertTrue(
    "cancelled message when protect fails",
    setupBlock.includes("aucune conversion effectuée"),
  );

  const unpublishFail: MealOnlineStoreUnpublishResult =
    emptyMealOnlineStoreUnpublishResult({
      errors: ["publication API down"],
      failed: 1,
      ok: false,
      totalMeals: 3,
    });
  const mergedFail = mergeMealCatalogSetupWithOnlineStoreProtection({
    catalogErrors: [],
    catalogMessage: "Catalogue Repas V2 : 1 convertis.",
    catalogOk: true,
    unpublish: unpublishFail,
  });
  ctx.assertFalse("merge fails if unpublish fails", mergedFail.ok);

  ctx.scenario("K. Optional scopes architecture");
  const devToml = readRepoFile("shopify.app.dev.toml");
  const productionToml = readRepoFile("shopify.app.production.toml");
  ctx.assertTrue(
    "dev optional write_publications",
    /optional_scopes\s*=\s*\[[^\]]*write_publications/.test(devToml),
  );
  ctx.assertTrue(
    "production optional write_publications",
    /optional_scopes\s*=\s*\[[^\]]*write_publications/.test(productionToml),
  );
  ctx.assertFalse(
    "dev required scopes exclude write_publications",
    /scopes\s*=\s*"[^"]*write_publications/.test(devToml),
  );
  ctx.assertFalse(
    "dev required scopes exclude read_publications",
    /scopes\s*=\s*"[^"]*read_publications/.test(devToml),
  );
  ctx.assertFalse(
    "production required scopes exclude write_publications",
    /scopes\s*=\s*"[^"]*write_publications/.test(productionToml),
  );
  ctx.assertEqual(
    "optional scope constant",
    MEAL_PUBLICATION_OPTIONAL_SCOPE,
    "write_publications",
  );
  ctx.assertTrue(
    "hasWritePublicationsScope true",
    hasWritePublicationsScope(["write_products", "write_publications"]),
  );
  ctx.assertFalse(
    "read alone insufficient for mutations",
    hasWritePublicationsScope(["read_publications"]),
  );
  ctx.assertTrue(
    "request scopes intent",
    REQUEST_MEAL_PUBLICATION_SCOPES_INTENT === "requestMealPublicationScopes",
  );
  ctx.assertTrue(
    "actions request intent wired",
    actionsSource.includes("REQUEST_MEAL_PUBLICATION_SCOPES_INTENT"),
  );
  ctx.assertTrue(
    "actions gate on write_publications",
    actionsSource.includes("ensureWritePublicationsOrExplain") ||
      actionsSource.includes("hasWritePublicationsScope"),
  );

  ctx.scenario("L. Safety + wiring");
  const serviceSource = readRepoFile(
    "app/services/mealOnlineStoreUnpublish.server.ts",
  );
  const renderSource = readRepoFile(
    "app/features/settings/settings-render.tsx",
  );
  const settingsRoute = readRepoFile("app/routes/app.settings.tsx");
  ctx.assertTrue(
    "catalogType APP query",
    PUBLICATIONS_FOR_ONLINE_STORE_QUERY.includes("catalogType: APP"),
  );
  ctx.assertTrue(
    "apps handle in query",
    PUBLICATIONS_FOR_ONLINE_STORE_QUERY.includes("handle"),
  );
  ctx.assertFalse(
    "no EN/FR name list",
    serviceSource.includes("boutique en ligne") &&
      serviceSource.includes("ONLINE_STORE_PUBLICATION_NAMES"),
  );
  ctx.assertFalse("no productDelete", serviceSource.includes("productDelete"));
  ctx.assertTrue(
    "mutation verifies publishedOnPublication",
    MEAL_PUBLISHABLE_UNPUBLISH_MUTATION.includes("publishedOnPublication"),
  );
  ctx.assertTrue(
    "render authorize button",
    renderSource.includes("Autoriser l’accès publications"),
  );
  ctx.assertTrue(
    "settings loader queries scopes",
    settingsRoute.includes("scopes.query") &&
      settingsRoute.includes("hasWritePublications"),
  );
  ctx.assertEqual(
    "intent",
    UNPUBLISH_MEALS_ONLINE_STORE_INTENT,
    "unpublishMealsOnlineStore",
  );
  ctx.assertEqual(
    "confirm field",
    CONFIRM_UNPUBLISH_MEALS_ONLINE_STORE_FIELD,
    "confirmUnpublishMealsOnlineStore",
  );
  ctx.assertTrue(
    "collection query binds mealCollectionId",
    MEAL_COLLECTION_ONLINE_STORE_PUBLICATION_QUERY.includes("collection(id: $id)"),
  );
  ctx.assertEqual("page size", MEAL_ONLINE_STORE_UNPUBLISH_PAGE_SIZE, 50);
  ctx.assertEqual("max pages", MEAL_ONLINE_STORE_UNPUBLISH_MAX_PAGES, 20);
  ctx.assertTrue(
    "format message",
    formatMealOnlineStoreUnpublishMessage({
      alreadyUnpublished: 1,
      errors: [],
      failed: 0,
      ok: true,
      onlineStorePublicationId: ONLINE_STORE_PUBLICATION_ID,
      totalMeals: 3,
      unpublished: 2,
    }).includes("3 analysés"),
  );
  ctx.assertFalse(
    "builder checkout untouched",
    readRepoFile("app/features/builder/builder-checkout.server.ts").includes(
      "publishableUnpublish",
    ),
  );
  ctx.assertFalse(
    "billing untouched",
    readRepoFile("app/services/subscriptionBillingWorker.server.ts").includes(
      "publishableUnpublish",
    ),
  );

  return finishSuite("104-meal-online-store-unpublish", ctx);
};

runSuite()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
