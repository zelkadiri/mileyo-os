/**
 * P0 integration — isolated PostgreSQL + mocked Shopify cycleIndex billing.
 */
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";

import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { BILLING_CYCLE_CLAIM_STATUS } from "../../app/constants/subscriptionBillingCycleClaim";
import {
  buildAutoBillingIdempotencyKeyFromShopifyCycle,
  buildBillingCycleKeyFromShopifyCycle,
} from "../../app/utils/subscriptionBillingCycleKeys";
import {
  buildHossamHistoricalReconcileDryRun,
  buildSucceededClaimInsertsFromPlan,
} from "../../app/services/subscriptionBillingHistoryReconcile.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const DDL_STATEMENTS = [
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

  return {
    createCalls: () => createCalls,
    createBillingAttempt: async (
      idempotencyKey: string,
      cycleIndex: number,
    ) => {
      createCalls += 1;
      const existing = attemptsByKey.get(idempotencyKey);
      if (existing) return existing;
      const created = {
        cycleIndex,
        id: `gid://shopify/SubscriptionBillingAttempt/${createCalls}`,
        orderId: `gid://shopify/Order/${1000 + createCalls}`,
        status: "success",
      };
      attemptsByKey.set(idempotencyKey, created);
      return created;
    },
    seedFailure: (idempotencyKey: string, cycleIndex: number) => {
      attemptsByKey.set(idempotencyKey, {
        cycleIndex,
        id: "gid://shopify/SubscriptionBillingAttempt/fail",
        orderId: null,
        status: "failure",
      });
    },
  };
};

