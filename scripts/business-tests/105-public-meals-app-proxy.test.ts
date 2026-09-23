/**
 * Business regression — public App Proxy "Nos Plats" meal catalog.
 *
 * Display-only GET /apps/box-builder/public-meals.
 * No commerce IDs, no cart/checkout, Admin GraphQL (unpublished OK).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  __resetBuilderCatalogCacheForTests,
  PUBLIC_MEALS_CACHE_TTL_MS,
  publicMealsCacheKey,
} from "../../app/features/builder/builder-catalog-cache.server";
import { toPublicMeal, toPublicMeals } from "../../app/features/public-meals/public-meals-mapper";
import {
  fetchCachedPublicMeals,
  fetchPublicMeals,
} from "../../app/features/public-meals/public-meals.server";
import type { PublicMeal } from "../../app/features/public-meals/public-meals-types";
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  toMealCatalogProduct,
  type MealCatalogProduct,
  type ShopifyMealCatalogProductNode,
} from "../../app/services/subscriptionMealCatalog.server";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const MEAL_COLLECTION_ID = "gid://shopify/Collection/meals-1";
const OTHER_COLLECTION_ID = "gid://shopify/Collection/other-9";

const FORBIDDEN_DTO_KEYS = [
  "id",
  "variantId",
  "productId",
  "handle",
  "price",
  "sellingPlanId",
  "checkoutUrl",
  "inventory",
  "onlineStoreUrl",
  "admin_graphql_api_id",
] as const;

/** Keys allowed only under `image` (CDN asset), never as commerce product URLs. */
const TOP_LEVEL_FORBIDDEN = ["url"] as const;

