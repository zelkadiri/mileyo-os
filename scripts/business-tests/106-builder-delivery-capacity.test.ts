/**
 * Business regression — builder delivery window first-order capacity.
 *
 * Soft limit only (no reservation / lock). Renewals must never count.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../../app/constants/boxOrder";
import {
  __resetBuilderCheckoutTestDeps,
  __setBuilderCheckoutTestDeps,
  createBuilderStorefrontCheckout,
} from "../../app/features/builder/builder-checkout.server";
import {
  __resetBuilderDeliveryCapacityTestDb,
  __setBuilderDeliveryCapacityTestDb,
  applyCapacityToBuilderDeliveryDate,
  BUILDER_FIRST_ORDER_CAPACITY_WHERE,
  countFirstOrdersByScheduledDeliveryDates,
  enrichBuilderDeliveryWindowOptionsWithCapacity,
  isBuilderDeliveryThursdayAcceptingFirstOrders,
  resolveEffectiveBuilderFirstOrderCount,
} from "../../app/features/builder/builder-delivery-capacity.server";
import {
  BUILDER_DELIVERY_FIRST_ORDER_CAPACITY,
  BUILDER_DELIVERY_MANUAL_FIRST_ORDER_COUNTS,
  buildBuilderDeliveryWindowOptionsFromReferenceDate,
  getBuilderDeliveryManualFirstOrderCount,
  parseDeliveryDate,
  resolveBuilderDeliveryWindowCapacityFields,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);
  if (!parsed) {
    throw new Error(`Invalid test date: ${value}`);
  }
  return parsed;
};

const THURSDAY_A = "2026-10-15";
const THURSDAY_B = "2026-10-22";
const MANUAL_OCCUPIED = "2026-10-29";
const MANUAL_BLOCKED = "2026-10-01";
const SHOP = "capacity-test.myshopify.com";

type MemoryOrder = {
  cancelledAt: Date | null;
  isSubscriptionRenewal: boolean;
  scheduledDeliveryDate: string | null;
  shop: string;
  shopifyOrderId: string;
  simulated: boolean;
};

const createMemoryCapacityDb = (orders: MemoryOrder[]) => {
  const matchesCapacityWhere = (
    order: MemoryOrder,
    where: Record<string, unknown>,
  ) => {
    if (order.shop !== where.shop) {
      return false;
    }
    if (where.cancelledAt !== undefined && order.cancelledAt !== where.cancelledAt) {
      return false;
    }
    if (where.simulated !== undefined && order.simulated !== where.simulated) {
      return false;
    }
    if (
      where.isSubscriptionRenewal !== undefined &&
      order.isSubscriptionRenewal !== where.isSubscriptionRenewal
    ) {
      return false;
    }
    if (
      typeof where.scheduledDeliveryDate === "string" &&
      order.scheduledDeliveryDate !== where.scheduledDeliveryDate
    ) {
      return false;
    }
    if (
      where.scheduledDeliveryDate &&
      typeof where.scheduledDeliveryDate === "object" &&
      "in" in (where.scheduledDeliveryDate as object)
    ) {
      const list = (where.scheduledDeliveryDate as { in: string[] }).in;
      if (
        !order.scheduledDeliveryDate ||
        !list.includes(order.scheduledDeliveryDate)
      ) {
        return false;
      }
    }
    if (where.NOT && typeof where.NOT === "object") {
      const not = where.NOT as { shopifyOrderId?: string };
      if (not.shopifyOrderId && order.shopifyOrderId === not.shopifyOrderId) {
        return false;
      }
    }
    return true;
  };

  return {
    boxOrder: {
      async count({ where }: { where: Record<string, unknown> }) {
        return orders.filter((order) => matchesCapacityWhere(order, where)).length;
      },
      async groupBy({
        where,
      }: {
        _count: { _all: true };
        by: ["scheduledDeliveryDate"];
        where: Record<string, unknown>;
      }) {
        const filtered = orders.filter((order) =>
          matchesCapacityWhere(order, where),
        );
        const byDate = new Map<string, number>();
        for (const order of filtered) {
          if (!order.scheduledDeliveryDate) {
            continue;
          }
          byDate.set(
            order.scheduledDeliveryDate,
            (byDate.get(order.scheduledDeliveryDate) ?? 0) + 1,
          );
        }
        return [...byDate.entries()].map(([scheduledDeliveryDate, count]) => ({
          _count: { _all: count },
          scheduledDeliveryDate,
        }));
      },
    },
  };
};

const firstOrder = (
  shopifyOrderId: string,
  scheduledDeliveryDate: string,
  overrides: Partial<MemoryOrder> = {},
): MemoryOrder => ({
  cancelledAt: null,
  isSubscriptionRenewal: false,
  scheduledDeliveryDate,
  shop: SHOP,
  shopifyOrderId,
  simulated: false,
  ...overrides,
});

const checkoutInput = (scheduledDeliveryDate: string) => ({
  boxVariantId: "gid://shopify/ProductVariant/1",
  deliveryRangeLabel: "Livraison entre jeudi 15 et samedi 17 octobre",
  email: "capacity@example.com",
  mealCount: 8,
  meals: [{ quantity: 1, title: "Poulet" }],
  scheduledDeliveryDate,
  sellingPlanId: "gid://shopify/SellingPlan/1",
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("106-builder-delivery-capacity");

  const capacity = BUILDER_DELIVERY_FIRST_ORDER_CAPACITY;
  const almostFullCount = capacity - 1;

  ctx.scenario("A. Pure capacity fields");
  ctx.assertEqual(
    "capacity constant is 15",
    BUILDER_DELIVERY_FIRST_ORDER_CAPACITY,
    15,
  );

  const zero = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: 0,
    manualUnavailable: false,
  });
  ctx.assertEqual("0/15 available", zero.unavailable, false);
  ctx.assertEqual("0/15 remaining", zero.remainingCapacity, capacity);

  const one = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: 1,
    manualUnavailable: false,
  });
  ctx.assertEqual("1/15 available", one.unavailable, false);
  ctx.assertEqual("1/15 remaining", one.remainingCapacity, capacity - 1);

  const almostFull = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: almostFullCount,
    manualUnavailable: false,
  });
  ctx.assertEqual("14/15 available", almostFull.unavailable, false);
  ctx.assertEqual("14/15 remaining", almostFull.remainingCapacity, 1);

  const full = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: capacity,
    manualUnavailable: false,
  });
  ctx.assertEqual("15/15 unavailable", full.unavailable, true);
  ctx.assertEqual("15/15 remaining", full.remainingCapacity, 0);

  const over = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: capacity + 2,
    manualUnavailable: false,
  });
  ctx.assertEqual(">15 unavailable", over.unavailable, true);
  ctx.assertEqual(">15 remaining clamped", over.remainingCapacity, 0);
  ctx.assertEqual(">15 keeps real count", over.firstOrderCount, capacity + 2);

  const manualEmpty = resolveBuilderDeliveryWindowCapacityFields({
    firstOrderCount: 0,
    manualUnavailable: true,
  });
  ctx.assertEqual("manual 0/15 still unavailable", manualEmpty.unavailable, true);

  ctx.scenario("B. Four windows always generated with capacity shape");
  const windows = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    requireDate("2026-09-28"),
  );
  ctx.assertEqual("always four windows", windows.length, 4);
  ctx.assertTrue(
    "options expose capacity fields",
    windows.every(
      (option) =>
        option.capacity === BUILDER_DELIVERY_FIRST_ORDER_CAPACITY &&
        option.firstOrderCount === 0 &&
        typeof option.remainingCapacity === "number",
    ),
  );
  const blocked = windows.find((option) => option.thursdayDate === MANUAL_BLOCKED);
  ctx.assertTrue("manual blocked window present", Boolean(blocked));
  ctx.assertEqual("manual blocked unavailable", blocked?.unavailable, true);

  ctx.scenario("C. groupBy — renewals / cancelled / simulated excluded");
  const memoryOrders: MemoryOrder[] = [
    firstOrder("fo-1", THURSDAY_A),
    firstOrder("fo-2", THURSDAY_A),
    firstOrder("ren-1", THURSDAY_A, { isSubscriptionRenewal: true }),
    firstOrder("ren-2", THURSDAY_A, { isSubscriptionRenewal: true }),
    firstOrder("cancel-1", THURSDAY_A, {
      cancelledAt: new Date("2026-09-01T00:00:00.000Z"),
    }),
    firstOrder("sim-1", THURSDAY_A, { simulated: true }),
    firstOrder("fo-b-1", THURSDAY_B),
  ];

  __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(memoryOrders));

  try {
    const counts = await countFirstOrdersByScheduledDeliveryDates({
      scheduledDeliveryDates: [THURSDAY_A, THURSDAY_B],
      shop: SHOP,
    });
    ctx.assertEqual("thursday A first orders only", counts.get(THURSDAY_A), 2);
    ctx.assertEqual("thursday B counted separately", counts.get(THURSDAY_B), 1);

    const octoberWindows = buildBuilderDeliveryWindowOptionsFromReferenceDate(
      requireDate("2026-10-12"),
    );
    const optionA = octoberWindows.find((option) => option.thursdayDate === THURSDAY_A);
    const optionB = octoberWindows.find((option) => option.thursdayDate === THURSDAY_B);
    ctx.assertTrue("window A in october options", Boolean(optionA));
    ctx.assertTrue("window B in october options", Boolean(optionB));

    const enriched = await enrichBuilderDeliveryWindowOptionsWithCapacity({
      options: [optionA!, optionB!],
      shop: SHOP,
    });
    ctx.assertEqual("enriched A count", enriched[0]?.firstOrderCount, 2);
    ctx.assertEqual(
      "enriched A remaining",
      enriched[0]?.remainingCapacity,
      capacity - 2,
    );
    ctx.assertEqual("enriched A available", enriched[0]?.unavailable, false);
    // Thursday B (2026-10-22): 1 DB + 2 manual = 3 effective.
    ctx.assertEqual("enriched B count", enriched[1]?.firstOrderCount, 3);
    ctx.assertEqual("other window still available", enriched[1]?.unavailable, false);

    ctx.scenario("D. Soft accepting gate + lead date nulling");
    ctx.assertEqual(
      "2/15 accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: THURSDAY_A,
      }),
      true,
    );

    const fullOrders = Array.from({ length: capacity }, (_, index) =>
      firstOrder(`full-${index}`, THURSDAY_A),
    );
    const almostFullOrders = fullOrders.slice(0, almostFullCount);

    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(fullOrders));
    ctx.assertEqual(
      "15/15 not accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: THURSDAY_A,
      }),
      false,
    );
    ctx.assertEqual(
      "manual blocked not accepting at 0",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: MANUAL_BLOCKED,
      }),
      false,
    );
    ctx.assertNull(
      "lead helper nulls full date",
      await applyCapacityToBuilderDeliveryDate({
        shop: SHOP,
        scheduledDeliveryDate: THURSDAY_A,
      }),
    );

    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(almostFullOrders));
    ctx.assertEqual(
      "14/15 still accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: THURSDAY_A,
      }),
      true,
    );
    ctx.assertEqual(
      "lead helper keeps open date",
      await applyCapacityToBuilderDeliveryDate({
        shop: SHOP,
        scheduledDeliveryDate: THURSDAY_A,
      }),
      THURSDAY_A,
    );

    ctx.scenario("E. Checkout soft reject / allow");
    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(fullOrders));
    let storefrontCalled = false;
    __setBuilderCheckoutTestDeps({
      getStorefront: async () => ({
        storefront: {
          graphql: async () => {
            storefrontCalled = true;
            return {
              json: async () => ({
                data: {
                  cartCreate: {
                    cart: { checkoutUrl: "https://example.com/checkouts/x" },
                    userErrors: [],
                  },
                },
              }),
            } as Response;
          },
        },
      }),
    });

    const rejected = await createBuilderStorefrontCheckout({
      input: checkoutInput(THURSDAY_A),
      shop: SHOP,
    });
    ctx.assertEqual("checkout refused at 15/15", rejected.ok, false);
    ctx.assertFalse("storefront not called when full", storefrontCalled);

    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(almostFullOrders));
    storefrontCalled = false;
    const accepted = await createBuilderStorefrontCheckout({
      input: checkoutInput(THURSDAY_A),
      shop: SHOP,
    });
    ctx.assertEqual("checkout allowed at 14/15", accepted.ok, true);
    ctx.assertTrue("storefront called when open", storefrontCalled);

    ctx.scenario("F. Manual first-order places (22/10 = +2, 29/10 = +1)");
    ctx.assertEqual(
      "manual map has 2026-10-22 => 2",
      BUILDER_DELIVERY_MANUAL_FIRST_ORDER_COUNTS[THURSDAY_B],
      2,
    );
    ctx.assertEqual(
      "manual map has 2026-10-29 => 1",
      BUILDER_DELIVERY_MANUAL_FIRST_ORDER_COUNTS[MANUAL_OCCUPIED],
      1,
    );
    ctx.assertEqual(
      "manual helper 2026-10-22",
      getBuilderDeliveryManualFirstOrderCount(THURSDAY_B),
      2,
    );
    ctx.assertEqual(
      "manual helper 2026-10-29",
      getBuilderDeliveryManualFirstOrderCount(MANUAL_OCCUPIED),
      1,
    );
    ctx.assertEqual(
      "manual helper other date is 0",
      getBuilderDeliveryManualFirstOrderCount(THURSDAY_A),
      0,
    );
    ctx.assertEqual(
      "10 DB + 2 manual on 22/10 = 12",
      resolveEffectiveBuilderFirstOrderCount({
        databaseFirstOrderCount: 10,
        thursdayDate: THURSDAY_B,
      }),
      12,
    );
    ctx.assertEqual(
      "10 DB + 1 manual on 29/10 = 11",
      resolveEffectiveBuilderFirstOrderCount({
        databaseFirstOrderCount: 10,
        thursdayDate: MANUAL_OCCUPIED,
      }),
      11,
    );
    ctx.assertEqual(
      "10 DB + 0 manual on other date = 10",
      resolveEffectiveBuilderFirstOrderCount({
        databaseFirstOrderCount: 10,
        thursdayDate: THURSDAY_A,
      }),
      10,
    );

    // 2026-10-22: 10 DB + 2 manual → 12/15 available, remaining 3.
    const thursdayBTenOrders = Array.from({ length: 10 }, (_, index) =>
      firstOrder(`thu-b-10-${index}`, THURSDAY_B),
    );
    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(thursdayBTenOrders));
    const optionBForManual = octoberWindows.find(
      (option) => option.thursdayDate === THURSDAY_B,
    );
    ctx.assertTrue("thursday B option for 12/15 check", Boolean(optionBForManual));
    const enrichedThursdayBTwelve =
      await enrichBuilderDeliveryWindowOptionsWithCapacity({
        options: [optionBForManual!],
        shop: SHOP,
      });
    ctx.assertEqual(
      "22/10 10 DB + 2 manual → enriched 12",
      enrichedThursdayBTwelve[0]?.firstOrderCount,
      12,
    );
    ctx.assertEqual(
      "22/10 12/15 remaining = 3",
      enrichedThursdayBTwelve[0]?.remainingCapacity,
      3,
    );
    ctx.assertEqual(
      "22/10 12/15 available",
      enrichedThursdayBTwelve[0]?.unavailable,
      false,
    );
    ctx.assertEqual(
      "22/10 12/15 still accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: THURSDAY_B,
      }),
      true,
    );

    const manualTenOrders = Array.from({ length: 10 }, (_, index) =>
      firstOrder(`manual-10-${index}`, MANUAL_OCCUPIED),
    );
    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(manualTenOrders));

    const dbCountsTen = await countFirstOrdersByScheduledDeliveryDates({
      scheduledDeliveryDates: [MANUAL_OCCUPIED],
      shop: SHOP,
    });
    ctx.assertEqual(
      "DB count stays raw (no manual in groupBy)",
      dbCountsTen.get(MANUAL_OCCUPIED),
      10,
    );

    const lateOctoberWindows = buildBuilderDeliveryWindowOptionsFromReferenceDate(
      requireDate("2026-10-26"),
    );
    const optionManual = lateOctoberWindows.find(
      (option) => option.thursdayDate === MANUAL_OCCUPIED,
    );
    const optionOther = lateOctoberWindows.find(
      (option) => option.thursdayDate === "2026-11-05",
    );
    ctx.assertTrue("manual-occupied window present", Boolean(optionManual));

    const enrichedManualTen = await enrichBuilderDeliveryWindowOptionsWithCapacity({
      options: optionOther
        ? [optionManual!, optionOther]
        : [optionManual!],
      shop: SHOP,
    });
    ctx.assertEqual(
      "10 DB + 1 manual → enriched 11",
      enrichedManualTen[0]?.firstOrderCount,
      11,
    );
    ctx.assertEqual(
      "11/15 remaining = 4",
      enrichedManualTen[0]?.remainingCapacity,
      4,
    );
    ctx.assertEqual(
      "11/15 available",
      enrichedManualTen[0]?.unavailable,
      false,
    );
    if (optionOther && enrichedManualTen[1]) {
      ctx.assertEqual(
        "other date keeps DB-only count (no accidental +1)",
        enrichedManualTen[1].firstOrderCount,
        0,
      );
    }

    ctx.assertEqual(
      "10 DB + 1 manual still accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: MANUAL_OCCUPIED,
      }),
      true,
    );

    const manualThirteenOrders = Array.from({ length: 13 }, (_, index) =>
      firstOrder(`manual-13-${index}`, MANUAL_OCCUPIED),
    );
    __setBuilderDeliveryCapacityTestDb(
      createMemoryCapacityDb(manualThirteenOrders),
    );
    const enrichedManualThirteen =
      await enrichBuilderDeliveryWindowOptionsWithCapacity({
        options: [optionManual!],
        shop: SHOP,
      });
    ctx.assertEqual(
      "13 DB + 1 manual → enriched 14",
      enrichedManualThirteen[0]?.firstOrderCount,
      14,
    );
    ctx.assertEqual(
      "14/15 remaining = 1",
      enrichedManualThirteen[0]?.remainingCapacity,
      1,
    );
    ctx.assertEqual(
      "14/15 available (Presque complet)",
      enrichedManualThirteen[0]?.unavailable,
      false,
    );
    ctx.assertEqual(
      "13 DB + 1 manual still accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: MANUAL_OCCUPIED,
      }),
      true,
    );

    const manualFourteenOrders = Array.from({ length: 14 }, (_, index) =>
      firstOrder(`manual-14-${index}`, MANUAL_OCCUPIED),
    );
    __setBuilderDeliveryCapacityTestDb(
      createMemoryCapacityDb(manualFourteenOrders),
    );
    const enrichedManualFourteen =
      await enrichBuilderDeliveryWindowOptionsWithCapacity({
        options: [optionManual!],
        shop: SHOP,
      });
    ctx.assertEqual(
      "14 DB + 1 manual → enriched 15",
      enrichedManualFourteen[0]?.firstOrderCount,
      15,
    );
    ctx.assertEqual(
      "15/15 remaining = 0",
      enrichedManualFourteen[0]?.remainingCapacity,
      0,
    );
    ctx.assertEqual(
      "15/15 unavailable COMPLET",
      enrichedManualFourteen[0]?.unavailable,
      true,
    );
    ctx.assertEqual(
      "14 DB + 1 manual not accepting",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: MANUAL_OCCUPIED,
      }),
      false,
    );
    ctx.assertNull(
      "lead helper nulls 14 DB + 1 manual",
      await applyCapacityToBuilderDeliveryDate({
        shop: SHOP,
        scheduledDeliveryDate: MANUAL_OCCUPIED,
      }),
    );

    storefrontCalled = false;
    const rejectedManual = await createBuilderStorefrontCheckout({
      input: checkoutInput(MANUAL_OCCUPIED),
      shop: SHOP,
    });
    ctx.assertEqual(
      "checkout refused at 14 DB + 1 manual",
      rejectedManual.ok,
      false,
    );
    ctx.assertFalse(
      "storefront not called when manual fills capacity",
      storefrontCalled,
    );

    // Other date with 10 DB and no manual entry → 10/15, no accidental +1.
    const otherTenOrders = Array.from({ length: 10 }, (_, index) =>
      firstOrder(`other-10-${index}`, THURSDAY_A),
    );
    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb(otherTenOrders));
    const optionAForOther = octoberWindows.find(
      (option) => option.thursdayDate === THURSDAY_A,
    );
    ctx.assertTrue("thursday A option for other-date check", Boolean(optionAForOther));
    const enrichedOtherTen = await enrichBuilderDeliveryWindowOptionsWithCapacity({
      options: [optionAForOther!],
      shop: SHOP,
    });
    ctx.assertEqual(
      "other date 10 DB → effective 10 (manual 0)",
      enrichedOtherTen[0]?.firstOrderCount,
      10,
    );
    ctx.assertEqual(
      "other date 10/15 remaining",
      enrichedOtherTen[0]?.remainingCapacity,
      5,
    );
    ctx.assertEqual(
      "other date still accepting at 10",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: THURSDAY_A,
      }),
      true,
    );

    // Renewals still excluded even on the manually occupied Thursday.
    __setBuilderDeliveryCapacityTestDb(
      createMemoryCapacityDb([
        ...Array.from({ length: 10 }, (_, index) =>
          firstOrder(`manual-ren-fo-${index}`, MANUAL_OCCUPIED),
        ),
        firstOrder("manual-ren-1", MANUAL_OCCUPIED, {
          isSubscriptionRenewal: true,
        }),
        firstOrder("manual-ren-2", MANUAL_OCCUPIED, {
          isSubscriptionRenewal: true,
        }),
      ]),
    );
    const countsWithRenewals = await countFirstOrdersByScheduledDeliveryDates({
      scheduledDeliveryDates: [MANUAL_OCCUPIED],
      shop: SHOP,
    });
    ctx.assertEqual(
      "renewals excluded from DB count on manual date",
      countsWithRenewals.get(MANUAL_OCCUPIED),
      10,
    );
    const enrichedWithRenewals =
      await enrichBuilderDeliveryWindowOptionsWithCapacity({
        options: [optionManual!],
        shop: SHOP,
      });
    ctx.assertEqual(
      "renewals excluded; effective = 10 DB + 1 manual",
      enrichedWithRenewals[0]?.firstOrderCount,
      11,
    );

    // Manual UNAVAILABLE block unchanged (hard block, independent of count).
    __setBuilderDeliveryCapacityTestDb(createMemoryCapacityDb([]));
    ctx.assertEqual(
      "manual blocked still not accepting at 0 DB",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        shop: SHOP,
        thursdayDate: MANUAL_BLOCKED,
      }),
      false,
    );
    ctx.assertEqual(
      "manual blocked has no manual first-order offset",
      getBuilderDeliveryManualFirstOrderCount(MANUAL_BLOCKED),
      0,
    );

    // Fail-safe path: accepting gate uses effective count (same helper as checkout).
    __setBuilderDeliveryCapacityTestDb(
      createMemoryCapacityDb(manualFourteenOrders),
    );
    ctx.assertEqual(
      "fail-safe effective count rejects at 14 DB + 1 manual",
      await isBuilderDeliveryThursdayAcceptingFirstOrders({
        excludeShopifyOrderId: "incoming-order",
        shop: SHOP,
        thursdayDate: MANUAL_OCCUPIED,
      }),
      false,
    );

    ctx.scenario("G. No double count + source wiring / renewals untouched");
    __setBuilderDeliveryCapacityTestDb(
      createMemoryCapacityDb([firstOrder("same-order", THURSDAY_A)]),
    );
    const once = await countFirstOrdersByScheduledDeliveryDates({
      scheduledDeliveryDates: [THURSDAY_A],
      shop: SHOP,
    });
    ctx.assertEqual("single shopify order counts once", once.get(THURSDAY_A), 1);

    const capacitySource = readRepoFile(
      "app/features/builder/builder-delivery-capacity.server.ts",
    );
    const loaderSource = readRepoFile("app/routes/apps.box-builder.tsx");
    const checkoutSource = readRepoFile(
      "app/features/builder/builder-checkout.server.ts",
    );
    const leadSource = readRepoFile("app/features/builder/builder-lead.server.ts");
    const clientSource = readRepoFile("app/features/builder/builder-client.ts");
    const orchestratorSource = readRepoFile(
      "app/features/orders-webhook/orders-create-orchestrator.server.ts",
    );
    const deliveryScheduleSource = readRepoFile(
      "app/services/deliverySchedule.server.ts",
    );

    ctx.assertTrue(
      "capacity where reuses kitchen filters",
      capacitySource.includes("KITCHEN_PREPARATION_BOX_ORDER_WHERE") &&
        capacitySource.includes("isSubscriptionRenewal: false"),
    );
    const deliveryDateSource = readRepoFile("app/utils/deliveryDate.ts");
    ctx.assertTrue(
      "manual first-order counts map exists once",
      deliveryDateSource.includes("BUILDER_DELIVERY_MANUAL_FIRST_ORDER_COUNTS") &&
        deliveryDateSource.includes('"2026-10-22": 2') &&
        deliveryDateSource.includes('"2026-10-29": 1'),
    );
    ctx.assertTrue(
      "effective count helper used by enrich + accepting gate",
      capacitySource.includes("resolveEffectiveBuilderFirstOrderCount") &&
        (capacitySource.match(/resolveEffectiveBuilderFirstOrderCount/g) ?? [])
          .length >= 3,
    );
    ctx.assertFalse(
      "client does not hardcode manual date offset",
      clientSource.includes("2026-10-29") ||
        clientSource.includes("2026-10-22"),
    );
    ctx.assertEqual(
      "kitchen filter shape unchanged",
      KITCHEN_PREPARATION_BOX_ORDER_WHERE.cancelledAt,
      null,
    );
    ctx.assertEqual(
      "capacity where excludes renewals",
      BUILDER_FIRST_ORDER_CAPACITY_WHERE.isSubscriptionRenewal,
      false,
    );
    ctx.assertTrue(
      "loader enriches with capacity",
      loaderSource.includes("enrichBuilderDeliveryWindowOptionsWithCapacity"),
    );
    ctx.assertTrue(
      "checkout soft-checks capacity",
      checkoutSource.includes("isBuilderDeliveryThursdayAcceptingFirstOrders"),
    );
    ctx.assertTrue(
      "lead nulls full dates via capacity helper",
      leadSource.includes("applyCapacityToBuilderDeliveryDate"),
    );
    ctx.assertTrue(
      "client renders capacity gauge",
      clientSource.includes("places réservées") &&
        clientSource.includes("Presque complet") &&
        clientSource.includes("delivery-window-capacity"),
    );
    ctx.assertTrue(
      "client almost-full hint uses capacity - 1",
      clientSource.includes("firstOrderCount === capacity - 1"),
    );
    ctx.assertTrue(
      "client fallback capacity uses shared constant",
      clientSource.includes(`: ${capacity};`) ||
        clientSource.includes(String(capacity)),
    );
    ctx.assertTrue(
      "client clamps gauge display to capacity",
      clientSource.includes("displayCount = Math.min(firstOrderCount, capacity)"),
    );
    ctx.assertTrue(
      "client presents manual blocks as full gauge",
      clientSource.includes("displayCount") &&
        clientSource.includes("isUnavailable && displayCount < capacity"),
    );
    // Pure display helper mirror — does not mutate server firstOrderCount.
    const displayReservedPlaces = (
      firstOrderCount: number,
      displayCapacity: number,
      unavailable = false,
    ) => {
      let displayCount = Math.min(firstOrderCount, displayCapacity);
      if (unavailable && displayCount < displayCapacity) {
        displayCount = displayCapacity;
      }
      return displayCount;
    };
    ctx.assertEqual(
      "UI 14/15 → 14",
      displayReservedPlaces(almostFullCount, capacity),
      almostFullCount,
    );
    ctx.assertEqual(
      "UI 15/15 → 15",
      displayReservedPlaces(capacity, capacity),
      capacity,
    );
    ctx.assertEqual(
      "UI over-capacity réel → affiche capacity",
      displayReservedPlaces(capacity + 2, capacity),
      capacity,
    );
    ctx.assertEqual(
      "vrai count serveur reste over-capacity (métier)",
      resolveBuilderDeliveryWindowCapacityFields({
        firstOrderCount: capacity + 2,
        manualUnavailable: false,
      }).firstOrderCount,
      capacity + 2,
    );
    ctx.assertEqual(
      "UI over-capacity + unavailable → encore capacity",
      displayReservedPlaces(capacity + 2, capacity, true),
      capacity,
    );
    ctx.assertEqual(
      "UI manual 0 + unavailable → capacity (plein)",
      displayReservedPlaces(0, capacity, true),
      capacity,
    );
    ctx.assertEqual(
      "Presque complet threshold is capacity - 1",
      almostFullCount,
      14,
    );
    ctx.assertTrue(
      "client keeps existing COMPLET badge",
      clientSource.includes('"COMPLET"'),
    );
    ctx.assertTrue(
      "orchestrator capacity only on first-order path",
      orchestratorSource.includes("!isRenewal") &&
        orchestratorSource.includes("first-order capacity full") &&
        orchestratorSource.includes(
          "isBuilderDeliveryThursdayAcceptingFirstOrders",
        ),
    );
    ctx.assertFalse(
      "deliverySchedule renewal helpers do not import capacity",
      deliveryScheduleSource.includes("builder-delivery-capacity"),
    );
    ctx.assertFalse(
      "no reservation / TTL / advisory lock",
      /Reservation|TTL|advisory|FOR UPDATE/.test(capacitySource),
    );
  } finally {
    __resetBuilderDeliveryCapacityTestDb();
    __resetBuilderCheckoutTestDeps();
  }

  return finishSuite("106-builder-delivery-capacity", ctx);
};

process.exitCode = await runSuite();
