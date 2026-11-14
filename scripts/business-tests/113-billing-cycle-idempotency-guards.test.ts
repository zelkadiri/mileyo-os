/**
 * Business regression — P0 anti-double-billing (Shopify cycleIndex canonical).
 * Pure helpers + source contracts. No Shopify charges, no PROD.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DELIVERY_RESCHEDULE_REASON } from "../../app/constants/deliverySchedule";
import { BILLING_CYCLE_CLAIM_STATUS } from "../../app/constants/subscriptionBillingCycleClaim";
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  calculateNextBillingDateFromPolicy,
  getSelectionSkipReason,
  hasUsableDeliveryBillingContext,
  isSuccessfulBillingAwaitingNextBillingAdvance,
  resolveAutoBillingNextBillingDate,
} from "../../app/services/subscriptionBillingWorker.server";
import {
  buildAutoBillingIdempotencyKeyFromShopifyCycle,
  buildBillingCycleKeyFromShopifyCycle,
  extractShopifyCycleIndexFromBillingKey,
} from "../../app/utils/subscriptionBillingCycleKeys";
import { isSubscriptionBillingIncidentHeld } from "../../app/constants/subscriptionBillingIncidentHold";
import {
  buildHossamHistoricalReconcileDryRun,
  listAttemptAuditRefsForCycle,
} from "../../app/services/subscriptionBillingHistoryReconcile.server";
import {
  classifyBillableShopifyCycle,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import {
  parisWallClockToInstant,
  parseDeliveryDate,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepo = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const requireDate = (value: string): DeliveryDateString => {
  const parsed = parseDeliveryDate(value);
  if (!parsed) throw new Error(`Invalid date ${value}`);
  return parsed;
};

const dueSelection = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextBillingDate: new Date(Date.now() - 60_000),
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

const runSuite = () => {
  const ctx = createBusinessTestContext("113-billing-cycle-idempotency-guards");
  const workerSource = readRepo(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const claimSource = readRepo(
    "app/services/subscriptionBillingCycleClaim.server.ts",
  );
  const gateSource = readRepo(
    "app/services/subscriptionBillingGate.server.ts",
  );
  const cycleSource = readRepo(
    "app/services/shopifySubscriptionBillingCycle.server.ts",
  );
  const claimConstSource = readRepo(
    "app/constants/subscriptionBillingCycleClaim.ts",
  );
  const orchestratorSource = readRepo(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const webhookSource = readRepo(
    "app/services/subscriptionBillingAttemptWebhook.server.ts",
  );
  const portalSource = readRepo(
    "app/features/portal/portal-actions.server.ts",
  );
  const schemaSource = readRepo("prisma/schema.prisma");
  const migrationSource = readRepo(
    "prisma/migrations/20261103180000_add_subscription_billing_cycle_claim/migration.sql",
  );
  const prepDataSource = readRepo(
    "app/features/preparation/preparation-data.server.ts",
  );
  const prepRenderSource = readRepo(
    "app/features/preparation/preparation-render.tsx",
  );
  const adminSource = readRepo(
    "app/features/subscriptions/subscriptions-actions.server.ts",
  );
  const recoverySource = readRepo(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );

  ctx.scenario("A. Calendar sanity");
  {
    const thursday = requireDate("2026-11-12");
    ctx.assertEqual(
      "2026-11-12 is Thursday",
      new Date(`${thursday}T12:00:00+01:00`).getUTCDay(),
      4,
    );
    const satSlot = parisWallClockToInstant({
      date: requireDate("2026-11-07"),
      hour: DELIVERY_BILLING_READY_HOUR,
      minute: DELIVERY_BILLING_READY_MINUTE,
      timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
    });
    ctx.assertEqual(
      "Sat 7 Nov 00:05 Paris",
      satSlot.toISOString(),
      "2026-11-06T23:05:00.000Z",
    );
  }

  ctx.scenario("1. Canonical identity = selection + Shopify cycleIndex");
  {
    const key = buildBillingCycleKeyFromShopifyCycle("sel_1", 2);
    const auto = buildAutoBillingIdempotencyKeyFromShopifyCycle("sel_1", 2);
    ctx.assertEqual("cycle key", key, "mileyo_cycle_sel_1_c2");
    ctx.assertEqual("auto key", auto, "mileyo_auto_sel_1_c2");
    ctx.assertEqual(
      "extract index",
      extractShopifyCycleIndexFromBillingKey(key),
      2,
    );
    ctx.assertFalse(
      "must not use getTodayIsoDate",
      workerSource.includes("getTodayIsoDate"),
    );
    ctx.assertTrue(
      "create passes billingCycleSelector.index",
      workerSource.includes("billingCycleSelector") &&
        workerSource.includes("index: shopifyCycleIndex"),
    );
    ctx.assertTrue(
      "create passes originTime inside selected cycle",
      workerSource.includes("subscriptionBillingAttemptInput.originTime") &&
        workerSource.includes("resolveSubscriptionBillingAttemptOriginTime"),
    );
    ctx.assertTrue(
      "missing cycleIndex fail-closed on trigger",
      workerSource.includes("missing_shopify_cycle_index"),
    );
  }

  ctx.scenario("2. Shared gate + UNIQUE claim");
  {
    ctx.assertTrue(
      "schema SubscriptionBillingCycleClaim",
      schemaSource.includes("model SubscriptionBillingCycleClaim"),
    );
    ctx.assertTrue(
      "unique selection+cycle",
      schemaSource.includes(
        "@@unique([subscriptionMealSelectionId, billingCycleKey])",
      ),
    );
    ctx.assertTrue(
      "migration unique index",
      migrationSource.includes(
        "SubscriptionBillingCycleClaim_subscriptionMealSelectionId_billingCycleKey_key",
      ),
    );
    ctx.assertTrue(
      "prepareCanonicalCycleBilling shared",
      gateSource.includes("prepareCanonicalCycleBilling") &&
        workerSource.includes("prepareCanonicalCycleBilling") &&
        adminSource.includes("prepareCanonicalCycleBilling") &&
        recoverySource.includes("prepareCanonicalCycleBilling") &&
        portalSource.includes("prepareCanonicalCycleBilling"),
    );
    ctx.assertTrue(
      "P0-1 first-checkout guard before claim",
      gateSource.includes("evaluateFirstCheckoutDeliveryBillingGuard") &&
        gateSource.includes("checkoutShopifyOrderId"),
    );
    ctx.assertTrue(
      "P0-2 charge window before claim",
      cycleSource.includes("block_too_early") &&
        gateSource.includes("shopify_charge_window_closed"),
    );
    ctx.assertTrue(
      "resolveBillableShopifyCycle",
      cycleSource.includes("resolveBillableShopifyCycle"),
    );
    ctx.assertEqual(
      "uncertain constant",
      BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
      "uncertain",
    );
  }

  ctx.scenario("3. Crash → uncertain");
  {
    ctx.assertTrue(
      "shopifyCreateStarted",
      workerSource.includes("shopifyCreateStarted = true"),
    );
    ctx.assertTrue(
      "uncertain mark",
      workerSource.includes("markBillingCycleClaimUncertain"),
    );
    ctx.assertTrue(
      "block_uncertain",
      claimSource.includes("block_uncertain"),
    );
  }

  ctx.scenario("4. Paid unadvanced + incident hold + healthy prior success");
  {
    const now = new Date("2026-12-01T12:00:00.000Z");
    const stuck = dueSelection({
      lastBillingAttemptAt: new Date("2026-11-03T00:00:30.000Z"),
      lastBillingAttemptStatus: "success",
      nextBillingDate: new Date("2026-10-30T16:00:00.000Z"),
    });
    ctx.assertEqual(
      "stuck: success at/after still-due NBD",
      getSelectionSkipReason(stuck, null, now),
      "cycle_already_paid_unadvanced",
    );
    ctx.assertTrue(
      "helper stuck",
      isSuccessfulBillingAwaitingNextBillingAdvance(stuck, now),
    );

    // Prior-cycle success (Aug) then NBD advanced to Nov — must NOT block.
    const healthy = dueSelection({
      lastBillingAttemptAt: new Date("2026-08-18T11:49:36.000Z"),
      lastBillingAttemptStatus: "success",
      nextBillingDate: new Date("2026-11-06T23:05:00.000Z"),
    });
    const satNow = new Date("2026-11-07T00:10:00.000Z");
    ctx.assertNull(
      "healthy prior success allows new due cycle",
      getSelectionSkipReason(healthy, null, satNow),
    );
    ctx.assertFalse(
      "helper allows advanced NBD",
      isSuccessfulBillingAwaitingNextBillingAdvance(healthy, satNow),
    );

    // Early payment same due slot without NBD advance: local helper may miss
    // (lastAt < NBD); charge-time cycle/claim guards remain mandatory.
    const earlyPayStuck = dueSelection({
      lastBillingAttemptAt: new Date("2026-11-06T20:00:00.000Z"),
      lastBillingAttemptStatus: "success",
      nextBillingDate: new Date("2026-11-06T23:05:00.000Z"),
    });
    ctx.assertFalse(
      "early-pay stuck not caught by lastAt>=NBD alone",
      isSuccessfulBillingAwaitingNextBillingAdvance(earlyPayStuck, satNow),
    );

    // Hossam cleared from HOLD (A3 + calendar sync). Gate must stay wired for
    // any future id re-added to SUBSCRIPTION_BILLING_INCIDENT_HOLD_CONTRACT_IDS.
    ctx.assertFalse(
      "Hossam cleared from HOLD",
      isSubscriptionBillingIncidentHeld("26652508488"),
    );
    ctx.assertFalse(
      "Hossam gid form also cleared",
      isSubscriptionBillingIncidentHeld(
        "gid://shopify/SubscriptionContract/26652508488",
      ),
    );
    ctx.assertTrue(
      "hold skip reason still implemented",
      workerSource.includes("incident_billing_hold") &&
        workerSource.includes("isSubscriptionBillingIncidentHeld"),
    );
  }

  ctx.scenario("5. Capacity + delivery");
  {
    ctx.assertEqual(
      "missing delivery",
      getSelectionSkipReason(
        dueSelection({
          nextScheduledDeliveryDate: null,
          preferredDeliveryWeekday: null,
        }),
      ),
      "missing_delivery_context",
    );
    ctx.assertTrue(
      "capacity reason",
      DELIVERY_RESCHEDULE_REASON.CAPACITY_FULL_NEEDS_RESOLUTION ===
        "capacity_full_needs_resolution",
    );
    ctx.assertFalse(
      "no wipe schedule",
      orchestratorSource.includes("firstOrderDeliverySchedule = null"),
    );
    ctx.assertTrue(
      "prep banner",
      prepDataSource.includes("countPaidBoxOrdersMissingScheduledDelivery") &&
        prepRenderSource.includes("paidOrdersMissingDeliveryCount"),
    );
  }

  ctx.scenario("6. Portal resume uses canonical claim — not random Shopify key alone");
  {
    ctx.assertTrue(
      "resume calls prepareCanonicalCycleBilling",
      portalSource.includes("prepareCanonicalCycleBilling"),
    );
    ctx.assertTrue(
      "resume passes shopifyCycleIndex to trigger",
      portalSource.includes("shopifyCycleIndex: prepared.shopifyCycleIndex"),
    );
    ctx.assertTrue(
      "RESUME claim source",
      claimConstSource.includes("RESUME: \"resume\""),
    );
  }

  ctx.scenario("7. Hossam dry-run → cycleIndex 2 only");
  {
    const plan = buildHossamHistoricalReconcileDryRun();
    ctx.assertEqual("one first success", plan.summary.firstSuccesses, 1);
    ctx.assertEqual("four duplicates", plan.summary.duplicateSuccesses, 4);
    ctx.assertEqual(
      "proposed claims",
      plan.summary.proposedSucceededClaims,
      1,
    );
    ctx.assertEqual(
      "collision on c2",
      plan.collisions[0]?.shopifyCycleIndex,
      2,
    );
    ctx.assertEqual(
      "claim key c2",
      plan.rows.find((r) => r.proposedClaimStatus === "succeeded")
        ?.billingCycleKey,
      "mileyo_cycle_cmvl524nv0001jw08yu7toq1g_c2",
    );
    ctx.assertFalse(
      "never 2026-10-24 identity",
      plan.rows.some((r) => r.billingCycleKey?.includes("2026-10-24")),
    );
    ctx.assertEqual(
      "five attempt audit refs",
      listAttemptAuditRefsForCycle(plan, 2).length,
      5,
    );
    ctx.assertTrue(
      "cycle 1 warning",
      plan.anomalies.some((a) => a.includes("UNBILLED")),
    );
  }

  ctx.scenario("8. Normal weekly eligible + cycle classifier");
  {
    ctx.assertNull(
      "eligible",
      getSelectionSkipReason(dueSelection()),
    );

    const paid = (orderName: string) => [
      {
        completedAt: "2026-10-01T00:00:00Z",
        createdAt: "2026-10-01T00:00:00Z",
        id: `att_${orderName}`,
        idempotencyKey: null,
        orderId: `gid://shopify/Order/${orderName}`,
        orderName,
      },
    ];
    const empty: ShopifyBillingCycleSnapshot["attempts"] = [];
    const mk = (
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

    const now = new Date("2026-11-06T17:00:00.000Z");
    const healthy = classifyBillableShopifyCycle({
      cycles: [
        mk(1, "2026-10-30T16:00:00.000Z", paid("#1001"), "BILLED"),
        mk(2, "2026-11-06T16:00:00.000Z", empty, "UNBILLED"),
      ],
      nextBillingDate: new Date("2026-11-06T16:00:00.000Z"),
      now,
    });
    ctx.assertEqual(
      "healthy renewal: prior BILLED + due UNBILLED → billable",
      healthy.action,
      "billable",
    );
    if (healthy.action === "billable") {
      ctx.assertEqual("targets cycle 2", healthy.shopifyCycleIndex, 2);
    }

    const hossam = classifyBillableShopifyCycle({
      cycles: [
        mk(1, "2026-10-30T16:00:00.000Z", empty, "UNBILLED"),
        mk(2, "2026-11-06T16:00:00.000Z", paid("#1216").concat(paid("#1219")), "BILLED"),
      ],
      nextBillingDate: new Date("2026-10-30T16:00:00.000Z"),
      now,
    });
    ctx.assertEqual(
      "Hossam stuck: unpaid c1 + paid later c2 → ambiguous",
      hossam.action,
      "block_ambiguous",
    );

    const already = classifyBillableShopifyCycle({
      cycles: [mk(2, "2026-11-06T16:00:00.000Z", paid("#2000"), "BILLED")],
      nextBillingDate: new Date("2026-11-06T16:00:00.000Z"),
      now,
    });
    ctx.assertEqual("already paid cycle", already.action, "already_paid");

    const skipped = classifyBillableShopifyCycle({
      cycles: [
        mk(1, "2026-10-23T16:00:00.000Z", paid("#1"), "BILLED"),
        {
          ...mk(2, "2026-10-30T16:00:00.000Z", empty, "UNBILLED"),
          skipped: true,
        },
        mk(3, "2026-11-06T16:00:00.000Z", empty, "UNBILLED"),
      ],
      nextBillingDate: new Date("2026-11-06T16:00:00.000Z"),
      now,
    });
    ctx.assertEqual(
      "skipped prior empty cycle still billable on due cycle",
      skipped.action,
      "billable",
    );
  }

  ctx.scenario("9. Webhook claim reconcile + NBD policy");
  {
    const due = new Date("2026-10-30T16:00:00.000Z");
    const paymentAt = new Date("2026-10-30T16:00:30.000Z");
    const weekly = resolveAutoBillingNextBillingDate({
      billingPolicy: { interval: "WEEK", intervalCount: 1 },
      dueBillingDate: due,
      paymentAt,
    });
    ctx.assertEqual(
      "WEEK/1",
      weekly.toISOString(),
      calculateNextBillingDateFromPolicy(due, {
        interval: "WEEK",
        intervalCount: 1,
      }).toISOString(),
    );
    ctx.assertTrue(
      "webhook claim reconcile",
      webhookSource.includes("reconcileBillingCycleClaimOnWebhookSuccess"),
    );
    ctx.assertTrue(
      "stuck NBD repair gated",
      workerSource.includes("ENABLE_STUCK_NBD_AUTO_REPAIR"),
    );
  }

  return finishSuite("113-billing-cycle-idempotency-guards", ctx);
};

process.exitCode = runSuite();