const collectKeys = (value: unknown, keys = new Set<string>()): Set<string> => {
  if (value == null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
};

const jsonResponse = (body: unknown) =>
  ({ json: async () => body }) as unknown as Response;

type GraphqlCall = {
  query: string;
  variables?: Record<string, unknown>;
};

const shopifyNode = (
  overrides: Partial<ShopifyMealCatalogProductNode> & {
    id: string;
    title: string;
  },
): ShopifyMealCatalogProductNode => ({
  description: overrides.description ?? "Un plat savoureux.",
  featuredImage: overrides.featuredImage ?? {
    altText: overrides.title,
    url: `https://cdn.example/${overrides.id}.jpg`,
  },
  badge1Metafield: overrides.badge1Metafield ?? { value: "Bio" },
  badge2Metafield: overrides.badge2Metafield ?? null,
  badge3Metafield: overrides.badge3Metafield ?? null,
  allergenesMetafield: overrides.allergenesMetafield ?? { value: "gluten" },
  ingredientsMetafield:
    overrides.ingredientsMetafield ?? { value: "poulet, riz" },
  variants: overrides.variants ?? {
    nodes: [
      {
        id: `${overrides.id}/v-wl`,
        title: "Perte de poids",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
        caloriesMetafield: { value: "400" },
      },
      {
        id: `${overrides.id}/v-bal`,
        title: "Équilibré",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
        caloriesMetafield: { value: "550" },
      },
      {
        id: `${overrides.id}/v-bulk`,
        title: "Prise de masse",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
        caloriesMetafield: { value: "700" },
      },
    ],
  },
  ...overrides,
});

const catalogResponse = (nodes: ShopifyMealCatalogProductNode[]) => ({
  data: {
    collection: {
      products: {
        pageInfo: { hasNextPage: false },
        nodes,
      },
    },
  },
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

const mealProduct = (
  overrides: Partial<MealCatalogProduct> = {},
): MealCatalogProduct => ({
  id: "gid://shopify/Product/1001",
  title: "Poulet curry",
  description: "Un curry doux.",
  imageAlt: "Poulet curry",
  imageUrl: "https://cdn.example/poulet.jpg",
  allergenes: ["gluten"],
  badges: ["Bio"],
  ingredients: ["poulet", "riz"],
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/wl",
      variantTitle: "WL",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      calories: 400,
      proteins: null,
      carbs: null,
      fat: null,
      saturatedFat: null,
      sugars: null,
      fiber: null,
      salt: null,
      portionGrams: null,
    },
    {
      variantId: "gid://shopify/ProductVariant/bal",
      variantTitle: "Bal",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      calories: 550,
      proteins: null,
      carbs: null,
      fat: null,
      saturatedFat: null,
      sugars: null,
      fiber: null,
      salt: null,
      portionGrams: null,
    },
  ],
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("105-public-meals-app-proxy");

  const routeSource = readRepoFile(
    "app/routes/apps.box-builder.public-meals.tsx",
  );
  const mapperSource = readRepoFile(
    "app/features/public-meals/public-meals-mapper.ts",
  );
  const serverSource = readRepoFile(
    "app/features/public-meals/public-meals.server.ts",
  );
  const catalogSource = readRepoFile(
    "app/services/subscriptionMealCatalog.server.ts",
  );
  const runnerSource = readRepoFile(
    "scripts/business-tests/00-run-business-regression-suite.ts",
  );

  ctx.scenario("1. Route GET App Proxy authenticated");
  {
    ctx.assertTrue(
      "route file exists under apps.box-builder.public-meals",
      routeSource.includes("export const loader"),
    );
    ctx.assertTrue(
      "loader authenticates App Proxy",
      /authenticateMileyoAppProxy\s*\(\s*request\s*\)/.test(routeSource),
    );
    ctx.assertTrue(
      "uses prisma AppSettings mealCollectionId",
      routeSource.includes("mealCollectionId") &&
        routeSource.includes("appSettings"),
    );
    ctx.assertTrue(
      "returns JSON Content-Type",
      routeSource.includes("application/json"),
    );
    ctx.assertTrue(
      "anonymous visitor OK (no loggedInCustomerId gate)",
      !/loggedInCustomerId/.test(routeSource),
    );
  }

  ctx.scenario("2. Non-GET → 405");
  {
    ctx.assertTrue(
      "action returns 405",
      routeSource.includes("export const action") &&
        routeSource.includes("405") &&
        routeSource.includes("Method Not Allowed"),
    );
    ctx.assertTrue(
      "action authenticates App Proxy",
      /export const action[\s\S]*authenticateMileyoAppProxy\s*\(\s*request\s*\)/.test(
        routeSource,
      ),
    );
    ctx.assertTrue(
      "action authenticates then methodNotAllowed",
      /export const action[\s\S]*authenticateMileyoAppProxy\s*\(\s*request\s*\)[\s\S]*methodNotAllowed\s*\(\s*\)/.test(
        routeSource,
      ),
    );
    ctx.assertTrue(
      "Allow GET header",
      routeSource.includes('Allow: "GET"') ||
        routeSource.includes("Allow: 'GET'"),
    );
  }

  ctx.scenario("3–4. Collection = AppSettings.mealCollectionId only");
  {
    __resetBuilderCatalogCacheForTests();
    const inCollection = shopifyNode({
      id: "gid://shopify/Product/in-1",
      title: "In collection",
    });
    const { admin, calls } = createAdminMock((call) => {
      ctx.assertEqual(
        "query binds mealCollectionId",
        call.variables?.id,
        MEAL_COLLECTION_ID,
      );
      return catalogResponse([inCollection]);
    });

    const meals = await fetchPublicMeals(admin, MEAL_COLLECTION_ID);
    ctx.assertEqual("one meal from collection", meals.length, 1);
    ctx.assertEqual("title from collection product", meals[0]?.title, "In collection");
    ctx.assertEqual("one Admin GraphQL call", calls.length, 1);
    ctx.assertTrue(
      "server uses fetchMealCatalogProducts",
      serverSource.includes("fetchMealCatalogProducts"),
    );
    ctx.assertTrue(
      "products outside collection never queried separately",
      !serverSource.includes(OTHER_COLLECTION_ID) &&
        !routeSource.includes("products(query"),
    );
  }

  ctx.scenario("5. DTO excludes commerce identifiers");
  {
    const publicMeal = toPublicMeal(
      mealProduct({
        id: "gid://shopify/Product/leak-me",
        title: "Secret IDs",
      }),
    );
    const keys = collectKeys(publicMeal);
    for (const forbidden of FORBIDDEN_DTO_KEYS) {
      ctx.assertFalse(
        `DTO has no key ${forbidden}`,
        keys.has(forbidden),
      );
    }
    for (const forbidden of TOP_LEVEL_FORBIDDEN) {
      ctx.assertFalse(
        `DTO top-level has no key ${forbidden}`,
        Object.prototype.hasOwnProperty.call(publicMeal, forbidden),
      );
    }
    ctx.assertTrue(
      "image.url is CDN only when image present",
      publicMeal.image === null ||
        (typeof publicMeal.image.url === "string" &&
          publicMeal.image.url.startsWith("https://")),
    );
    const serialized = JSON.stringify(publicMeal);
    ctx.assertFalse(
      "serialized omits product GID",
      serialized.includes("gid://shopify/Product"),
    );
    ctx.assertFalse(
      "serialized omits variant GID",
      serialized.includes("gid://shopify/ProductVariant"),
    );
    ctx.assertTrue(
      "mapper source documents strip",
      (mapperSource.includes("variantId") &&
        mapperSource.includes("Never")) ||
        mapperSource.includes("Strips"),
    );
  }

  ctx.scenario("6. image / title / description / metafields mapped");
  {
    const node = shopifyNode({
      id: "gid://shopify/Product/map-1",
      title: "Saumon grillé",
      description: "  Saumon avec citron.  ",
      featuredImage: {
        altText: "Saumon",
        url: "https://cdn.example/saumon.jpg",
      },
      badge1Metafield: { value: "Poisson" },
      badge2Metafield: { value: "Léger" },
      badge3Metafield: null,
      allergenesMetafield: { value: "poisson, soja" },
      ingredientsMetafield: { value: '["saumon","citron"]' },
    });
    const catalog = toMealCatalogProduct(node);
    const meal = toPublicMeal(catalog);

    ctx.assertEqual("title", meal.title, "Saumon grillé");
    ctx.assertEqual("description trimmed plain text", meal.description, "Saumon avec citron.");
    ctx.assertEqual("image url", meal.image?.url, "https://cdn.example/saumon.jpg");
    ctx.assertEqual("image alt", meal.image?.altText, "Saumon");
    ctx.assertEqual("badges", meal.badges.join("|"), "Poisson|Léger");
    ctx.assertTrue(
      "allergens normalized",
      meal.allergens.includes("poisson") && meal.allergens.includes("soja"),
    );
    ctx.assertEqual(
      "ingredients parsed",
      meal.ingredients.join("|"),
      "saumon|citron",
    );
    ctx.assertEqual(
      "calories from balanced variant",
      meal.calories,
      550,
    );
    ctx.assertTrue(
      "catalog fetches Admin description field",
      /description\n/.test(catalogSource) ||
        catalogSource.includes("\n          description\n"),
    );
    ctx.assertTrue(
      "XSS strategy: plain-text description documented",
      routeSource.includes("plain text") ||
        routeSource.includes("HTML stripped") ||
        routeSource.includes("textContent"),
    );
  }

  ctx.scenario("7. Empty collection → meals []");
  {
    __resetBuilderCatalogCacheForTests();
    const { admin } = createAdminMock(() => catalogResponse([]));
    const meals = await fetchPublicMeals(admin, MEAL_COLLECTION_ID);
    ctx.assertEqual("empty array", meals.length, 0);
    ctx.assertTrue(
      "route returns { meals } success shape",
      routeSource.includes("{ meals }") ||
        routeSource.includes("meals }"),
    );
  }

  ctx.scenario("8. Admin error → no internal leak");
  {
    __resetBuilderCatalogCacheForTests();
    const { admin } = createAdminMock(() => ({
      errors: [{ message: "INTERNAL_STACK_TRACE_DO_NOT_LEAK at /secret" }],
    }));

    let thrown: unknown;
    try {
      await fetchPublicMeals(admin, MEAL_COLLECTION_ID);
    } catch (error) {
      thrown = error;
    }
    ctx.assertTrue("fetch throws on Admin errors", thrown instanceof Error);
    ctx.assertTrue(
      "route catches and returns generic 502 error body",
      routeSource.includes("502") &&
        routeSource.includes("Impossible de charger le catalogue repas.") &&
        !routeSource.includes("error.message") &&
        !routeSource.includes("error.stack"),
    );
  }

  ctx.scenario("9–10. Cache per shop + hit avoids second Admin query");
  {
    __resetBuilderCatalogCacheForTests();
    ctx.assertEqual("TTL is 30s", PUBLIC_MEALS_CACHE_TTL_MS, 30_000);
    ctx.assertTrue(
      "shop A key ≠ shop B key",
      publicMealsCacheKey("a.myshopify.com", MEAL_COLLECTION_ID) !==
        publicMealsCacheKey("b.myshopify.com", MEAL_COLLECTION_ID),
    );

    let fetches = 0;
    const { admin } = createAdminMock(() => {
      fetches += 1;
      return catalogResponse([
        shopifyNode({ id: "gid://shopify/Product/c1", title: "Cached" }),
      ]);
    });

    const first = await fetchCachedPublicMeals(
      admin,
      MEAL_COLLECTION_ID,
      "shop-a.myshopify.com",
    );
    const second = await fetchCachedPublicMeals(
      admin,
      MEAL_COLLECTION_ID,
      "shop-a.myshopify.com",
    );
    ctx.assertEqual("first miss", first.cacheHit, false);
    ctx.assertEqual("second hit", second.cacheHit, true);
    ctx.assertEqual("Admin queried once for shop-a", fetches, 1);

    const otherShop = await fetchCachedPublicMeals(
      admin,
      MEAL_COLLECTION_ID,
      "shop-b.myshopify.com",
    );
    ctx.assertEqual("other shop miss", otherShop.cacheHit, false);
    ctx.assertEqual("Admin queried again for shop-b", fetches, 2);
  }

  ctx.scenario("11. Unpublished works via Admin GraphQL");
  {
    ctx.assertTrue(
      "uses Admin graphql client",
      serverSource.includes("admin.graphql") ||
        serverSource.includes("fetchMealCatalogProducts"),
    );
    ctx.assertFalse(
      "no Storefront API / Liquid publication filter",
      /publishedOnCurrentPublication|onlineStoreUrl|storefrontApi/.test(
        serverSource,
      ),
    );
    ctx.assertTrue(
      "shared catalog query has no publication filter",
      !catalogSource.includes("publishedOnCurrentPublication") &&
        !catalogSource.includes("resourcePublications"),
    );
  }

  ctx.scenario("12. Collection order preserved (COLLECTION_DEFAULT)");
  {
    __resetBuilderCatalogCacheForTests();
    const { admin, calls } = createAdminMock(() =>
      catalogResponse([
        shopifyNode({ id: "gid://shopify/Product/z", title: "Zebre" }),
        shopifyNode({ id: "gid://shopify/Product/a", title: "Ananas" }),
      ]),
    );
    const meals = await fetchPublicMeals(admin, MEAL_COLLECTION_ID);
    ctx.assertEqual(
      "order follows query nodes not title sort",
      meals.map((m: PublicMeal) => m.title).join("|"),
      "Zebre|Ananas",
    );
    ctx.assertEqual(
      "public fetch uses COLLECTION_DEFAULT",
      calls[0]?.variables?.sortKey,
      "COLLECTION_DEFAULT",
    );
    ctx.assertTrue(
      "catalog query accepts sortKey variable",
      catalogSource.includes("ProductCollectionSortKeys") &&
        catalogSource.includes("$sortKey"),
    );
    ctx.assertTrue(
      "default Builder path still TITLE",
      catalogSource.includes('options?.sortKey ?? "TITLE"') ||
        catalogSource.includes("sortKey ?? \"TITLE\""),
    );
  }

  ctx.scenario("13. No commerce mutations on this route");
  {
    const mutationPatterns = [
      "mutation ",
      "cartCreate",
      "checkoutCreate",
      "cartLinesAdd",
      "productUpdate",
      "publishablePublish",
      "publishableUnpublish",
      "draftOrder",
    ];
    for (const pattern of mutationPatterns) {
      ctx.assertFalse(
        `route has no ${pattern.trim()}`,
        routeSource.includes(pattern),
      );
    }
    ctx.assertFalse(
      "server has no mutation string",
      /mutation\s+|cartCreate|checkoutCreate/.test(serverSource),
    );
    ctx.assertTrue(
      "mapper is pure (no admin)",
      !mapperSource.includes("graphql") && !mapperSource.includes("fetch("),
    );
  }

  ctx.scenario("Runner + Cache-Control");
  {
    ctx.assertTrue(
      "suite registered in business runner",
      runnerSource.includes("105-public-meals-app-proxy.test.ts"),
    );
    ctx.assertTrue(
      "HTTP Cache-Control for success",
      routeSource.includes("max-age=30") ||
        routeSource.includes("Cache-Control"),
    );
    ctx.assertTrue(
      "empty description → null",
      toPublicMeal(mealProduct({ description: null })).description === null,
    );
    ctx.assertTrue(
      "no image → image null",
      toPublicMeal(mealProduct({ imageUrl: null })).image === null,
    );
    ctx.assertEqual(
      "toPublicMeals length",
      toPublicMeals([mealProduct(), mealProduct({ title: "B" })]).length,
      2,
    );
  }

  return finishSuite("105-public-meals-app-proxy", ctx);
};

runSuite()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
