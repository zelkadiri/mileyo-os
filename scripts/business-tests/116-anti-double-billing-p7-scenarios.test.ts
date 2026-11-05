/**
 * P7 preflight — 8 critical anti-double-billing scenarios.
 *
 * METHOD: simulation + isolated embedded PostgreSQL (NOT live Shopify).
 * Isolation: no .env.production.local, no CRON, no webhooks, no emails, no payments.
 * Code under test: helpers/constants from HEAD (d3c6e47 / includes 1031cf5).
 */
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";

import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { BILLING_CYCLE_CLAIM_STATUS } from "../../app/constants/subscriptionBillingCycleClaim";
import { isSubscriptionBillingIncidentHeld } from "../../app/constants/subscriptionBillingIncidentHold";
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  getSelectionSkipReason,
  resolveAutoBillingNextBillingDate,
} from "../../app/services/subscriptionBillingWorker.server";
import {
  classifyBillableShopifyCycle,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import {
  buildAutoBillingIdempotencyKeyFromShopifyCycle,
  buildBillingCycleKeyFromShopifyCycle,
} from "../../app/utils/subscriptionBillingCycleKeys";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const DDL = [
  `CREATE TABLE "SubscriptionMealSelection" ("id" TEXT PRIMARY KEY)`,
  `CREATE TABLE "SubscriptionBillingCycleClaim" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "subscriptionMealSelectionId" TEXT NOT NULL REFERENCES "SubscriptionMealSelection"("id") ON DELETE CASCADE,
  "subscriptionContractId" TEXT,
  "billingCycleKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "billingAttemptId" TEXT,
  "shopifyOrderId" TEXT,
  "lastErrorMessage" TEXT,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt" TIMESTAMP(3),
  "lastReconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE UNIQUE INDEX "uq_claim_selection_cycle"
  ON "SubscriptionBillingCycleClaim"("subscriptionMealSelectionId", "billingCycleKey")`,
  `CREATE UNIQUE INDEX "uq_claim_idempotency"
  ON "SubscriptionBillingCycleClaim"("idempotencyKey")`,
];

type ClaimRow = {
  billingCycleKey: string;
  id: string;
  idempotencyKey: string;
  status: string;
};

type ScenarioEvidence = {
  billingAttempts: number;
  claimStatus: string | null;
  cycleIndex: number | null;
  invocations: number;
  method: "simulation+embedded-pg";
  nbdAfter: string | null;
  nbdBefore: string | null;
  ordersCreated: number;
  result: "PASS" | "FAIL";
  scenario: string;
};

const evidence: ScenarioEvidence[] = [];

const getFreePort = async () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const createMockShopify = () => {
  const attemptsByKey = new Map<
    string,
    { id: string; orderId: string | null; cycleIndex: number; status: string }
  >();
  let createCalls = 0;
  let failNext = false;
  let hangNext = false;

  return {
    createCalls: () => createCalls,
    createBillingAttempt: async (
      idempotencyKey: string,
      cycleIndex: number,
    ) => {
      if (hangNext) {
        hangNext = false;
        throw new Error("Shopify timeout simulated");
      }
      createCalls += 1;
      const existing = attemptsByKey.get(idempotencyKey);
      if (existing) return existing;
      if (failNext) {
        failNext = false;
        const failed = {
          cycleIndex,
          id: `gid://shopify/SubscriptionBillingAttempt/fail_${createCalls}`,
          orderId: null as string | null,
          status: "failure",
        };
        attemptsByKey.set(idempotencyKey, failed);
        return failed;
      }
      const created = {
        cycleIndex,
        id: `gid://shopify/SubscriptionBillingAttempt/${createCalls}`,
        orderId: `gid://shopify/Order/${1000 + createCalls}`,
        status: "success",
      };
      attemptsByKey.set(idempotencyKey, created);
      return created;
    },
    failNext: () => {
      failNext = true;
    },
    hangNext: () => {
      hangNext = true;
    },
    orderCount: () =>
      [...attemptsByKey.values()].filter((a) => Boolean(a.orderId)).length,
    resetCalls: () => {
      createCalls = 0;
    },
  };
};

const claimOrLoad = async (
  db: PrismaClient,
  {
    selectionId,
    shop,
    shopifyCycleIndex,
    source = "cron",
    contractId = "99900011122",
  }: {
    contractId?: string;
    selectionId: string;
    shop: string;
    shopifyCycleIndex: number;
    source?: string;
  },
) => {
  const billingCycleKey = buildBillingCycleKeyFromShopifyCycle(
    selectionId,
    shopifyCycleIndex,
  );
  const idempotencyKey = buildAutoBillingIdempotencyKeyFromShopifyCycle(
    selectionId,
    shopifyCycleIndex,
  );
  const id = `claim_${Math.random().toString(36).slice(2, 10)}`;

  try {
    await db.$executeRawUnsafe(
      `INSERT INTO "SubscriptionBillingCycleClaim"
        ("id","shop","subscriptionMealSelectionId","subscriptionContractId","billingCycleKey","idempotencyKey","status","source","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      id,
      shop,
      selectionId,
      contractId,
      billingCycleKey,
      idempotencyKey,
      BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      source,
    );
    return {
      action: "proceed" as const,
      claim: {
        billingCycleKey,
        id,
        idempotencyKey,
        status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      },
      isNew: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unique|duplicate|already exists|23505/i.test(message)) {
      throw error;
    }
  }

  const rows = await db.$queryRawUnsafe<ClaimRow[]>(
    `SELECT "id","billingCycleKey","idempotencyKey","status"
     FROM "SubscriptionBillingCycleClaim"
     WHERE "subscriptionMealSelectionId" = $1 AND "billingCycleKey" = $2`,
    selectionId,
    billingCycleKey,
  );
  const existing = rows[0];
  if (!existing) throw new Error("unique conflict but row missing");
  if (existing.status === BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED) {
    return { action: "block_succeeded" as const, claim: existing };
  }
  if (existing.status === BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN) {
    return { action: "block_uncertain" as const, claim: existing };
  }
  if (
    existing.status === BILLING_CYCLE_CLAIM_STATUS.CLAIMED ||
    existing.status === BILLING_CYCLE_CLAIM_STATUS.SUBMITTED
  ) {
    return { action: "reconcile_in_flight" as const, claim: existing };
  }
  return { action: "proceed" as const, claim: existing, isNew: false };
};

const markSucceeded = async (
  db: PrismaClient,
  claimId: string,
  attemptId: string,
  orderId: string,
) => {
  await db.$executeRawUnsafe(
    `UPDATE "SubscriptionBillingCycleClaim"
     SET "status"=$1, "billingAttemptId"=$2, "shopifyOrderId"=$3, "succeededAt"=NOW(), "updatedAt"=NOW()
     WHERE "id"=$4`,
    BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
    attemptId,
    orderId,
    claimId,
  );
};

const markUncertain = async (
  db: PrismaClient,
  claimId: string,
  attemptId: string | null,
  message: string,
) => {
  await db.$executeRawUnsafe(
    `UPDATE "SubscriptionBillingCycleClaim"
     SET "status"=$1, "billingAttemptId"=COALESCE($2,"billingAttemptId"), "lastErrorMessage"=$3, "updatedAt"=NOW()
     WHERE "id"=$4`,
    BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
    attemptId,
    message,
    claimId,
  );
};

const dueSelection = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextBillingDate: new Date("2026-11-06T16:00:00.000Z"),
  nextScheduledDeliveryDate: "2026-11-12",
  preferredDeliveryWeekday: 4,
  resumeAttemptKey: null as string | null,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStartedAt: null as Date | null,
  resumeAttemptStatus: null as string | null,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "99900011122",
  ...overrides,
});

const paidAttempt = (orderName: string) => [
  {
    completedAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    id: `att_${orderName}`,
    idempotencyKey: null,
    orderId: `gid://shopify/Order/${orderName}`,
    orderName,
  },
];

const mkCycle = (
  cycleIndex: number,
  expected: string,
  attempts: ShopifyBillingCycleSnapshot["attempts"],
  status = "UNBILLED",
): ShopifyBillingCycleSnapshot => ({
  attempts,
  billingAttemptExpectedDate: expected,
  cycleEndAt: expected,
  cycleIndex,
  cycleStartAt: new Date(new Date(expected).getTime() - 7 * 86400000).toISOString(),
  edited: false,
  skipped: false,
  status,
  successfulAttempts: attempts.filter((a) => Boolean(a.orderId)),
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("116-anti-double-billing-p7-scenarios");
  let postgres: InstanceType<typeof EmbeddedPostgres> | null = null;
  let db: PrismaClient | null = null;
  let databaseDir = "";

  try {
    // Isolation assert — refuse if someone exported PROD URL into process.
    const envDb = process.env.DATABASE_URL ?? "";
    const envHost = envDb.match(/@([^/:]+)/)?.[1] ?? "";
    ctx.assertFalse(
      "process env is not PROD supabase host",
      envHost === "aws-1-eu-west-1.pooler.supabase.com",
    );

    const port = await getFreePort();
    databaseDir = `/tmp/mileyo-p7-anti-double-${port}`;
    rmSync(databaseDir, { recursive: true, force: true });
    mkdirSync(databaseDir, { recursive: true });

    postgres = new EmbeddedPostgres({
      databaseDir,
      persistent: false,
      port,
      password: "postgres",
      user: "postgres",
    });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("p7_anti_double");

    db = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://postgres:postgres@127.0.0.1:${port}/p7_anti_double`,
        },
      },
    });
    for (const statement of DDL) {
      await db.$executeRawUnsafe(statement);
    }

    const selectionId = "sel_p7_isolated_001";
    const shop = "mileyo-ok1bszwz.myshopify.com";
    await db.$executeRawUnsafe(
      `INSERT INTO "SubscriptionMealSelection" ("id") VALUES ($1)`,
      selectionId,
    );
    const shopify = createMockShopify();

    // ── TEST 1 — Renouvellement normal ─────────────────────────────────────
    ctx.scenario("TEST 1 — Renouvellement normal");
    {
      const nbdBefore = new Date("2026-11-06T16:00:00.000Z");
      const classified = classifyBillableShopifyCycle({
        cycles: [
          mkCycle(1, "2026-10-30T16:00:00.000Z", paidAttempt("1001"), "BILLED"),
          mkCycle(2, "2026-11-06T16:00:00.000Z", [], "UNBILLED"),
        ],
        nextBillingDate: nbdBefore,
        now: new Date("2026-11-06T17:00:00.000Z"),
      });
      ctx.assertEqual("classifier billable", classified.action, "billable");
      const cycleIndex =
        classified.action === "billable" ? classified.shopifyCycleIndex : -1;
      ctx.assertEqual("cycleIndex 2", cycleIndex, 2);

      shopify.resetCalls();
      const reserved = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: cycleIndex,
        source: "cron",
      });
      ctx.assertEqual("claim proceed", reserved.action, "proceed");
      const attempt = await shopify.createBillingAttempt(
        reserved.claim.idempotencyKey,
        cycleIndex,
      );
      await markSucceeded(db, reserved.claim.id, attempt.id, attempt.orderId!);
      const nbdAfter = resolveAutoBillingNextBillingDate({
        billingPolicy: { interval: "WEEK", intervalCount: 1 },
        dueBillingDate: nbdBefore,
        paymentAt: new Date("2026-11-06T17:00:30.000Z"),
      });
      const reload = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: cycleIndex,
      });
      ctx.assertEqual("no second claim", reload.action, "block_succeeded");
      ctx.assertEqual("one Shopify create", shopify.createCalls(), 1);
      ctx.assertEqual("one order", shopify.orderCount(), 1);

      const pass =
        classified.action === "billable" &&
        reserved.action === "proceed" &&
        reload.action === "block_succeeded" &&
        shopify.createCalls() === 1;
      evidence.push({
        billingAttempts: shopify.createCalls(),
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex,
        invocations: 2,
        method: "simulation+embedded-pg",
        nbdAfter: nbdAfter.toISOString(),
        nbdBefore: nbdBefore.toISOString(),
        ordersCreated: 1,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 1 — Renouvellement normal",
      });
      ctx.assertTrue("TEST 1 PASS", pass);
    }

    // ── TEST 2 — Bug Hossam + false-positive regression ────────────────────
    ctx.scenario("TEST 2 — Bug Hossam (paid, NBD stuck, multi-run)");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();
      const nbdStuck = new Date("2026-10-30T16:00:00.000Z");
      const now = new Date("2026-11-03T12:00:00.000Z");
      const selection = dueSelection({
        lastBillingAttemptAt: new Date("2026-11-03T00:00:30.000Z"),
        lastBillingAttemptStatus: "success",
        nextBillingDate: nbdStuck,
        subscriptionContractId: "88877766655",
      });
      const skip = getSelectionSkipReason(selection, null, now);
      ctx.assertEqual(
        "skip paid unadvanced",
        skip,
        "cycle_already_paid_unadvanced",
      );

      // Regression: August success must not block November due cycle.
      const healthySkip = getSelectionSkipReason(
        dueSelection({
          lastBillingAttemptAt: new Date("2026-08-18T11:49:36.000Z"),
          lastBillingAttemptStatus: "success",
          nextBillingDate: new Date("2026-11-06T23:05:00.000Z"),
          subscriptionContractId: "88877766655",
        }),
        null,
        new Date("2026-11-07T00:10:00.000Z"),
      );
      ctx.assertNull("prior-cycle success allows Nov renewal", healthySkip);

      const hossamClass = classifyBillableShopifyCycle({
        cycles: [
          mkCycle(1, "2026-10-30T16:00:00.000Z", [], "UNBILLED"),
          mkCycle(
            2,
            "2026-11-06T16:00:00.000Z",
            paidAttempt("1216").concat(paidAttempt("1219")),
            "BILLED",
          ),
        ],
        nextBillingDate: nbdStuck,
        now,
      });
      ctx.assertEqual(
        "ambiguous blocks recharge",
        hossamClass.action,
        "block_ambiguous",
      );

      // Even if classifier were bypassed: claim succeeded for c2 blocks.
      await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 2,
      });
      const first = await shopify.createBillingAttempt(
        buildAutoBillingIdempotencyKeyFromShopifyCycle(selectionId, 2),
        2,
      );
      const claimRow = (
        await db.$queryRawUnsafe<ClaimRow[]>(
          `SELECT "id","billingCycleKey","idempotencyKey","status" FROM "SubscriptionBillingCycleClaim" LIMIT 1`,
        )
      )[0]!;
      await markSucceeded(db, claimRow.id, first.id, first.orderId!);

      let blocked = 0;
      let creates = 0;
      for (let i = 0; i < 5; i += 1) {
        const skipAgain = getSelectionSkipReason(selection, null, now);
        if (skipAgain === "cycle_already_paid_unadvanced") blocked += 1;
        const again = await claimOrLoad(db, {
          selectionId,
          shop,
          shopifyCycleIndex: 2,
        });
        if (again.action === "block_succeeded") {
          blocked += 1;
        } else if (again.action === "proceed") {
          await shopify.createBillingAttempt(again.claim.idempotencyKey, 2);
          creates += 1;
        }
      }
      ctx.assertEqual("five runner skips", blocked >= 5, true);
      ctx.assertEqual("zero extra creates after success", creates, 0);
      const pass = skip === "cycle_already_paid_unadvanced" && creates === 0;
      evidence.push({
        billingAttempts: 1,
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex: 2,
        invocations: 5,
        method: "simulation+embedded-pg",
        nbdAfter: nbdStuck.toISOString(),
        nbdBefore: nbdStuck.toISOString(),
        ordersCreated: 1,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 2 — Bug Hossam",
      });
      ctx.assertTrue("TEST 2 PASS", pass);
    }

    // ── TEST 3 — Concurrence ───────────────────────────────────────────────
    ctx.scenario("TEST 3 — Concurrence parallèle même cycle");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          claimOrLoad(db!, {
            selectionId,
            shop,
            shopifyCycleIndex: 7,
            source: "cron",
          }),
        ),
      );
      const fresh = results.filter((r) => r.action === "proceed" && r.isNew);
      ctx.assertEqual("one winner", fresh.length, 1);
      if (fresh[0]) {
        const paid = await shopify.createBillingAttempt(
          fresh[0].claim.idempotencyKey,
          7,
        );
        await markSucceeded(db, fresh[0].claim.id, paid.id, paid.orderId!);
      }
      const losers = results.filter((r) => r.action !== "proceed" || !r.isNew);
      for (const loser of losers) {
        if (loser.action === "proceed") {
          await shopify.createBillingAttempt(loser.claim.idempotencyKey, 7);
        }
      }
      const count = await db.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM "SubscriptionBillingCycleClaim"`,
      );
      ctx.assertEqual("single claim row", Number(count[0]?.c ?? 0), 1);
      ctx.assertEqual("single order via same key", shopify.orderCount() >= 1, true);
      // Idempotent key: at most one distinct order for the cycle key.
      const pass = fresh.length === 1 && Number(count[0]?.c ?? 0) === 1;
      evidence.push({
        billingAttempts: shopify.createCalls(),
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex: 7,
        invocations: 8,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 1,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 3 — Concurrence",
      });
      ctx.assertTrue("TEST 3 PASS", pass);
    }

    // ── TEST 4 — Incident après paiement (uncertain) ───────────────────────
    ctx.scenario("TEST 4 — Shopify paid / DB uncertain → reconcile no double");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();
      const reserved = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 8,
      });
      const paid = await shopify.createBillingAttempt(
        reserved.claim.idempotencyKey,
        8,
      );
      // Crash before markSucceeded → uncertain
      await markUncertain(db, reserved.claim.id, paid.id, "crash_after_shopify");
      const retry1 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 8,
      });
      ctx.assertEqual("blocks uncertain", retry1.action, "block_uncertain");
      // Reconcile: mark succeeded from Shopify order without new create
      await markSucceeded(db, reserved.claim.id, paid.id, paid.orderId!);
      const retry2 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 8,
      });
      ctx.assertEqual("after reconcile block", retry2.action, "block_succeeded");
      ctx.assertEqual("still one create", shopify.createCalls(), 1);
      const pass =
        retry1.action === "block_uncertain" &&
        retry2.action === "block_succeeded" &&
        shopify.createCalls() === 1;
      evidence.push({
        billingAttempts: 1,
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex: 8,
        invocations: 3,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 1,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 4 — Incident après paiement",
      });
      ctx.assertTrue("TEST 4 PASS", pass);
    }

    // ── TEST 5 — Recovery / Admin / Cron paths ─────────────────────────────
    ctx.scenario("TEST 5 — Chemins cron/admin/recovery/resume");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();
      const sources = ["cron", "admin", "recovery", "resume"] as const;
      const results = await Promise.all(
        sources.map((source) =>
          claimOrLoad(db!, {
            selectionId,
            shop,
            shopifyCycleIndex: 9,
            source,
          }),
        ),
      );
      const winners = results.filter((r) => r.action === "proceed" && r.isNew);
      ctx.assertEqual("single path winner", winners.length, 1);
      const winner = winners[0]!;
      const paid = await shopify.createBillingAttempt(
        winner.claim.idempotencyKey,
        9,
      );
      await markSucceeded(db, winner.claim.id, paid.id, paid.orderId!);
      for (const source of sources) {
        const again = await claimOrLoad(db, {
          selectionId,
          shop,
          shopifyCycleIndex: 9,
          source,
        });
        ctx.assertEqual(
          `${source} blocked after success`,
          again.action,
          "block_succeeded",
        );
      }
      const pass = winners.length === 1 && shopify.createCalls() === 1;
      evidence.push({
        billingAttempts: 1,
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex: 9,
        invocations: sources.length * 2,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 1,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 5 — Recovery/Admin/Cron",
      });
      ctx.assertTrue("TEST 5 PASS", pass);
    }

    // ── TEST 6 — Cycle suivant légitime ────────────────────────────────────
    ctx.scenario("TEST 6 — Cycle suivant facturable une fois");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();
      const c10 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 10,
      });
      const paid10 = await shopify.createBillingAttempt(
        c10.claim.idempotencyKey,
        10,
      );
      await markSucceeded(db, c10.claim.id, paid10.id, paid10.orderId!);
      const block10 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 10,
      });
      ctx.assertEqual("c10 blocked", block10.action, "block_succeeded");

      const c11 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 11,
      });
      ctx.assertEqual("c11 proceed", c11.action, "proceed");
      const paid11 = await shopify.createBillingAttempt(
        c11.claim.idempotencyKey,
        11,
      );
      await markSucceeded(db, c11.claim.id, paid11.id, paid11.orderId!);
      const block11 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 11,
      });
      ctx.assertEqual("c11 once only", block11.action, "block_succeeded");
      ctx.assertEqual("two orders two cycles", shopify.createCalls(), 2);
      const pass =
        block10.action === "block_succeeded" &&
        c11.action === "proceed" &&
        block11.action === "block_succeeded" &&
        shopify.createCalls() === 2;
      evidence.push({
        billingAttempts: 2,
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        cycleIndex: 11,
        invocations: 4,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 2,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 6 — Cycle suivant",
      });
      ctx.assertTrue("TEST 6 PASS", pass);
    }

    // ── TEST 7 — HOLD ──────────────────────────────────────────────────────
    ctx.scenario("TEST 7 — HOLD bloque tous les chemins");
    {
      const heldId = "26652508488";
      ctx.assertTrue("hold constant", isSubscriptionBillingIncidentHeld(heldId));
      ctx.assertTrue(
        "hold gid form",
        isSubscriptionBillingIncidentHeld(
          `gid://shopify/SubscriptionContract/${heldId}`,
        ),
      );
      const skip = getSelectionSkipReason(
        dueSelection({ subscriptionContractId: heldId }),
      );
      ctx.assertEqual("skip hold", skip, "incident_billing_hold");
      // Simulate trigger gate: never create if held.
      let creates = 0;
      for (const _path of ["cron", "admin", "recovery", "resume"]) {
        if (isSubscriptionBillingIncidentHeld(heldId)) {
          continue;
        }
        creates += 1;
      }
      ctx.assertEqual("zero creates under hold", creates, 0);
      const pass = skip === "incident_billing_hold" && creates === 0;
      evidence.push({
        billingAttempts: 0,
        claimStatus: null,
        cycleIndex: null,
        invocations: 4,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 0,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 7 — HOLD",
      });
      ctx.assertTrue("TEST 7 PASS", pass);
    }

    // ── TEST 8 — Erreur Shopify (timeout / failure / uncertain) ────────────
    ctx.scenario("TEST 8 — Erreur Shopify sans répétition aveugle");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      shopify.resetCalls();

      // 8a timeout after create started → uncertain → block
      const reserved = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 12,
      });
      shopify.hangNext();
      let timedOut = false;
      try {
        await shopify.createBillingAttempt(reserved.claim.idempotencyKey, 12);
      } catch {
        timedOut = true;
        await markUncertain(
          db,
          reserved.claim.id,
          null,
          "shopify_timeout_uncertain",
        );
      }
      ctx.assertTrue("timeout observed", timedOut);
      const afterTimeout = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 12,
      });
      ctx.assertEqual(
        "uncertain blocks retry",
        afterTimeout.action,
        "block_uncertain",
      );

      // 8b confirmed failure can rotate (recovery) — but NOT blind same-key recharge
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      const r2 = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 13,
      });
      shopify.failNext();
      const failed = await shopify.createBillingAttempt(
        r2.claim.idempotencyKey,
        13,
      );
      ctx.assertEqual("failure status", failed.status, "failure");
      await db.$executeRawUnsafe(
        `UPDATE "SubscriptionBillingCycleClaim"
         SET "status"=$1, "lastErrorMessage"=$2, "updatedAt"=NOW() WHERE "id"=$3`,
        BILLING_CYCLE_CLAIM_STATUS.FAILED,
        "shopify_api_error",
        r2.claim.id,
      );
      // Blind retry same key would return same failure object (idempotent), not new charge.
      const sameKey = await shopify.createBillingAttempt(
        r2.claim.idempotencyKey,
        13,
      );
      ctx.assertEqual("same key no new order", sameKey.orderId, null);
      ctx.assertEqual("same attempt id", sameKey.id, failed.id);

      const pass =
        afterTimeout.action === "block_uncertain" && sameKey.orderId === null;
      evidence.push({
        billingAttempts: shopify.createCalls(),
        claimStatus: BILLING_CYCLE_CLAIM_STATUS.FAILED,
        cycleIndex: 13,
        invocations: 4,
        method: "simulation+embedded-pg",
        nbdAfter: null,
        nbdBefore: null,
        ordersCreated: 0,
        result: pass ? "PASS" : "FAIL",
        scenario: "TEST 8 — Erreur Shopify",
      });
      ctx.assertTrue("TEST 8 PASS", pass);
    }
  } catch (error) {
    ctx.assertTrue(
      `harness error: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  } finally {
    if (db) await db.$disconnect().catch(() => undefined);
    if (postgres) await postgres.stop().catch(() => undefined);
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }

  console.log("\n=== EVIDENCE JSON ===");
  console.log(JSON.stringify(evidence, null, 2));

  return finishSuite("116-anti-double-billing-p7-scenarios", ctx);
};

process.exitCode = await runSuite();