const claimOrLoad = async (
  db: PrismaClient,
  {
    selectionId,
    shop,
    shopifyCycleIndex,
  }: { selectionId: string; shop: string; shopifyCycleIndex: number },
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
      "26652508488",
      billingCycleKey,
      idempotencyKey,
      BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
      "cron",
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

const runSuite = async () => {
  const ctx = createBusinessTestContext("114-billing-cycle-claim-pg-integration");
  let postgres: InstanceType<typeof EmbeddedPostgres> | null = null;
  let db: PrismaClient | null = null;
  let databaseDir = "";

  try {
    const port = await getFreePort();
    databaseDir = `/tmp/mileyo-billing-claim-pg-${port}`;
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
    await postgres.createDatabase("billing_claim_test");

    db = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://postgres:postgres@127.0.0.1:${port}/billing_claim_test`,
        },
      },
    });
    for (const statement of DDL_STATEMENTS) {
      await db.$executeRawUnsafe(statement);
    }

    const selectionId = "cmvl524nv0001jw08yu7toq1g";
    const shop = "integration-test.myshopify.com";
    await db.$executeRawUnsafe(
      `INSERT INTO "SubscriptionMealSelection" ("id") VALUES ($1)`,
      selectionId,
    );

    const shopify = createMockShopify();
    const cycleIndex = 2;

    ctx.scenario("1. UNIQUE concurrent claim on cycleIndex 2");
    {
      const results = await Promise.all([
        claimOrLoad(db, { selectionId, shop, shopifyCycleIndex: cycleIndex }),
        claimOrLoad(db, { selectionId, shop, shopifyCycleIndex: cycleIndex }),
        claimOrLoad(db, { selectionId, shop, shopifyCycleIndex: cycleIndex }),
      ]);
      const fresh = results.filter((r) => r.action === "proceed" && r.isNew);
      ctx.assertEqual("one fresh insert", fresh.length, 1);
      const count = await db.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM "SubscriptionBillingCycleClaim"`,
      );
      ctx.assertEqual("single row", Number(count[0]?.c ?? 0), 1);
    }

    ctx.scenario("2. Five attempts same cycleIndex — one claim succeeded");
    {
      const claim = (
        await db.$queryRawUnsafe<ClaimRow[]>(
          `SELECT "id","billingCycleKey","idempotencyKey","status" FROM "SubscriptionBillingCycleClaim" LIMIT 1`,
        )
      )[0]!;
      const first = await shopify.createBillingAttempt(
        claim.idempotencyKey,
        cycleIndex,
      );
      // Simulate four more Shopify successes with legacy day keys — same cycle.
      for (let i = 0; i < 4; i += 1) {
        await shopify.createBillingAttempt(
          `mileyo_auto_${selectionId}_2026-11-0${i}`,
          cycleIndex,
        );
      }
      await db.$executeRawUnsafe(
        `UPDATE "SubscriptionBillingCycleClaim"
         SET "status"=$1, "billingAttemptId"=$2, "shopifyOrderId"=$3, "succeededAt"=NOW()
         WHERE "id"=$4`,
        BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
        first.id,
        first.orderId,
        claim.id,
      );
      const blocked = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: cycleIndex,
      });
      ctx.assertEqual("blocks recharge", blocked.action, "block_succeeded");
      ctx.assertEqual(
        "Shopify create calls include duplicates under other keys",
        shopify.createCalls() >= 5,
        true,
      );
    }

    ctx.scenario("3. NBD tweak does not change cycleIndex identity");
    {
      const keyA = buildBillingCycleKeyFromShopifyCycle(selectionId, 2);
      const keyB = buildBillingCycleKeyFromShopifyCycle(selectionId, 2);
      ctx.assertEqual("same index same key", keyA, keyB);
      ctx.assertFalse(
        "different index different key",
        keyA === buildBillingCycleKeyFromShopifyCycle(selectionId, 3),
      );
    }

    ctx.scenario("4. Crash → uncertain → no second cycle charge");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      const reserved = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 3,
      });
      const paid = await shopify.createBillingAttempt(
        reserved.claim.idempotencyKey,
        3,
      );
      await db.$executeRawUnsafe(
        `UPDATE "SubscriptionBillingCycleClaim"
         SET "status"=$1, "billingAttemptId"=$2, "lastErrorMessage"=$3 WHERE "id"=$4`,
        BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
        paid.id,
        "crash",
        reserved.claim.id,
      );
      const after = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 3,
      });
      ctx.assertEqual("uncertain blocks", after.action, "block_uncertain");
    }

    ctx.scenario("5. History import Hossam cycle 2");
    {
      const plan = buildHossamHistoricalReconcileDryRun();
      ctx.assertEqual("first success 1", plan.summary.firstSuccesses, 1);
      ctx.assertEqual("duplicates 4", plan.summary.duplicateSuccesses, 4);
      const inserts = buildSucceededClaimInsertsFromPlan({ plan, shop });
      ctx.assertEqual("one insert", inserts.length, 1);
      ctx.assertEqual(
        "key c2",
        inserts[0]?.billingCycleKey,
        `mileyo_cycle_${selectionId}_c2`,
      );
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      const row = inserts[0]!;
      await db.$executeRawUnsafe(
        `INSERT INTO "SubscriptionBillingCycleClaim"
          ("id","shop","subscriptionMealSelectionId","subscriptionContractId","billingCycleKey","idempotencyKey","status","source","shopifyOrderId","succeededAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
        "hist_1",
        row.shop,
        row.subscriptionMealSelectionId,
        row.subscriptionContractId,
        row.billingCycleKey,
        row.idempotencyKey,
        row.status,
        row.source,
        row.shopifyOrderId,
      );
      const blocked = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 2,
      });
      ctx.assertEqual("history blocks", blocked.action, "block_succeeded");
    }

    ctx.scenario("6. Resume+cron concurrent — one proceed");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      const [a, b] = await Promise.all([
        claimOrLoad(db, { selectionId, shop, shopifyCycleIndex: 4 }),
        claimOrLoad(db, { selectionId, shop, shopifyCycleIndex: 4 }),
      ]);
      const proceeds = [a, b].filter((r) => r.action === "proceed" && r.isNew);
      ctx.assertEqual("single winner", proceeds.length, 1);
    }

    ctx.scenario("7. Recovery after failure rotates under same cycle key");
    {
      await db.$executeRawUnsafe(`DELETE FROM "SubscriptionBillingCycleClaim"`);
      const reserved = await claimOrLoad(db, {
        selectionId,
        shop,
        shopifyCycleIndex: 5,
      });
      shopify.seedFailure(reserved.claim.idempotencyKey, 5);
      const recoveryKey = `mileyo_recovery_${selectionId}_${reserved.claim.billingCycleKey}_a2`;
      await db.$executeRawUnsafe(
        `UPDATE "SubscriptionBillingCycleClaim"
         SET "status"=$1, "idempotencyKey"=$2, "source"=$3 WHERE "id"=$4`,
        BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
        recoveryKey,
        "recovery",
        reserved.claim.id,
      );
      const recovered = await shopify.createBillingAttempt(recoveryKey, 5);
      ctx.assertTrue("recovery paid", Boolean(recovered.orderId));
    }

    ctx.scenario("8. Dual-version keys (legacy day vs cN)");
    {
      const legacy = `mileyo_auto_${selectionId}_2026-10-30`;
      const modern = buildAutoBillingIdempotencyKeyFromShopifyCycle(
        selectionId,
        2,
      );
      ctx.assertFalse("keys differ", legacy === modern);
      ctx.assertEqual("modern", modern, `mileyo_auto_${selectionId}_c2`);
    }
  } catch (error) {
    ctx.assertTrue(
      `integration harness error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false,
    );
  } finally {
    if (db) await db.$disconnect().catch(() => undefined);
    if (postgres) await postgres.stop().catch(() => undefined);
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  }

  return finishSuite("114-billing-cycle-claim-pg-integration", ctx);
};

process.exitCode = await runSuite();
