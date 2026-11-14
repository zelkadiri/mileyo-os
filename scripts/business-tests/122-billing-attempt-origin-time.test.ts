/**
 * Business regression — originTime must stay inside selected Shopify cycle.
 * Pure helper + source contracts. No Shopify charges, no PROD.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyBillableShopifyCycle,
  resolveSubscriptionBillingAttemptOriginTime,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepo = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const c7: ShopifyBillingCycleSnapshot = {
  cycleIndex: 7,
  cycleStartAt: "2026-11-09T23:00:01Z",
  cycleEndAt: "2026-11-14T01:00:00Z",
  billingAttemptExpectedDate: "2026-11-14T01:00:00Z",
  status: "UNBILLED",
  skipped: false,
  edited: false,
  attempts: [],
  successfulAttempts: [],
};

const openCycle: ShopifyBillingCycleSnapshot = {
  cycleIndex: 8,
  cycleStartAt: "2026-11-14T01:00:01Z",
  cycleEndAt: "2026-11-21T01:00:00Z",
  billingAttemptExpectedDate: "2026-11-21T01:00:00Z",
  status: "UNBILLED",
  skipped: false,
  edited: false,
  attempts: [],
  successfulAttempts: [],
};

const paidC7: ShopifyBillingCycleSnapshot = {
  ...c7,
  status: "BILLED",
  successfulAttempts: [
    {
      id: "gid://shopify/SubscriptionBillingAttempt/1",
      createdAt: "2026-11-14T01:00:30Z",
      completedAt: "2026-11-14T01:00:31Z",
      idempotencyKey: "mileyo_auto_sel_c7",
      orderId: "gid://shopify/Order/1",
      orderName: "#9999",
    },
  ],
  attempts: [
    {
      id: "gid://shopify/SubscriptionBillingAttempt/1",
      createdAt: "2026-11-14T01:00:30Z",
      completedAt: "2026-11-14T01:00:31Z",
      idempotencyKey: "mileyo_auto_sel_c7",
      orderId: "gid://shopify/Order/1",
      orderName: "#9999",
    },
  ],
};

const nbdC7 = new Date("2026-11-13T23:05:00.000Z");

const runSuite = () => {
  const ctx = createBusinessTestContext("122-billing-attempt-origin-time");
  const workerSource = readRepo("app/services/subscriptionBillingWorker.server.ts");
  const cycleSource = readRepo(
    "app/services/shopifySubscriptionBillingCycle.server.ts",
  );

  ctx.scenario("1. Source contracts — originTime wired on create");
  {
    ctx.assertTrue(
      "helper exported",
      cycleSource.includes("resolveSubscriptionBillingAttemptOriginTime"),
    );
    ctx.assertTrue(
      "createBillingAttempt accepts originTime",
      workerSource.includes("originTime?: string | null") &&
        workerSource.includes("subscriptionBillingAttemptInput.originTime"),
    );
    ctx.assertTrue(
      "trigger requires billingCycle bounds",
      workerSource.includes("missing_billing_cycle_bounds") &&
        workerSource.includes("billingCycle: prepared.cycle"),
    );
    ctx.assertTrue(
      "selector index still required",
      workerSource.includes("billingCycleSelector") &&
        workerSource.includes("index: shopifyCycleIndex"),
    );
  }

  ctx.scenario("2. Cycle normal encore ouvert — NBD/now inside window");
  {
    const now = new Date("2026-11-18T12:00:00.000Z");
    const origin = resolveSubscriptionBillingAttemptOriginTime({
      cycle: openCycle,
      dueBillingDate: new Date("2026-11-21T01:00:00.000Z"),
      now,
    });
    ctx.assertEqual(
      "uses expected/NBD inside open cycle",
      origin,
      "2026-11-21T01:00:00.000Z",
    );
    const start = new Date(openCycle.cycleStartAt).getTime();
    const end = new Date(openCycle.cycleEndAt).getTime();
    const ms = new Date(origin).getTime();
    ctx.assertTrue("origin inside open cycle", ms >= start && ms <= end);
  }

  ctx.scenario("3. c7 terminé depuis 29s — cron 02h incident");
  {
    const cronAt = new Date("2026-11-14T01:00:29.000Z");
    const origin = resolveSubscriptionBillingAttemptOriginTime({
      cycle: c7,
      dueBillingDate: nbdC7,
      now: cronAt,
    });
    ctx.assertEqual("prefers NBD inside c7", origin, nbdC7.toISOString());
    ctx.assertTrue(
      "cron now would be outside c7",
      cronAt.getTime() > new Date(c7.cycleEndAt).getTime(),
    );
    const ms = new Date(origin).getTime();
    ctx.assertTrue(
      "origin still inside c7",
      ms >= new Date(c7.cycleStartAt).getTime() &&
        ms <= new Date(c7.cycleEndAt).getTime(),
    );
  }

  ctx.scenario("4. c7 terminé depuis plusieurs heures");
  {
    const hoursLater = new Date("2026-11-14T10:00:00.000Z");
    const origin = resolveSubscriptionBillingAttemptOriginTime({
      cycle: c7,
      dueBillingDate: nbdC7,
      now: hoursLater,
    });
    ctx.assertEqual("still NBD", origin, nbdC7.toISOString());
  }

  ctx.scenario("5. originTime dans c7 + selector index 7");
  {
    const origin = resolveSubscriptionBillingAttemptOriginTime({
      cycle: c7,
      dueBillingDate: nbdC7,
      now: new Date("2026-11-14T01:00:29.000Z"),
    });
    ctx.assertEqual("cycleIndex remains 7", c7.cycleIndex, 7);
    ctx.assertTrue(
      "origin strictly for selected c7",
      new Date(origin).getTime() >= new Date(c7.cycleStartAt).getTime() &&
        new Date(origin).getTime() <= new Date(c7.cycleEndAt).getTime(),
    );
    ctx.assertTrue(
      "origin not in c8",
      new Date(origin).getTime() < new Date(openCycle.cycleStartAt).getTime(),
    );
  }

  ctx.scenario("6. Sans NBD — fallback expected puis clamp fin−1s");
  {
    const withExpected = resolveSubscriptionBillingAttemptOriginTime({
      cycle: c7,
      dueBillingDate: null,
      now: new Date("2026-11-14T01:00:29.000Z"),
    });
    // expected == cycleEndAt → still inside if inclusive
    ctx.assertEqual(
      "expected equals end accepted",
      withExpected,
      "2026-11-14T01:00:00.000Z",
    );

    const noExpectedInside = resolveSubscriptionBillingAttemptOriginTime({
      cycle: {
        ...c7,
        billingAttemptExpectedDate: "2026-11-21T01:00:00Z", // outside c7
      },
      dueBillingDate: null,
      now: new Date("2026-11-14T05:00:00.000Z"),
    });
    ctx.assertEqual(
      "clamp to end−1s when now/expected outside",
      noExpectedInside,
      "2026-11-14T00:59:59.000Z",
    );
  }

  ctx.scenario("7. c7 déjà payé — classifier already_paid (pas de create)");
  {
    const classified = classifyBillableShopifyCycle({
      cycles: [paidC7, openCycle],
      nextBillingDate: nbdC7,
      now: new Date("2026-11-14T10:00:00.000Z"),
    });
    ctx.assertEqual("already paid", classified.action, "already_paid");
    if (classified.action === "already_paid") {
      ctx.assertEqual("still points at c7", classified.shopifyCycleIndex, 7);
    }
  }

  ctx.scenario("8. classify after c7 end still billable on NBD (recovery)");
  {
    const classified = classifyBillableShopifyCycle({
      cycles: [c7, openCycle],
      nextBillingDate: nbdC7,
      now: new Date("2026-11-14T10:00:00.000Z"),
    });
    ctx.assertEqual(
      "late recovery still selects c7 not c8",
      classified.action,
      "billable",
    );
    if (classified.action === "billable") {
      ctx.assertEqual("index 7", classified.shopifyCycleIndex, 7);
    }
  }

  ctx.scenario("9. Double-billing / claim failed / recovery source contracts");
  {
    ctx.assertTrue(
      "failed claim can proceed again",
      readRepo("app/services/subscriptionBillingCycleClaim.server.ts").includes(
        "BILLING_CYCLE_CLAIM_STATUS.FAILED",
      ),
    );
    ctx.assertTrue(
      "recovery rotates idempotency after failed claim",
      readRepo("app/services/subscriptionPaymentRecovery.server.ts").includes(
        "rotateClaimIdempotencyKeyAfterConfirmedFailure",
      ) &&
        readRepo("app/services/subscriptionPaymentRecovery.server.ts").includes(
          "billingCycle: prepared.cycle",
        ),
    );
    ctx.assertTrue(
      "UNIQUE claim still guards concurrent create",
      readRepo("prisma/schema.prisma").includes(
        "@@unique([subscriptionMealSelectionId, billingCycleKey])",
      ),
    );
  }

  ctx.scenario("10. Livraison / prochain samedi — origin = NBD c7");
  {
    const origin = resolveSubscriptionBillingAttemptOriginTime({
      cycle: c7,
      dueBillingDate: nbdC7,
      now: new Date("2026-11-14T10:00:00.000Z"),
    });
    ctx.assertEqual(
      "fulfillment origin stays Sat 00:05 Paris (NBD)",
      origin,
      "2026-11-13T23:05:00.000Z",
    );
    // Next Saturday charge remains the following weekly NBD after success —
    // not shifted by late recovery timestamp.
    ctx.assertTrue(
      "NBD advance still policy-based in worker",
      workerSource.includes("resolveAutoBillingNextBillingDate") ||
        workerSource.includes("calculateNextBillingDateFromPolicy"),
    );
  }

  return finishSuite("122-billing-attempt-origin-time", ctx);
};

process.exitCode = runSuite();
