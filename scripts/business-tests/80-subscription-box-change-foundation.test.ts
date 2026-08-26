/**
 * Business regression — BOX-CHANGE-2 / 2B SubscriptionBoxChange foundation.
 *
 * Model + pending helpers + coverage + concurrency / CAS hardening.
 * In-memory Prisma-shaped store — no Shopify, no portal wiring, no billing apply.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SubscriptionBoxChange } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  CURRENT_DELIVERY_COVERAGE,
  SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS,
  SUBSCRIPTION_BOX_CHANGE_STATUS,
  SUBSCRIPTION_BOX_CHANGE_STATUSES,
  isSubscriptionBoxChangeStatus,
} from "../../app/constants/subscriptionBoxChange";
import { RECOVERY_STATUS } from "../../app/constants/subscriptionPaymentRecovery";
import {
  cancelSubscriptionBoxChange,
  classifyCurrentDeliveryCoverage,
  findBoxOrderForEffectiveDelivery,
  getPendingSubscriptionBoxChange,
  isCurrentDeliveryLockedForBoxChange,
  isRecoveryBlockingBoxChange,
  markSubscriptionBoxChangeApplied,
  markSubscriptionBoxChangeApplying,
  markSubscriptionBoxChangeFailed,
  requestSubscriptionBoxChange,
  resolveCurrentDeliveryCoverage,
  type SubscriptionBoxChangeDb,
} from "../../app/services/subscriptionBoxChange.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP_A = "mileyo-dev.myshopify.com";
const SHOP_B = "other-shop.myshopify.com";
const NOW = new Date("2026-08-26T10:00:00.000Z");
const EFFECTIVE_BILLING = new Date("2026-08-29T22:05:00.000Z");
const DELIVERY_DATE = "2026-08-27";
const OTHER_DELIVERY = "2026-09-03";

let idSeq = 0;
const nextId = () => `sbc_${++idSeq}`;

type MemoryBoxChange = SubscriptionBoxChange;
type MemoryBoxOrder = {
  id: string;
  scheduledDeliveryDate: string | null;
  shop: string;
  simulated: boolean;
  subscriptionSelectionId: string | null;
};

const uniquePendingError = () =>
  new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`subscriptionMealSelectionId`)",
    {
      clientVersion: "test",
      code: "P2002",
      meta: { target: ["subscriptionMealSelectionId"] },
    },
  );

const matchesWhere = (
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean => {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (
      expected !== null &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      !(expected instanceof Date)
    ) {
      continue;
    }
    if (actual instanceof Date && expected instanceof Date) {
      if (actual.getTime() !== expected.getTime()) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
};

const createMemoryDb = () => {
  const changes: MemoryBoxChange[] = [];
  const orders: MemoryBoxOrder[] = [];

  const db: SubscriptionBoxChangeDb = {
    async $transaction(fn) {
      return fn(db);
    },
    boxOrder: {
      async findFirst({ where }) {
        const match = orders.find((order) =>
          matchesWhere(order as unknown as Record<string, unknown>, where),
        );
        return match
          ? {
              id: match.id,
              scheduledDeliveryDate: match.scheduledDeliveryDate,
              subscriptionSelectionId: match.subscriptionSelectionId,
            }
          : null;
      },
    },
    subscriptionBoxChange: {
      async create({ data }) {
        if (
          data.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING &&
          changes.some(
            (row) =>
              row.subscriptionMealSelectionId ===
                data.subscriptionMealSelectionId &&
              row.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
          )
        ) {
          throw uniquePendingError();
        }

        const row: MemoryBoxChange = {
          appliedAt: null,
          cancelledAt: null,
          createdAt: NOW,
          effectiveBillingDate: data.effectiveBillingDate,
          failedAt: null,
          failureReason: null,
          fromProductVariantId: data.fromProductVariantId,
          id: nextId(),
          requestedAt: data.requestedAt ?? NOW,
          shop: data.shop,
          status: data.status,
          subscriptionContractId: data.subscriptionContractId,
          subscriptionMealSelectionId: data.subscriptionMealSelectionId,
          toMealsCount: data.toMealsCount,
          toProductVariantId: data.toProductVariantId,
          toSelectedMeals: data.toSelectedMeals,
          toSellingPlanId: data.toSellingPlanId ?? null,
          updatedAt: NOW,
        };
        changes.push(row);
        return row;
      },
      async findFirst({ orderBy, where }) {
        const filtered = changes.filter((row) =>
          matchesWhere(row as unknown as Record<string, unknown>, where),
        );
        if (orderBy && "requestedAt" in orderBy && orderBy.requestedAt === "desc") {
          filtered.sort(
            (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
          );
        }
        return filtered[0] ?? null;
      },
      async findUnique({ where }) {
        return changes.find((row) => row.id === where.id) ?? null;
      },
      async update({ data, where }) {
        const index = changes.findIndex((row) => row.id === where.id);
        if (index < 0) {
          throw new Error(`missing SubscriptionBoxChange ${where.id}`);
        }
        const next = {
          ...changes[index],
          ...data,
          updatedAt: NOW,
        } as MemoryBoxChange;
        changes[index] = next;
        return next;
      },
      async updateMany({ data, where }) {
        let count = 0;
        for (let i = 0; i < changes.length; i += 1) {
          if (
            matchesWhere(
              changes[i] as unknown as Record<string, unknown>,
              where,
            )
          ) {
            changes[i] = {
              ...changes[i],
              ...data,
              updatedAt: NOW,
            } as MemoryBoxChange;
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return {
    changes,
    db,
    orders,
    seedOrder(order: Omit<MemoryBoxOrder, "id"> & { id?: string }) {
      const row: MemoryBoxOrder = {
        id: order.id ?? `bo_${++idSeq}`,
        scheduledDeliveryDate: order.scheduledDeliveryDate,
        shop: order.shop,
        simulated: order.simulated,
        subscriptionSelectionId: order.subscriptionSelectionId,
      };
      orders.push(row);
      return row;
    },
  };
};

const mealsFor = (count: number, prefix = "Meal") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

const baseRequest = (overrides: Partial<Parameters<typeof requestSubscriptionBoxChange>[0]> = {}) => ({
  effectiveBillingDate: EFFECTIVE_BILLING,
  fromProductVariantId: "gid://shopify/ProductVariant/8",
  shop: SHOP_A,
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  subscriptionMealSelectionId: "sel_1",
  toMealsCount: 12,
  toProductVariantId: "gid://shopify/ProductVariant/12",
  toSelectedMeals: mealsFor(12),
  toSellingPlanId: "gid://shopify/SellingPlan/12",
  ...overrides,
});

const pendingCount = (changes: MemoryBoxChange[]) =>
  changes.filter((row) => row.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING)
    .length;

const runSuite = async () => {
  const ctx = createBusinessTestContext("80-subscription-box-change-foundation");

  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260826120000_add_subscription_box_change/migration.sql",
  );
  const serviceSource = readRepoFile(
    "app/services/subscriptionBoxChange.server.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const billingWorkerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );

  ctx.scenario("A. Schema + migration + status constants");
  ctx.assertTrue(
    "schema model SubscriptionBoxChange",
    schemaSource.includes("model SubscriptionBoxChange"),
  );
  ctx.assertTrue(
    "schema relation boxChanges",
    schemaSource.includes("boxChanges        SubscriptionBoxChange[]") ||
      schemaSource.includes("boxChanges SubscriptionBoxChange[]"),
  );
  ctx.assertTrue(
    "no billed price SoT field on model",
    !schemaSource.includes("toPrice") &&
      !migrationSource.includes("toPrice") &&
      !migrationSource.includes("billedPrice"),
  );
  ctx.assertTrue(
    "schema stores future meals as toSelectedMeals Json",
    schemaSource.includes("toSelectedMeals") &&
      schemaSource.includes("SubscriptionBoxChange"),
  );
  ctx.assertTrue(
    "migration includes toSelectedMeals JSONB",
    migrationSource.includes('"toSelectedMeals" JSONB NOT NULL'),
  );
  ctx.assertTrue(
    "migration creates table",
    migrationSource.includes('CREATE TABLE "SubscriptionBoxChange"'),
  );
  ctx.assertTrue(
    "migration partial unique pending per selection",
    migrationSource.includes("SubscriptionBoxChange_one_pending_per_selection") &&
      migrationSource.includes("WHERE \"status\" = 'pending'"),
  );
  ctx.assertTrue(
    "migration cascade on selection delete",
    migrationSource.includes("ON DELETE CASCADE"),
  );
  for (const status of SUBSCRIPTION_BOX_CHANGE_STATUSES) {
    ctx.assertTrue(`status constant ${status}`, isSubscriptionBoxChangeStatus(status));
  }
  ctx.assertTrue(
    "allowed transitions document pending→applying|cancelled",
    SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.pending.includes("applying") &&
      SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.pending.includes("cancelled"),
  );
  ctx.assertTrue(
    "allowed transitions document applying→applied|failed",
    SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.applying.includes("applied") &&
      SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.applying.includes("failed"),
  );
  ctx.assertEqual(
    "terminal statuses have no outbound transitions",
    SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.applied.length +
      SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.cancelled.length +
      SUBSCRIPTION_BOX_CHANGE_ALLOWED_TRANSITIONS.failed.length,
    0,
  );

  ctx.scenario("B. Pending create / get / idempotent replay");
  {
    const mem = createMemoryDb();
    const first = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    ctx.assertEqual(
      "create status pending",
      first.change.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
    );
    ctx.assertEqual("create toMealsCount 12", first.change.toMealsCount, 12);
    ctx.assertFalse("first not replayed", first.replayed);
    ctx.assertFalse("first not replaced", first.replaced);

    const loaded = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_A,
      subscriptionMealSelectionId: "sel_1",
    });
    ctx.assertEqual("getPending id", loaded?.id, first.change.id);

    const replay = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    ctx.assertTrue("identical request replayed", replay.replayed);
    ctx.assertEqual("replay same id", replay.change.id, first.change.id);
    ctx.assertEqual("still one pending row", pendingCount(mem.changes), 1);
    ctx.assertEqual(
      "replay did not cancel then recreate",
      mem.changes.filter(
        (row) => row.status === SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
      ).length,
      0,
    );
  }

  ctx.scenario("C. Replace 12 → 16 keeps single active pending");
  {
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest({ toMealsCount: 12 }), {
      db: mem.db,
      now: NOW,
    });
    const replaced = await requestSubscriptionBoxChange(
      baseRequest({
        toMealsCount: 16,
        toProductVariantId: "gid://shopify/ProductVariant/16",
        toSelectedMeals: mealsFor(16),
        toSellingPlanId: "gid://shopify/SellingPlan/16",
      }),
      { db: mem.db, now: NOW },
    );
    ctx.assertTrue("second request replaced", replaced.replaced);
    ctx.assertFalse("second not replayed", replaced.replayed);
    ctx.assertEqual("final toMealsCount 16", replaced.change.toMealsCount, 16);
    ctx.assertEqual("exactly one pending", pendingCount(mem.changes), 1);
    ctx.assertEqual(
      "previous cancelled",
      mem.changes.filter((row) => row.status === "cancelled").length,
      1,
    );

    const pending = await getPendingSubscriptionBoxChange({
      db: mem.db,
      subscriptionMealSelectionId: "sel_1",
    });
    ctx.assertEqual("pending is 16", pending?.toMealsCount, 16);
  }

  ctx.scenario("D. Status transitions applying / applied / failed / cancelled");
  {
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });

    const applying = await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: change.id,
    });
    ctx.assertTrue("pending → applying transitioned", applying.transitioned);
    ctx.assertEqual(
      "pending → applying",
      applying.change?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );

    const applied = await markSubscriptionBoxChangeApplied({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertTrue("applying → applied transitioned", applied.transitioned);
    ctx.assertEqual(
      "applying → applied",
      applied.change?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    );
    ctx.assertTrue("appliedAt set", applied.change?.appliedAt != null);
  }
  {
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({ db: mem.db, id: change.id });
    const failed = await markSubscriptionBoxChangeFailed({
      db: mem.db,
      failureReason: "shopify_draft_failed",
      id: change.id,
      now: NOW,
    });
    ctx.assertTrue("applying → failed transitioned", failed.transitioned);
    ctx.assertEqual(
      "applying → failed",
      failed.change?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
    );
    ctx.assertEqual(
      "failureReason stored",
      failed.change?.failureReason,
      "shopify_draft_failed",
    );
  }
  {
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const cancelled = await cancelSubscriptionBoxChange({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertTrue("pending → cancelled transitioned", cancelled.transitioned);
    ctx.assertEqual(
      "pending → cancelled",
      cancelled.change?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
    );
    ctx.assertNull(
      "no pending after cancel",
      await getPendingSubscriptionBoxChange({
        db: mem.db,
        subscriptionMealSelectionId: "sel_1",
      }),
    );
  }

  ctx.scenario("E. Cycle detection — BoxOrder / unpaid / in-flight / wrong date");
  {
    const ordered = classifyCurrentDeliveryCoverage({
      effectiveDeliveryDate: DELIVERY_DATE,
      lastBillingAttemptAt: null,
      lastBillingAttemptStatus: null,
      matchingBoxOrder: { id: "bo_1" },
      now: NOW,
    });
    ctx.assertEqual(
      "BoxOrder → ordered",
      ordered,
      CURRENT_DELIVERY_COVERAGE.ORDERED,
    );
    ctx.assertTrue(
      "ordered locks box change",
      isCurrentDeliveryLockedForBoxChange(ordered),
    );

    const unpaid = classifyCurrentDeliveryCoverage({
      effectiveDeliveryDate: DELIVERY_DATE,
      lastBillingAttemptAt: null,
      lastBillingAttemptStatus: null,
      matchingBoxOrder: null,
      now: NOW,
    });
    ctx.assertEqual("no BoxOrder → unpaid", unpaid, CURRENT_DELIVERY_COVERAGE.UNPAID);
    ctx.assertFalse(
      "unpaid does not lock",
      isCurrentDeliveryLockedForBoxChange(unpaid),
    );

    const inFlight = classifyCurrentDeliveryCoverage({
      effectiveDeliveryDate: DELIVERY_DATE,
      lastBillingAttemptAt: NOW,
      lastBillingAttemptStatus: "submitted",
      matchingBoxOrder: null,
      now: NOW,
    });
    ctx.assertEqual(
      "submitted without BoxOrder → billing_in_flight",
      inFlight,
      CURRENT_DELIVERY_COVERAGE.BILLING_IN_FLIGHT,
    );
    ctx.assertTrue(
      "in-flight locks",
      isCurrentDeliveryLockedForBoxChange(inFlight),
    );

    const successLag = classifyCurrentDeliveryCoverage({
      effectiveDeliveryDate: DELIVERY_DATE,
      lastBillingAttemptAt: NOW,
      lastBillingAttemptStatus: "success",
      matchingBoxOrder: null,
      now: NOW,
    });
    ctx.assertEqual(
      "success without BoxOrder → ambiguous (not unpaid)",
      successLag,
      CURRENT_DELIVERY_COVERAGE.AMBIGUOUS,
    );
    ctx.assertTrue(
      "ambiguous locks",
      isCurrentDeliveryLockedForBoxChange(successLag),
    );

    const unknownDate = classifyCurrentDeliveryCoverage({
      effectiveDeliveryDate: null,
      lastBillingAttemptAt: null,
      lastBillingAttemptStatus: null,
      matchingBoxOrder: null,
      now: NOW,
    });
    ctx.assertEqual(
      "unknown delivery → ambiguous",
      unknownDate,
      CURRENT_DELIVERY_COVERAGE.AMBIGUOUS,
    );
  }
  {
    const mem = createMemoryDb();
    mem.seedOrder({
      scheduledDeliveryDate: OTHER_DELIVERY,
      shop: SHOP_A,
      simulated: false,
      subscriptionSelectionId: "sel_1",
    });
    const wrongDate = await findBoxOrderForEffectiveDelivery({
      db: mem.db,
      effectiveDeliveryDate: DELIVERY_DATE,
      selectionId: "sel_1",
      shop: SHOP_A,
    });
    ctx.assertNull("BoxOrder other delivery date does not match", wrongDate);

    mem.seedOrder({
      scheduledDeliveryDate: DELIVERY_DATE,
      shop: SHOP_A,
      simulated: false,
      subscriptionSelectionId: "sel_1",
    });
    const match = await findBoxOrderForEffectiveDelivery({
      db: mem.db,
      effectiveDeliveryDate: DELIVERY_DATE,
      selectionId: "sel_1",
      shop: SHOP_A,
    });
    ctx.assertTrue("BoxOrder matching delivery found", match != null);

    const coverage = await resolveCurrentDeliveryCoverage({
      db: mem.db,
      now: NOW,
      selection: {
        id: "sel_1",
        lastBillingAttemptAt: null,
        lastBillingAttemptStatus: null,
        nextScheduledDeliveryDate: DELIVERY_DATE,
        preferredDeliveryWeekday: 4,
        shop: SHOP_A,
      },
    });
    ctx.assertEqual(
      "resolveCurrentDeliveryCoverage ordered",
      coverage.coverage,
      CURRENT_DELIVERY_COVERAGE.ORDERED,
    );
    ctx.assertEqual("effectiveDeliveryDate", coverage.effectiveDeliveryDate, DELIVERY_DATE);
  }

  ctx.scenario("F. Relations — selection / shop / contract isolation");
  {
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest({ subscriptionMealSelectionId: "sel_1" }), {
      db: mem.db,
      now: NOW,
    });
    await requestSubscriptionBoxChange(
      baseRequest({
        shop: SHOP_B,
        subscriptionContractId: "gid://shopify/SubscriptionContract/99",
        subscriptionMealSelectionId: "sel_2",
      }),
      { db: mem.db, now: NOW },
    );

    const forSel1 = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_A,
      subscriptionMealSelectionId: "sel_1",
    });
    const forSel2 = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_B,
      subscriptionMealSelectionId: "sel_2",
    });
    const wrongShop = await getPendingSubscriptionBoxChange({
      db: mem.db,
      shop: SHOP_B,
      subscriptionMealSelectionId: "sel_1",
    });

    ctx.assertEqual("sel_1 pending shop A", forSel1?.shop, SHOP_A);
    ctx.assertEqual("sel_2 pending shop B", forSel2?.shop, SHOP_B);
    ctx.assertNull("shop filter isolates sel_1", wrongShop);
    ctx.assertEqual(
      "contract stored on pending",
      forSel1?.subscriptionContractId,
      "gid://shopify/SubscriptionContract/1",
    );
  }

  ctx.scenario("G. Recovery helper + BOX-CHANGE-4 billing apply wired");
  ctx.assertTrue(
    "retry_scheduled blocks future box change",
    isRecoveryBlockingBoxChange(RECOVERY_STATUS.RETRY_SCHEDULED),
  );
  ctx.assertTrue(
    "processing blocks",
    isRecoveryBlockingBoxChange(RECOVERY_STATUS.PROCESSING),
  );
  ctx.assertTrue(
    "payment_method_update_needed blocks",
    isRecoveryBlockingBoxChange(RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED),
  );
  ctx.assertFalse(
    "recovered does not block",
    isRecoveryBlockingBoxChange(RECOVERY_STATUS.RECOVERED),
  );
  ctx.assertTrue(
    "portal changeSubscriptionBox imports subscriptionBoxChange (BOX-CHANGE-3)",
    portalActionsSource.includes("subscriptionBoxChange"),
  );
  ctx.assertTrue(
    "billing worker imports applyPendingSubscriptionBoxChangeForBilling (BOX-CHANGE-4)",
    billingWorkerSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertTrue(
    "service documents no price SoT",
    serviceSource.includes("never stores a billed price") ||
      serviceSource.includes("Financial SoT"),
  );
  ctx.assertTrue(
    "request uses runAtomic / $transaction",
    serviceSource.includes("runAtomic") &&
      serviceSource.includes("$transaction"),
  );
  ctx.assertTrue(
    "status transitions use updateMany CAS",
    serviceSource.includes("updateMany") &&
      serviceSource.includes("transitioned"),
  );

  ctx.scenario("H. Concurrent request semantics (2B)");
  {
    // 1. Only one active pending possible (partial unique simulated in memory)
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest({ toMealsCount: 12 }), {
      db: mem.db,
      now: NOW,
    });
    let createThrew = false;
    try {
      await mem.db.subscriptionBoxChange.create({
        data: {
          effectiveBillingDate: EFFECTIVE_BILLING,
          fromProductVariantId: "gid://shopify/ProductVariant/8",
          shop: SHOP_A,
          status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
          subscriptionContractId: "gid://shopify/SubscriptionContract/1",
          subscriptionMealSelectionId: "sel_1",
          toMealsCount: 16,
          toProductVariantId: "gid://shopify/ProductVariant/16",
          toSelectedMeals: mealsFor(16),
        },
      });
    } catch (error) {
      createThrew =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
    }
    ctx.assertTrue("direct second pending create hits unique", createThrew);
    ctx.assertEqual("still one pending after unique fail", pendingCount(mem.changes), 1);
  }
  {
    // 2. Replacement never leaves two pendings
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(
      baseRequest({
        toMealsCount: 12,
        toProductVariantId: "gid://shopify/ProductVariant/12",
      }),
      { db: mem.db, now: NOW },
    );
    await requestSubscriptionBoxChange(
      baseRequest({
        toMealsCount: 16,
        toProductVariantId: "gid://shopify/ProductVariant/16",
        toSelectedMeals: mealsFor(16),
        toSellingPlanId: "gid://shopify/SellingPlan/16",
      }),
      { db: mem.db, now: NOW },
    );
    ctx.assertEqual("replacement leaves one pending", pendingCount(mem.changes), 1);
  }
  {
    // 3. Identical replay is no-op (no cancel ghost)
    const mem = createMemoryDb();
    const first = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const replay = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    ctx.assertTrue("replayed true", replay.replayed);
    ctx.assertFalse("replaced false on replay", replay.replaced);
    ctx.assertEqual("same logical pending id", replay.change.id, first.change.id);
    ctx.assertEqual("no cancelled ghost on replay", mem.changes.length, 1);
  }
  {
    // Concurrent A:8→12 vs B:8→16 — stale cancel + P2002 → retry, no Prisma crash
    const mem = createMemoryDb();
    await mem.db.subscriptionBoxChange.create({
      data: {
        effectiveBillingDate: EFFECTIVE_BILLING,
        fromProductVariantId: "gid://shopify/ProductVariant/8",
        shop: SHOP_A,
        status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
        subscriptionContractId: "gid://shopify/SubscriptionContract/1",
        subscriptionMealSelectionId: "sel_1",
        toMealsCount: 12,
        toProductVariantId: "gid://shopify/ProductVariant/12",
        toSelectedMeals: mealsFor(12),
        toSellingPlanId: "gid://shopify/SellingPlan/12",
      },
    });

    let findCalls = 0;
    let cancelAttempts = 0;
    const realFindFirst = mem.db.subscriptionBoxChange.findFirst.bind(
      mem.db.subscriptionBoxChange,
    );
    const realUpdateMany = mem.db.subscriptionBoxChange.updateMany.bind(
      mem.db.subscriptionBoxChange,
    );

    mem.db.subscriptionBoxChange.findFirst = async (args) => {
      findCalls += 1;
      // First getPending sees nothing (concurrent A already inserting / not visible).
      if (findCalls === 1) {
        return null;
      }
      return realFindFirst(args);
    };

    mem.db.subscriptionBoxChange.updateMany = async (args) => {
      if (
        args.data?.status === SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED &&
        cancelAttempts === 0
      ) {
        cancelAttempts += 1;
        // First cancel races before seeing A's pending → no-op, then create hits P2002.
        return { count: 0 };
      }
      return realUpdateMany(args);
    };

    const result = await requestSubscriptionBoxChange(
      baseRequest({
        toMealsCount: 16,
        toProductVariantId: "gid://shopify/ProductVariant/16",
        toSelectedMeals: mealsFor(16),
        toSellingPlanId: "gid://shopify/SellingPlan/16",
      }),
      { db: mem.db, now: NOW },
    );

    ctx.assertEqual("concurrent loser becomes active 16", result.change.toMealsCount, 16);
    ctx.assertFalse("concurrent path not a silent replay", result.replayed);
    ctx.assertEqual("exactly one pending after concurrent race", pendingCount(mem.changes), 1);
    ctx.assertTrue(
      "previous 12 cancelled (no phantom pending)",
      mem.changes.some(
        (row) =>
          row.toMealsCount === 12 &&
          row.status === SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
      ),
    );
    ctx.assertTrue("P2002 retry path exercised (cancel stubbed once)", cancelAttempts >= 1);
  }

  ctx.scenario("I. CAS state transitions (2B)");
  {
    // 4–5. pending → applying wins once
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const first = await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: change.id,
    });
    const second = await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: change.id,
    });
    ctx.assertTrue("first pending→applying wins", first.transitioned);
    ctx.assertEqual(
      "first status applying",
      first.change?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );
    ctx.assertFalse("second pending→applying fails cleanly", second.transitioned);
    ctx.assertNull("second returns null change", second.change);
  }
  {
    // 6. applying → applied once
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({ db: mem.db, id: change.id });
    const first = await markSubscriptionBoxChangeApplied({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    const second = await markSubscriptionBoxChangeApplied({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertTrue("first applying→applied wins", first.transitioned);
    ctx.assertFalse("second applying→applied fails", second.transitioned);
  }
  {
    // 7. applied → applying impossible
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({ db: mem.db, id: change.id });
    await markSubscriptionBoxChangeApplied({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    const again = await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: change.id,
    });
    ctx.assertFalse("applied → applying impossible", again.transitioned);
  }
  {
    // 8. cancelled → applying impossible
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await cancelSubscriptionBoxChange({ db: mem.db, id: change.id, now: NOW });
    const again = await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: change.id,
    });
    ctx.assertFalse("cancelled → applying impossible", again.transitioned);
  }
  {
    // 9. pending → cancelled allowed
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const cancelled = await cancelSubscriptionBoxChange({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertTrue("pending → cancelled allowed", cancelled.transitioned);
  }
  {
    // 10. applying → cancelled forbidden (no justification in this phase)
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({ db: mem.db, id: change.id });
    const cancelled = await cancelSubscriptionBoxChange({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertFalse("applying → cancelled forbidden", cancelled.transitioned);
    ctx.assertEqual(
      "row stays applying",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );
  }
  {
    // pending → failed not allowed (must claim applying first)
    const mem = createMemoryDb();
    const { change } = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    const failed = await markSubscriptionBoxChangeFailed({
      db: mem.db,
      id: change.id,
      now: NOW,
    });
    ctx.assertFalse("pending → failed forbidden", failed.transitioned);
  }

  ctx.scenario("J. Cycle key — effectiveBillingDate = next unpaid billing instant");
  {
    // Proven by real billing flow sources (not mutated here):
    // - After successful billing, worker syncs selection.nextBillingDate from Shopify
    //   (already advanced to the *next* unpaid cycle).
    // - orders/create aligns nextBillingDate to the following delivery schedule.
    // - recovery billingCycleKey is selectionId + ISO nextBillingDate of the failed cycle.
    // Therefore at request time, selection.nextBillingDate is the next unpaid cycle
    // the pending must target — including when the current delivery is already paid.
    ctx.assertTrue(
      "schema documents effectiveBillingDate = selection.nextBillingDate at request",
      schemaSource.includes("selection.nextBillingDate at request"),
    );
    ctx.assertTrue(
      "billing success syncs nextBillingDate from Shopify",
      billingWorkerSource.includes("syncNextBillingDateFromShopify") &&
        billingWorkerSource.includes("fetchSubscriptionContractNextBillingDate"),
    );
    ctx.assertTrue(
      "billing runner treats nextBillingDate as due-cycle SoT",
      billingWorkerSource.includes("selection.nextBillingDate") &&
        readRepoFile(
          "scripts/business-tests/28-billing-runner-cycle-gate.test.ts",
        ).includes("nextBillingDate is the source of truth"),
    );
    ctx.assertTrue(
      "recovery cycle key uses nextBillingDate ISO",
      readRepoFile(
        "scripts/business-tests/29-subscription-payment-recovery-cycle.test.ts",
      ).includes("billingCycleKey still uses selection id + ISO nextBillingDate"),
    );

    const mem = createMemoryDb();
    const nextUnpaidCycle = new Date("2026-09-05T22:05:00.000Z");
    const { change } = await requestSubscriptionBoxChange(
      baseRequest({ effectiveBillingDate: nextUnpaidCycle }),
      { db: mem.db, now: NOW },
    );
    ctx.assertEqual(
      "pending stores caller-provided nextBillingDate as effectiveBillingDate",
      change.effectiveBillingDate.getTime(),
      nextUnpaidCycle.getTime(),
    );
  }

  return finishSuite("80-subscription-box-change-foundation", ctx);
};

const exitCode = await runSuite().catch((error) => {
  console.error(error);
  return 1;
});
process.exitCode = exitCode;
