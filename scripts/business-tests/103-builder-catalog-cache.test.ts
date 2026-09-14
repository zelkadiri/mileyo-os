/**
 * Process-local builder catalog cache: TTL, isolation, errors, stampede, scope.
 */
import { createBusinessTestContext, finishSuite } from "./_framework";
import {
  BUILDER_CATALOG_CACHE_TTL_MS,
  __expireBuilderCatalogCacheEntryForTests,
  __getBuilderCatalogCacheSizeForTests,
  __resetBuilderCatalogCacheForTests,
  builderBoxesCacheKey,
  builderMealsCacheKey,
  getOrFetchBuilderCatalog,
} from "../../app/features/builder/builder-catalog-cache.server";
import {
  fetchBuilderBoxOptions,
  fetchCachedBuilderBoxOptions,
  fetchCachedBuilderMealOptions,
} from "../../app/features/builder/builder-catalog.server";
import {
  getBuilderPerfTimings,
  runWithBuilderPerfTimings,
} from "../../app/utils/perfTimings.server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runSuite = async () => {
  const ctx = createBusinessTestContext("103-builder-catalog-cache");

  ctx.scenario("A. Constants and collision-safe keys");
  {
    ctx.assertEqual("TTL is 30s", BUILDER_CATALOG_CACHE_TTL_MS, 30_000);
    ctx.assertEqual(
      "boxes key JSON",
      builderBoxesCacheKey("a.myshopify.com"),
      JSON.stringify(["boxes", "a.myshopify.com"]),
    );
    ctx.assertEqual(
      "meals key JSON includes shop + collection",
      builderMealsCacheKey("a.myshopify.com", "gid://shopify/Collection/1"),
      JSON.stringify([
        "meals",
        "a.myshopify.com",
        "gid://shopify/Collection/1",
      ]),
    );
    ctx.assertTrue(
      "no delimiter collision shop vs collection",
      builderMealsCacheKey("a", "b:c") !== builderMealsCacheKey("a:b", "c"),
    );
    ctx.assertTrue(
      "shops isolated",
      builderBoxesCacheKey("shop-a") !== builderBoxesCacheKey("shop-b"),
    );

    let emptyShopError: unknown;
    try {
      builderBoxesCacheKey("  ");
    } catch (error) {
      emptyShopError = error;
    }
    ctx.assertTrue(
      "empty shop rejected",
      emptyShopError instanceof Error,
    );
  }

  ctx.scenario("B. Miss / hit / distinct keys / TTL");
  {
    __resetBuilderCatalogCacheForTests();
    let fetches = 0;
    const fetchFn = async () => {
      fetches += 1;
      return { n: fetches };
    };

    const first = await getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "k1",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("1 miss fetches", fetches, 1);
    ctx.assertEqual("1 cacheHit false", first.cacheHit, false);

    const second = await getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "k1",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("2 hit no fetch", fetches, 1);
    ctx.assertEqual("2 cacheHit true", second.cacheHit, true);
    ctx.assertEqual("2 same value", second.value.n, 1);

    const other = await getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "k2",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("3 other key fetches", fetches, 2);
    ctx.assertEqual("3 miss", other.cacheHit, false);

    __expireBuilderCatalogCacheEntryForTests("boxes", "k1");
    const afterExpire = await getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "k1",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("4 expired refetches", fetches, 3);
    ctx.assertEqual("4 miss after expire", afterExpire.cacheHit, false);
    ctx.assertEqual(
      "4 purge removed expired on access",
      __getBuilderCatalogCacheSizeForTests("boxes").entries,
      2,
    );
  }

  ctx.scenario("C. Rejected fetch not cached + retry");
  {
    __resetBuilderCatalogCacheForTests();
    let attempts = 0;
    const boom = new Error("shopify-down");

    let firstError: unknown;
    try {
      await getOrFetchBuilderCatalog({
        fetch: async () => {
          attempts += 1;
          throw boom;
        },
        key: "fail-key",
        kind: "meals",
        ttlMs: 5_000,
      });
    } catch (error) {
      firstError = error;
    }
    ctx.assertEqual("error identical", firstError, boom);
    ctx.assertEqual(
      "no entry",
      __getBuilderCatalogCacheSizeForTests("meals").entries,
      0,
    );
    ctx.assertEqual(
      "in-flight cleared after error",
      __getBuilderCatalogCacheSizeForTests("meals").inFlight,
      0,
    );

    let secondError: unknown;
    try {
      await getOrFetchBuilderCatalog({
        fetch: async () => {
          attempts += 1;
          throw boom;
        },
        key: "fail-key",
        kind: "meals",
        ttlMs: 5_000,
      });
    } catch (error) {
      secondError = error;
    }
    ctx.assertEqual("retry fetches again", attempts, 2);
    ctx.assertEqual("second error identical", secondError, boom);
  }

  ctx.scenario("D. Stampede: one fetch; joiners are not cacheHit");
  {
    __resetBuilderCatalogCacheForTests();
    let fetches = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchFn = async () => {
      fetches += 1;
      await gate;
      return { ok: true };
    };

    const p1 = getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "stampede",
      kind: "boxes",
      ttlMs: 5_000,
    });
    const p2 = getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "stampede",
      kind: "boxes",
      ttlMs: 5_000,
    });

    await sleep(20);
    ctx.assertEqual("one underlying fetch", fetches, 1);
    ctx.assertEqual(
      "one in-flight",
      __getBuilderCatalogCacheSizeForTests("boxes").inFlight,
      1,
    );

    release();
    const [a, b] = await Promise.all([p1, p2]);
    ctx.assertEqual("still one fetch", fetches, 1);
    ctx.assertEqual("leader not cacheHit", a.cacheHit, false);
    ctx.assertEqual("joiner not cacheHit", b.cacheHit, false);
    ctx.assertEqual(
      "in-flight cleared after success",
      __getBuilderCatalogCacheSizeForTests("boxes").inFlight,
      0,
    );

    const warm = await getOrFetchBuilderCatalog({
      fetch: fetchFn,
      key: "stampede",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("warm is cacheHit", warm.cacheHit, true);
    ctx.assertEqual("warm no extra fetch", fetches, 1);
  }

  ctx.scenario("E. Boxes / meals buckets isolated");
  {
    __resetBuilderCatalogCacheForTests();
    let boxFetches = 0;
    let mealFetches = 0;

    await getOrFetchBuilderCatalog({
      fetch: async () => {
        boxFetches += 1;
        return ["box"];
      },
      key: "same-key",
      kind: "boxes",
    });
    await getOrFetchBuilderCatalog({
      fetch: async () => {
        mealFetches += 1;
        return ["meal"];
      },
      key: "same-key",
      kind: "meals",
    });

    const boxHit = await getOrFetchBuilderCatalog({
      fetch: async () => {
        boxFetches += 1;
        return ["x"];
      },
      key: "same-key",
      kind: "boxes",
    });
    const mealHit = await getOrFetchBuilderCatalog({
      fetch: async () => {
        mealFetches += 1;
        return ["y"];
      },
      key: "same-key",
      kind: "meals",
    });
    ctx.assertEqual("boxes fetched once", boxFetches, 1);
    ctx.assertEqual("meals fetched once", mealFetches, 1);
    ctx.assertEqual("boxes value", boxHit.value[0], "box");
    ctx.assertEqual("meals value", mealHit.value[0], "meal");
  }

  ctx.scenario("F. Cached wrappers only; uncached shared helpers");
  {
    __resetBuilderCatalogCacheForTests();

    let boxGraphql = 0;
    let mealGraphql = 0;
    const admin = {
      graphql: async (
        query: string,
        options?: { variables?: Record<string, string> },
      ) => {
        const id = options?.variables?.id ?? options?.variables?.query ?? "";
        if (String(id).includes("Collection") || query.includes("Meal")) {
          mealGraphql += 1;
          return {
            json: async () => ({
              data: {
                collection: {
                  products: { nodes: [], pageInfo: { hasNextPage: false } },
                },
              },
            }),
          } as Response;
        }
        boxGraphql += 1;
        return {
          json: async () => ({ data: { products: { nodes: [] } } }),
        } as Response;
      },
    };

    await fetchCachedBuilderBoxOptions(admin, "shop-a.myshopify.com");
    await fetchCachedBuilderBoxOptions(admin, "shop-a.myshopify.com");
    ctx.assertEqual("cached boxes hit → 1 graphql", boxGraphql, 1);

    await fetchCachedBuilderBoxOptions(admin, "shop-b.myshopify.com");
    ctx.assertEqual("other shop → 2 graphql", boxGraphql, 2);

    // Uncached shared helper always fetches.
    await fetchBuilderBoxOptions(admin);
    await fetchBuilderBoxOptions(admin);
    ctx.assertEqual("uncached boxes always fetch", boxGraphql, 4);

    await fetchCachedBuilderMealOptions(
      admin,
      "gid://shopify/Collection/1",
      "shop-a.myshopify.com",
    );
    await fetchCachedBuilderMealOptions(
      admin,
      "gid://shopify/Collection/1",
      "shop-a.myshopify.com",
    );
    ctx.assertEqual("cached meals hit → 1", mealGraphql, 1);

    await fetchCachedBuilderMealOptions(
      admin,
      "gid://shopify/Collection/2",
      "shop-a.myshopify.com",
    );
    ctx.assertEqual("other collection → 2", mealGraphql, 2);

    await fetchCachedBuilderMealOptions(
      admin,
      "gid://shopify/Collection/1",
      "shop-b.myshopify.com",
    );
    ctx.assertEqual("other shop meals → 3", mealGraphql, 3);

    await runWithBuilderPerfTimings(async () => {
      await fetchCachedBuilderBoxOptions(admin, "shop-a.myshopify.com");
      ctx.assertEqual(
        "ALS boxesCacheHit only on warm value hit",
        getBuilderPerfTimings()?.boxesCacheHit,
        true,
      );
    });
  }

  ctx.scenario("G. Clone blocks mutation of stored entry");
  {
    __resetBuilderCatalogCacheForTests();
    const first = await getOrFetchBuilderCatalog({
      fetch: async () => [{ id: "1" }],
      key: "clone",
      kind: "boxes",
    });
    first.value[0].id = "mutated";
    const second = await getOrFetchBuilderCatalog({
      fetch: async () => [{ id: "nope" }],
      key: "clone",
      kind: "boxes",
    });
    ctx.assertEqual("stored value intact", second.value[0].id, "1");
    ctx.assertEqual("second was hit", second.cacheHit, true);
  }

  ctx.scenario("H. Uncloneable value is not cached");
  {
    __resetBuilderCatalogCacheForTests();
    let attempts = 0;
    const fn = async () => {
      attempts += 1;
      return { fn: () => 1 } as unknown as { n: number };
    };

    let err: unknown;
    try {
      await getOrFetchBuilderCatalog({
        fetch: fn,
        key: "bad",
        kind: "boxes",
        ttlMs: 5_000,
      });
    } catch (error) {
      err = error;
    }
    ctx.assertTrue("clone failure throws", err instanceof Error);
    ctx.assertEqual(
      "nothing cached after clone fail",
      __getBuilderCatalogCacheSizeForTests("boxes").entries,
      0,
    );
    ctx.assertEqual(
      "in-flight cleared after clone fail",
      __getBuilderCatalogCacheSizeForTests("boxes").inFlight,
      0,
    );

    // Retry with serializable payload works.
    const ok = await getOrFetchBuilderCatalog({
      fetch: async () => {
        attempts += 1;
        return { n: 1 };
      },
      key: "bad",
      kind: "boxes",
      ttlMs: 5_000,
    });
    ctx.assertEqual("retry after clone fail works", ok.value.n, 1);
    ctx.assertEqual("attempts include failed + ok", attempts, 2);
  }

  ctx.scenario("I. Scope wiring — cache only on Builder GET loader");
  {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const route = readFileSync(
      join(root, "app/routes/apps.box-builder.tsx"),
      "utf8",
    );
    const catalog = readFileSync(
      join(root, "app/features/builder/builder-catalog.server.ts"),
      "utf8",
    );
    const portalData = readFileSync(
      join(root, "app/features/portal/portal-data.server.ts"),
      "utf8",
    );
    const portalActions = readFileSync(
      join(root, "app/features/portal/portal-actions.server.ts"),
      "utf8",
    );
    const boxChange = readFileSync(
      join(root, "app/services/subscriptionBoxChange.server.ts"),
      "utf8",
    );
    const checkout = readFileSync(
      join(root, "app/features/builder/builder-checkout.server.ts"),
      "utf8",
    );
    const actionBody = route.slice(route.indexOf("export const action"));

    ctx.assertTrue(
      "loader uses fetchCachedBuilderBoxOptions",
      route.includes("fetchCachedBuilderBoxOptions(admin, shop)"),
    );
    ctx.assertTrue(
      "loader uses fetchCachedBuilderMealOptions",
      route.includes("fetchCachedBuilderMealOptions"),
    );
    ctx.assertFalse(
      "action does not call cached catalog",
      actionBody.includes("fetchCachedBuilder"),
    );
    ctx.assertFalse(
      "action does not call uncached catalog either",
      actionBody.includes("fetchBuilderBoxOptions") ||
        actionBody.includes("fetchBuilderMealOptions"),
    );
    ctx.assertTrue(
      "uncached helpers remain for shared callers",
      catalog.includes("no process cache"),
    );
    ctx.assertFalse(
      "portal-data does not use cached wrappers",
      portalData.includes("fetchCachedBuilder"),
    );
    ctx.assertFalse(
      "portal-actions does not use cached wrappers",
      portalActions.includes("fetchCachedBuilder"),
    );
    ctx.assertFalse(
      "subscriptionBoxChange does not use cached wrappers",
      boxChange.includes("fetchCachedBuilder"),
    );
    ctx.assertTrue(
      "portal still uses live fetchBuilderBoxOptions",
      portalData.includes("fetchBuilderBoxOptions(admin)"),
    );
    ctx.assertFalse(
      "checkout untouched by cache",
      checkout.includes("builder-catalog-cache") ||
        checkout.includes("fetchCachedBuilder"),
    );
    ctx.assertTrue(
      "Server-Timing cache hit metrics present",
      route.includes("boxesCacheHit") && route.includes("mealsCacheHit"),
    );
  }

  __resetBuilderCatalogCacheForTests();
  return finishSuite("103-builder-catalog-cache", ctx);
};

process.exitCode = await runSuite();
