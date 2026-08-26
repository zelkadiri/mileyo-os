/**
 * Business regression — BOX-CHANGE-4/5 apply pending before billing (fail-closed).
 *
 * Claim CAS → Shopify runtime price → contract → selection (incl. toSelectedMeals)
 * → mark applied → then billing attempt. Recovery path must never apply.
 *
 * BOX-CHANGE-5: stale / failed / applying / claim-lost / unexpected variant
 * never silently bill the old box.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SubscriptionBoxChange, SubscriptionMealSelection } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  APPLY_PENDING_BOX_CHANGE_OUTCOME,
  BILLING_ALLOWED_BOX_CHANGE_OUTCOMES,
  PENDING_BILLING_DATE_MATCH,
  SUBSCRIPTION_BOX_CHANGE_STATUS,
  isBillingAllowedBoxChangeOutcome,
} from "../../app/constants/subscriptionBoxChange";
import type { BuilderBoxOption } from "../../app/features/builder/builder-types";
import {
  arePendingMealsReadyForApply,
  applyPendingSubscriptionBoxChangeForBilling,
  classifyPendingBillingDateMatch,
  getPendingSubscriptionBoxChange,
  getRelevantSubscriptionBoxChangeForBilling,
  isBillingAllowedAfterBoxChangeApply,
  markSubscriptionBoxChangeApplying,
  markSubscriptionBoxChangeFailed,
  normalizePendingSelectedMeals,
  requestSubscriptionBoxChange,
  sameSelectedMeals,
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

const SHOP = "mileyo-dev.myshopify.com";
const NOW = new Date("2026-08-26T10:00:00.000Z");
const DUE_BILLING = new Date("2026-08-29T22:05:00.000Z");
const FUTURE_BILLING = new Date("2026-09-05T22:05:00.000Z");
const STALE_BILLING = new Date("2026-08-22T22:05:00.000Z");

const VARIANT_8 = "gid://shopify/ProductVariant/8";
const VARIANT_12 = "gid://shopify/ProductVariant/12";
const VARIANT_16 = "gid://shopify/ProductVariant/16";
const CONTRACT = "gid://shopify/SubscriptionContract/1";
const PLAN_12 = "gid://shopify/SellingPlan/12";

let idSeq = 0;
const nextId = () => `sbc_${++idSeq}`;

const mealsFor = (count: number, prefix = "Meal") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);

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

const box12 = (price = "99.00"): BuilderBoxOption => ({
  mealCount: 12,
  objective: "weight_loss",
  price,
  productId: "gid://shopify/Product/12",
  productTitle: "Box 12",
  sellingPlanId: PLAN_12,
  variantId: VARIANT_12,
  variantTitle: "12 repas",
});

type MemorySelection = Pick<
  SubscriptionMealSelection,
  | "id"
  | "shop"
  | "subscriptionContractId"
  | "nextBillingDate"
  | "boxVariantShopifyId"
  | "boxProductShopifyId"
  | "boxSellingPlanShopifyId"
  | "boxSubscriptionPrice"
  | "boxTitle"
  | "mealsCount"
  | "selectedMeals"
>;

const createMemoryDb = (selectionSeed?: Partial<MemorySelection>) => {
  const changes: SubscriptionBoxChange[] = [];
  const selection: MemorySelection = {
    boxProductShopifyId: "gid://shopify/Product/8",
    boxSellingPlanShopifyId: "gid://shopify/SellingPlan/8",
    boxSubscriptionPrice: "64.00",
    boxTitle: "Box 8 repas",
    boxVariantShopifyId: VARIANT_8,
    id: "sel_1",
    mealsCount: 8,
    nextBillingDate: DUE_BILLING,
    selectedMeals: mealsFor(8, "Current"),
    shop: SHOP,
    subscriptionContractId: CONTRACT,
    ...selectionSeed,
  };

  const db: SubscriptionBoxChangeDb = {
    async $transaction(fn) {
      return fn(db);
    },
    boxOrder: {
      async findFirst() {
        return null;
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

        const row: SubscriptionBoxChange = {
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
        } as SubscriptionBoxChange;
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
            } as SubscriptionBoxChange;
            count += 1;
          }
        }
        return { count };
      },
    },
    subscriptionMealSelection: {
      async findUnique({ where }) {
        return where.id === selection.id
          ? (selection as SubscriptionMealSelection)
          : null;
      },
      async update({ data, where }) {
        if (where.id !== selection.id) {
          throw new Error(`missing selection ${where.id}`);
        }
        Object.assign(selection, data);
        return selection as SubscriptionMealSelection;
      },
    },
  };

  return { changes, db, selection };
};

const baseRequest = (
  overrides: Partial<Parameters<typeof requestSubscriptionBoxChange>[0]> = {},
) => ({
  effectiveBillingDate: DUE_BILLING,
  fromProductVariantId: VARIANT_8,
  shop: SHOP,
  subscriptionContractId: CONTRACT,
  subscriptionMealSelectionId: "sel_1",
  toMealsCount: 12,
  toProductVariantId: VARIANT_12,
  toSelectedMeals: mealsFor(12, "Future"),
  toSellingPlanId: PLAN_12,
  ...overrides,
});

const fakeAdmin = { graphql: async () => new Response("{}") };

const applyDeps = (
  mem: ReturnType<typeof createMemoryDb>,
  overrides: Partial<
    Parameters<typeof applyPendingSubscriptionBoxChangeForBilling>[0]
  > = {},
) => ({
  admin: fakeAdmin,
  db: mem.db,
  fetchBoxCatalog: async () => [box12("99.00")],
  fetchContractVariantId: async () => VARIANT_8,
  now: NOW,
  selection: mem.selection,
  updateContractBox: async ({ box }: { box: { price: string } }) => ({
    contractId: CONTRACT,
    previousNextBillingDate: null,
    price: box.price,
  }),
  updateSelection: async ({
    data,
    id,
  }: {
    data: Record<string, unknown>;
    id: string;
  }) => {
    Object.assign(mem.selection, data);
    return { ...mem.selection, id } as SubscriptionMealSelection;
  },
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext(
    "83-subscription-box-change-billing-apply",
  );

  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const serviceSource = readRepoFile(
    "app/services/subscriptionBoxChange.server.ts",
  );
  const processDueSource = workerSource.slice(
    workerSource.indexOf("export const processDueSubscriptionBillings"),
  );
  const recoveryRetrySource = recoverySource.slice(
    recoverySource.indexOf("export const processDueRecoveryRetries"),
  );

  ctx.scenario("A. Wiring — apply before billing, fail-closed allowlist");
  ctx.assertTrue(
    "worker imports applyPendingSubscriptionBoxChangeForBilling",
    workerSource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertTrue(
    "worker imports isBillingAllowedAfterBoxChangeApply",
    workerSource.includes("isBillingAllowedAfterBoxChangeApply"),
  );
  ctx.assertTrue(
    "worker gates billing on allowlist helper",
    processDueSource.includes("!isBillingAllowedAfterBoxChangeApply(boxChangeApply)"),
  );
  ctx.assertTrue(
    "worker uses dynamic import to avoid ESM TDZ cycle",
    processDueSource.includes('import(') &&
      processDueSource.includes("./subscriptionBoxChange.server"),
  );
  ctx.assertTrue(
    "dynamic import is before the selection loop",
    processDueSource.indexOf('import(') <
      processDueSource.indexOf("for (const selection of selections)"),
  );
  const applyCallIndex = processDueSource.indexOf(
    "applyPendingSubscriptionBoxChangeForBilling({",
  );
  ctx.assertTrue(
    "apply call sits after delivery gate",
    processDueSource.indexOf("getBillingRunnerDeliveryGate") < applyCallIndex,
  );
  ctx.assertTrue(
    "apply call sits before billing attempt",
    applyCallIndex <
      processDueSource.indexOf("triggerSubscriptionBillingAttempt"),
  );
  ctx.assertTrue(
    "skip reason pending_box_change exists",
    workerSource.includes("pending_box_change"),
  );
  ctx.assertFalse(
    "recovery retries do not call applyPending",
    recoveryRetrySource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );
  ctx.assertTrue(
    "allowlist is only no_pending / skipped_future / applied",
    BILLING_ALLOWED_BOX_CHANGE_OUTCOMES.length === 3 &&
      isBillingAllowedBoxChangeOutcome(
        APPLY_PENDING_BOX_CHANGE_OUTCOME.NO_PENDING,
      ) &&
      isBillingAllowedBoxChangeOutcome(
        APPLY_PENDING_BOX_CHANGE_OUTCOME.SKIPPED_FUTURE,
      ) &&
      isBillingAllowedBoxChangeOutcome(APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED),
  );
  ctx.assertFalse(
    "stale outcome is not billing-allowed",
    isBillingAllowedBoxChangeOutcome(
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_STALE,
    ),
  );
  ctx.assertTrue(
    "relevant query helper exists",
    serviceSource.includes("getRelevantSubscriptionBoxChangeForBilling"),
  );
  ctx.assertTrue(
    "stale log event present",
    serviceSource.includes("stale_pending_blocks_billing"),
  );
  ctx.assertTrue(
    "failed log event present",
    serviceSource.includes("failed_change_blocks_billing"),
  );
  ctx.assertTrue(
    "claim lost log event present",
    serviceSource.includes("claim_lost_blocks_billing"),
  );
  ctx.assertTrue(
    "unexpected variant log present",
    serviceSource.includes("unexpected_contract_variant"),
  );

  ctx.scenario("B. Date match classifier");
  ctx.assertEqual(
    "exact instant = match",
    classifyPendingBillingDateMatch({
      pendingEffectiveBillingDate: DUE_BILLING,
      selectionNextBillingDate: new Date(DUE_BILLING.getTime()),
    }),
    PENDING_BILLING_DATE_MATCH.MATCH,
  );
  ctx.assertEqual(
    "later pending = future",
    classifyPendingBillingDateMatch({
      pendingEffectiveBillingDate: FUTURE_BILLING,
      selectionNextBillingDate: DUE_BILLING,
    }),
    PENDING_BILLING_DATE_MATCH.FUTURE,
  );
  ctx.assertEqual(
    "earlier pending = stale",
    classifyPendingBillingDateMatch({
      pendingEffectiveBillingDate: STALE_BILLING,
      selectionNextBillingDate: DUE_BILLING,
    }),
    PENDING_BILLING_DATE_MATCH.STALE,
  );
  ctx.assertEqual(
    "missing nextBillingDate",
    classifyPendingBillingDateMatch({
      pendingEffectiveBillingDate: DUE_BILLING,
      selectionNextBillingDate: null,
    }),
    PENDING_BILLING_DATE_MATCH.MISSING,
  );

  ctx.scenario("C. Meals readiness gate");
  ctx.assertTrue(
    "12 titles for mealsCount 12 ready",
    arePendingMealsReadyForApply({
      toMealsCount: 12,
      toSelectedMeals: mealsFor(12, "Future"),
    }),
  );
  ctx.assertFalse(
    "8 titles for mealsCount 12 not ready",
    arePendingMealsReadyForApply({
      toMealsCount: 12,
      toSelectedMeals: mealsFor(8, "Future"),
    }),
  );
  ctx.assertNull(
    "non-array meals normalize to null",
    normalizePendingSelectedMeals({ bad: true }),
  );

  ctx.scenario("D. Exact pending → applied → billing allowed");
  {
    const mem = createMemoryDb();
    const futureMeals = mealsFor(12, "Future");
    await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: futureMeals }),
      { db: mem.db, now: NOW },
    );

    let contractUpdates = 0;
    let billedPrice: string | null = null;

    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_8,
        updateContractBox: async ({ box }) => {
          contractUpdates += 1;
          billedPrice = box.price;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );

    ctx.assertEqual(
      "outcome applied",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
    );
    ctx.assertFalse("does not block billing", result.blockBilling);
    ctx.assertTrue(
      "allowlist permits billing",
      isBillingAllowedAfterBoxChangeApply(result),
    );
    ctx.assertEqual("runtime price used", result.runtimePrice, "99.00");
    ctx.assertEqual("contract updated once", contractUpdates, 1);
    ctx.assertEqual("contract price is runtime 99", billedPrice, "99.00");
    ctx.assertEqual("selection mealsCount → 12", mem.selection.mealsCount, 12);
    ctx.assertEqual(
      "selection variant → 12",
      mem.selection.boxVariantShopifyId,
      VARIANT_12,
    );
    ctx.assertTrue(
      "selection selectedMeals = pending 12",
      sameSelectedMeals(mem.selection.selectedMeals, futureMeals),
    );
    ctx.assertEqual(
      "toSelectedMeals length === toMealsCount",
      Array.isArray(mem.selection.selectedMeals)
        ? mem.selection.selectedMeals.length
        : -1,
      12,
    );
    ctx.assertEqual(
      "selection display price = runtime",
      mem.selection.boxSubscriptionPrice,
      "99.00",
    );
    const pending = await getPendingSubscriptionBoxChange({
      db: mem.db,
      subscriptionMealSelectionId: "sel_1",
    });
    ctx.assertNull("no active pending after apply", pending);
    ctx.assertEqual(
      "change status applied",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    );
  }

  ctx.scenario("E. No pending → historical billing allowed");
  {
    const mem = createMemoryDb();
    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        updateContractBox: async () => {
          throw new Error("must not update");
        },
      }),
    );
    ctx.assertEqual(
      "no pending outcome",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.NO_PENDING,
    );
    ctx.assertFalse("no pending does not block billing", result.blockBilling);
    ctx.assertTrue(
      "allowlist permits billing",
      isBillingAllowedAfterBoxChangeApply(result),
    );
  }

  ctx.scenario("F. Stale pending → billing blocked, pending kept");
  {
    const staleMem = createMemoryDb();
    await requestSubscriptionBoxChange(
      baseRequest({ effectiveBillingDate: STALE_BILLING }),
      { db: staleMem.db, now: NOW },
    );
    let staleContract = 0;
    const staleResult = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(staleMem, {
        updateContractBox: async () => {
          staleContract += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );
    ctx.assertEqual(
      "stale outcome blocked",
      staleResult.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_STALE,
    );
    ctx.assertTrue("stale blocks billing", staleResult.blockBilling);
    ctx.assertFalse(
      "allowlist denies stale",
      isBillingAllowedAfterBoxChangeApply(staleResult),
    );
    ctx.assertEqual("stale did not mutate contract", staleContract, 0);
    ctx.assertEqual(
      "stale pending not deleted",
      staleMem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
    );
    ctx.assertEqual("selection stays 8", staleMem.selection.mealsCount, 8);

    const missingMem = createMemoryDb({ nextBillingDate: null });
    await requestSubscriptionBoxChange(baseRequest(), {
      db: missingMem.db,
      now: NOW,
    });
    const missingDate = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(missingMem),
    );
    ctx.assertEqual(
      "missing date blocks",
      missingDate.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_MISSING_BILLING_DATE,
    );
    ctx.assertTrue("missing date blocks billing", missingDate.blockBilling);
  }

  ctx.scenario("G. Failed target cycle → billing blocked");
  {
    const mem = createMemoryDb();
    const created = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });
    await markSubscriptionBoxChangeFailed({
      db: mem.db,
      failureReason: "Target variant unavailable in Shopify catalog",
      id: created.change.id,
      now: NOW,
    });

    let contractUpdates = 0;
    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        updateContractBox: async () => {
          contractUpdates += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );

    ctx.assertEqual(
      "failed change outcome",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_FAILED_CHANGE,
    );
    ctx.assertTrue("failed blocks billing", result.blockBilling);
    ctx.assertEqual("no contract mutation on failed", contractUpdates, 0);
    ctx.assertEqual("selection stays 8", mem.selection.mealsCount, 8);
    ctx.assertEqual(
      "failed row preserved",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
    );

    const relevant = await getRelevantSubscriptionBoxChangeForBilling({
      db: mem.db,
      subscriptionMealSelectionId: "sel_1",
    });
    ctx.assertEqual(
      "relevant query finds failed",
      relevant?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
    );
  }

  ctx.scenario("H. Future pending → current billing allowed");
  {
    const futureMem = createMemoryDb();
    await requestSubscriptionBoxChange(
      baseRequest({ effectiveBillingDate: FUTURE_BILLING }),
      { db: futureMem.db, now: NOW },
    );
    let futureContract = 0;
    const futureResult = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(futureMem, {
        updateContractBox: async () => {
          futureContract += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );
    ctx.assertEqual(
      "future outcome",
      futureResult.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.SKIPPED_FUTURE,
    );
    ctx.assertFalse("future does not block billing", futureResult.blockBilling);
    ctx.assertTrue(
      "allowlist permits future",
      isBillingAllowedAfterBoxChangeApply(futureResult),
    );
    ctx.assertEqual("future did not mutate contract", futureContract, 0);
    ctx.assertEqual(
      "future pending still pending",
      futureMem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
    );
  }

  ctx.scenario("I. Applying recovery — contract target + selection old → heal");
  {
    const mem = createMemoryDb();
    const futureMeals = mealsFor(12, "Future");
    const created = await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: futureMeals }),
      { db: mem.db, now: NOW },
    );
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });

    let contractUpdates = 0;
    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_12,
        updateContractBox: async () => {
          contractUpdates += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );

    ctx.assertEqual(
      "reconcile applied",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
    );
    ctx.assertTrue(
      "billing allowed after heal",
      isBillingAllowedAfterBoxChangeApply(result),
    );
    ctx.assertEqual("no second Shopify mutation", contractUpdates, 0);
    ctx.assertEqual("selection healed to 12", mem.selection.mealsCount, 12);
    ctx.assertEqual(
      "healed meals length === toMealsCount",
      Array.isArray(mem.selection.selectedMeals)
        ? mem.selection.selectedMeals.length
        : -1,
      12,
    );
    ctx.assertTrue(
      "selection meals healed",
      sameSelectedMeals(mem.selection.selectedMeals, futureMeals),
    );
    ctx.assertEqual(
      "status applied",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    );
  }

  ctx.scenario("J. Applying + contract target + selection target → applied");
  {
    const futureMeals = mealsFor(12, "Future");
    const mem = createMemoryDb({
      boxProductShopifyId: "gid://shopify/Product/12",
      boxSellingPlanShopifyId: PLAN_12,
      boxSubscriptionPrice: "99.00",
      boxTitle: "Box 12 repas",
      boxVariantShopifyId: VARIANT_12,
      mealsCount: 12,
      selectedMeals: futureMeals,
    });
    const created = await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: futureMeals }),
      { db: mem.db, now: NOW },
    );
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });

    let contractUpdates = 0;
    let selectionUpdates = 0;
    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_12,
        updateContractBox: async () => {
          contractUpdates += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
        updateSelection: async ({ data, id }) => {
          selectionUpdates += 1;
          Object.assign(mem.selection, data);
          return { ...mem.selection, id } as SubscriptionMealSelection;
        },
      }),
    );

    ctx.assertEqual(
      "already coherent → applied",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
    );
    ctx.assertEqual("no contract update", contractUpdates, 0);
    ctx.assertEqual("no selection rewrite", selectionUpdates, 0);
    ctx.assertTrue(
      "billing allowed",
      isBillingAllowedAfterBoxChangeApply(result),
    );
  }

  ctx.scenario("K. Applying + contract old → retry draft, never bill mid-way");
  {
    const mem = createMemoryDb();
    const created = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });

    // First: draft fails (timeout) → stay applying, block
    const timeout = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_8,
        updateContractBox: async () => {
          throw new Error("network timeout on draft commit");
        },
      }),
    );
    ctx.assertEqual(
      "timeout retryable",
      timeout.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
    );
    ctx.assertTrue("timeout blocks billing", timeout.blockBilling);
    ctx.assertEqual(
      "stays applying after timeout",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );
    ctx.assertEqual("selection still 8 after timeout", mem.selection.mealsCount, 8);

    // Second run: Shopify already committed (ambiguous success) → heal + applied
    let contractUpdates = 0;
    const healed = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_12,
        updateContractBox: async () => {
          contractUpdates += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );
    ctx.assertEqual(
      "post-timeout reconcile applied",
      healed.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
    );
    ctx.assertEqual("no double contract mutation", contractUpdates, 0);
    ctx.assertEqual("selection healed to 12", mem.selection.mealsCount, 12);
    ctx.assertTrue(
      "billing allowed only after reconcile",
      isBillingAllowedAfterBoxChangeApply(healed),
    );
    ctx.assertEqual(
      "status applied once",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    );
  }

  ctx.scenario("L. Applying + unexpected third variant → billing blocked");
  {
    const mem = createMemoryDb();
    const created = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });

    let contractUpdates = 0;
    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        fetchContractVariantId: async () => VARIANT_16,
        updateContractBox: async () => {
          contractUpdates += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );

    ctx.assertEqual(
      "unexpected variant outcome",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_UNEXPECTED_CONTRACT_VARIANT,
    );
    ctx.assertTrue("unexpected blocks billing", result.blockBilling);
    ctx.assertEqual("did not mutate contract", contractUpdates, 0);
    ctx.assertEqual("selection stays 8", mem.selection.mealsCount, 8);
    ctx.assertEqual(
      "stays applying for ops",
      mem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );
  }

  ctx.scenario("M. Claim concurrency — loser blocks billing");
  {
    const mem2 = createMemoryDb();
    const pending2 = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem2.db,
      now: NOW,
    });
    const [claimA, claimB] = await Promise.all([
      markSubscriptionBoxChangeApplying({
        db: mem2.db,
        id: pending2.change.id,
      }),
      markSubscriptionBoxChangeApplying({
        db: mem2.db,
        id: pending2.change.id,
      }),
    ]);
    ctx.assertEqual(
      "exactly one CAS claim winner",
      [claimA, claimB].filter((c) => c.transitioned).length,
      1,
    );

    const mem3 = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest(), {
      db: mem3.db,
      now: NOW,
    });
    const originalUpdateMany = mem3.db.subscriptionBoxChange.updateMany;
    mem3.db.subscriptionBoxChange.updateMany = async (args) => {
      if (
        args.data.status === SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING &&
        args.where.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING
      ) {
        return { count: 0 };
      }
      return originalUpdateMany(args);
    };
    let loserContract = 0;
    const claimLost = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem3, {
        updateContractBox: async () => {
          loserContract += 1;
          return { contractId: CONTRACT, previousNextBillingDate: null };
        },
      }),
    );
    ctx.assertEqual(
      "claim lost outcome",
      claimLost.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_CLAIM_LOST,
    );
    ctx.assertTrue("claim lost blocks billing", claimLost.blockBilling);
    ctx.assertEqual("loser did not mutate Shopify", loserContract, 0);
  }

  ctx.scenario("N. Terminal target error → failed + billing blocked");
  {
    const missingMem = createMemoryDb();
    await requestSubscriptionBoxChange(baseRequest(), {
      db: missingMem.db,
      now: NOW,
    });
    const missing = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(missingMem, {
        fetchBoxCatalog: async () => [],
        updateContractBox: async () => {
          throw new Error("should not update contract");
        },
      }),
    );
    ctx.assertEqual(
      "missing variant terminal",
      missing.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.FAILED_TERMINAL,
    );
    ctx.assertTrue("missing variant blocks billing", missing.blockBilling);
    ctx.assertEqual("selection still 8", missingMem.selection.mealsCount, 8);
    ctx.assertEqual(
      "pending marked failed",
      missingMem.changes[0]?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
    );

    // Next cron still sees failed and blocks (no silent old-box billing)
    const second = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(missingMem, {
        fetchBoxCatalog: async () => [box12()],
        updateContractBox: async () => {
          throw new Error("must not bill old box");
        },
      }),
    );
    ctx.assertEqual(
      "second run still blocked on failed",
      second.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_FAILED_CHANGE,
    );
    ctx.assertTrue("second run blocks billing", second.blockBilling);
  }

  ctx.scenario("O. Matching cycle with bad meals — fail + block billing");
  {
    const mem = createMemoryDb();
    await requestSubscriptionBoxChange(
      baseRequest({ toSelectedMeals: mealsFor(8, "Bad") }),
      { db: mem.db, now: NOW },
    );
    mem.changes[0]!.toSelectedMeals = mealsFor(8, "Bad");
    mem.changes[0]!.toMealsCount = 12;

    const result = await applyPendingSubscriptionBoxChangeForBilling(
      applyDeps(mem, {
        updateContractBox: async () => {
          throw new Error("must not update");
        },
      }),
    );
    ctx.assertEqual(
      "bad meals terminal",
      result.outcome,
      APPLY_PENDING_BOX_CHANGE_OUTCOME.FAILED_TERMINAL,
    );
    ctx.assertTrue("bad meals block billing", result.blockBilling);
    ctx.assertEqual("selection stays 8", mem.selection.mealsCount, 8);
  }

  ctx.scenario("P. Relevant query priority — applying over pending over failed");
  {
    const mem = createMemoryDb();
    const created = await requestSubscriptionBoxChange(baseRequest(), {
      db: mem.db,
      now: NOW,
    });
    // Simulate: failed older row + applying current (priority)
    mem.changes.push({
      ...created.change,
      id: nextId(),
      requestedAt: new Date(NOW.getTime() - 60_000),
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
      failedAt: NOW,
      failureReason: "older",
    });
    await markSubscriptionBoxChangeApplying({
      db: mem.db,
      id: created.change.id,
    });

    const relevant = await getRelevantSubscriptionBoxChangeForBilling({
      db: mem.db,
      subscriptionMealSelectionId: "sel_1",
    });
    ctx.assertEqual(
      "applying wins over failed",
      relevant?.status,
      SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    );
    ctx.assertEqual("applying id is current claim", relevant?.id, created.change.id);
  }

  return finishSuite("83-subscription-box-change-billing-apply", ctx);
};

process.exitCode = await runSuite();
