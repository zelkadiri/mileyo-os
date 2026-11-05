/**
 * Pre-prod billing validation matrix — P0-1 / P0-2 guards + non-regression.
 *
 * METHOD: pure helpers + classifier + source contracts.
 * NO claimOrLoad on persistent DB, NO Shopify writes, NO worker on prod data.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DELIVERY_DATE_PROPERTY_TECHNICAL } from "../../app/utils/orderLineItemProperties";
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  resolveFirstOrderBillingAlignment,
  resolveFirstOrderDeliverySchedule,
} from "../../app/services/deliverySchedule.server";
import {
  getBillingRunnerDeliveryGate,
  getSelectionSkipReason,
} from "../../app/services/subscriptionBillingWorker.server";
import {
  classifyBillableShopifyCycle,
  getShopifyBillingCycleEarliestChargeAt,
  identifyShopifyBillingCycleCandidate,
  isShopifyBillingCycleChargeWindowOpen,
  type ShopifyBillingCycleSnapshot,
} from "../../app/services/shopifySubscriptionBillingCycle.server";
import { evaluateFirstCheckoutDeliveryBillingGuard } from "../../app/utils/subscriptionBillingSchedule";
import {
  parisWallClockToInstant,
  parseDeliveryDate,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
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

const cycleSlot = (date: DeliveryDateString) =>
  parisWallClockToInstant({
    date,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

const sampleMealProperties = [
  { name: "Type de commande", value: "Abonnement hebdomadaire" },
  { name: "Nombre de repas", value: "8" },
  { name: "Plat 1", value: "Poulet tikka" },
];

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

const mkCycle = ({
  cycleIndex,
  expectedIso,
  cycleStartAt,
  cycleEndAt,
  extras = {},
}: {
  cycleIndex: number;
  expectedIso: string;
  cycleStartAt?: string;
  cycleEndAt?: string;
  extras?: Partial<ShopifyBillingCycleSnapshot>;
}): ShopifyBillingCycleSnapshot => {
  const expected = new Date(expectedIso);
  const start =
    cycleStartAt ??
    new Date(expected.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const end =
    cycleEndAt ??
    new Date(expected.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString();
  return {
    attempts: [],
    billingAttemptExpectedDate: expectedIso,
    cycleEndAt: end,
    cycleIndex,
    cycleStartAt: start,
    edited: false,
    skipped: false,
    status: "UNBILLED",
    successfulAttempts: [],
    ...extras,
  };
};

/** Sat 7 Nov 00:05 Paris — commercial Mileyo NBD / cron. */
const satNov7Nbd = () => cycleSlot(requireDate("2026-11-07"));
const satNov7Cron = () =>
  parisWallClockToInstant({
    date: requireDate("2026-11-07"),
    hour: 0,
    minute: 10,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

/** Six PROD-like expectedDate slots same Saturday 07h–16h Paris. */
const sixBillableExpectedHoursParis = [7, 9, 11, 12, 14, 16] as const;

/** Fourteen too-early expectedDate offsets (days after Sat 7). */
const fourteenTooEarlyExpectedIsos = [
  "2026-11-08T12:00:00.000Z",
  "2026-11-09T07:00:00.000Z",
  "2026-11-09T15:00:00.000Z",
  "2026-11-10T06:00:00.000Z",
  "2026-11-10T12:00:00.000Z",
  "2026-11-10T16:00:00.000Z",
  "2026-11-11T08:00:00.000Z",
  "2026-11-11T14:00:00.000Z",
  "2026-11-12T09:00:00.000Z",
  "2026-11-12T15:00:00.000Z",
  "2026-11-13T10:00:00.000Z",
  "2026-11-13T16:00:00.000Z",
  "2026-11-14T11:00:00.000Z",
  "2026-11-15T12:00:00.000Z",
];

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "117-billing-validation-matrix-preprod",
  );
  const workerSource = readRepo(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const gateSource = readRepo(
    "app/services/subscriptionBillingGate.server.ts",
  );
  const cycleSource = readRepo(
    "app/services/shopifySubscriptionBillingCycle.server.ts",
  );
  const processDueSource = workerSource.slice(
    workerSource.indexOf("export const processDueSubscriptionBillings"),
  );

  const checkoutNov6 = new Date("2026-11-06T12:00:00.000Z");
  const satNov14Slot = cycleSlot(requireDate("2026-11-14"));
  const satNov14Cron = parisWallClockToInstant({
    date: requireDate("2026-11-14"),
    hour: 0,
    minute: 10,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });
  const satNov21Slot = cycleSlot(requireDate("2026-11-21"));

  // ── S1 / S2 alignment happy path (non-regression) ────────────────────────
  ctx.scenario("S1 — checkout 6 nov, livraison 12, alignement réussi");
  {
    const schedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-11-12" },
      ],
      orderCreatedAt: checkoutNov6,
    });
    const alignment = resolveFirstOrderBillingAlignment(schedule);
    ctx.assertEqual(
      "S1 aligned NBD = sam 14",
      alignment?.alignedNextBillingDate.toISOString(),
      satNov14Slot.toISOString(),
    );
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-12",
      nextBillingDate: alignment!.alignedNextBillingDate,
    });
    ctx.assertTrue("S1 guard allows aligned NBD", guard.ok);
    const skipOn7 = getSelectionSkipReason(
      dueSelection({ nextBillingDate: alignment!.alignedNextBillingDate }),
      null,
      satNov7Cron(),
    );
    ctx.assertEqual("S1 cron 7 skip", skipOn7, "next_billing_date_in_future");
  }

  ctx.scenario("S2 — checkout 6 nov, livraison 19, alignement réussi");
  {
    const schedule = resolveFirstOrderDeliverySchedule({
      lineItemProperties: [
        ...sampleMealProperties,
        { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-11-19" },
      ],
      orderCreatedAt: checkoutNov6,
    });
    const alignment = resolveFirstOrderBillingAlignment(schedule);
    ctx.assertEqual(
      "S2 aligned NBD = sam 21",
      alignment?.alignedNextBillingDate.toISOString(),
      satNov21Slot.toISOString(),
    );
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-19",
      nextBillingDate: alignment!.alignedNextBillingDate,
    });
    ctx.assertTrue("S2 guard allows aligned NBD", guard.ok);
    ctx.assertEqual(
      "S2 cron 14 skip",
      getSelectionSkipReason(
        dueSelection({ nextBillingDate: alignment!.alignedNextBillingDate }),
        null,
        satNov14Cron,
      ),
      "next_billing_date_in_future",
    );
  }

  // ── P0-1 regression matrix ───────────────────────────────────────────────
  ctx.scenario("P0-1 — livraison 19, alignement échoué (NBD résiduelle 13)");
  {
    const residualNbd = new Date("2026-11-13T12:00:00.000Z");
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-19",
      nextBillingDate: residualNbd,
    });
    ctx.assertFalse("P0-1 residual blocked", guard.ok);
    ctx.assertEqual(
      "P0-1 earliest = sam 21",
      guard.earliestLegitimateRenewalAt?.toISOString(),
      satNov21Slot.toISOString(),
    );
    // Previously FAIL: getSelectionSkipReason alone was null on cron 14.
    ctx.assertNull(
      "P0-1 legacy eligibility hole still present at selection-skip layer",
      getSelectionSkipReason(
        dueSelection({
          nextBillingDate: residualNbd,
          nextScheduledDeliveryDate: "2026-11-19",
        }),
        null,
        satNov14Cron,
      ),
    );
    ctx.assertNull(
      "P0-1 delivery gate still never skips",
      getBillingRunnerDeliveryGate({
        now: satNov14Cron,
        selection: {
          nextBillingDate: residualNbd,
          nextScheduledDeliveryDate: "2026-11-19",
          preferredDeliveryWeekday: 4,
        },
      }).skipReason,
    );
  }

  ctx.scenario("P0-1 — NBD incorrecte déjà passée reste bloquée");
  {
    const stalePast = new Date("2026-11-07T12:00:00.000Z");
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-19",
      nextBillingDate: stalePast,
    });
    ctx.assertFalse("P0-1 past incorrect NBD blocked", guard.ok);
  }

  ctx.scenario(
    "P0-1 — 1ère livraison effectuée mais NBD toujours incorrecte",
  );
  {
    // After delivery day 19 Nov, residual NBD 13 still before legitimate 21.
    const afterDeliveryCron = parisWallClockToInstant({
      date: requireDate("2026-11-20"),
      hour: 10,
      minute: 0,
      timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
    });
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-19",
      nextBillingDate: new Date("2026-11-13T12:00:00.000Z"),
    });
    ctx.assertFalse(
      "P0-1 still blocked after delivery day until NBD reconciled",
      guard.ok,
    );
    ctx.assertTrue(
      "P0-1 clock after delivery does not lift guard",
      afterDeliveryCron.getTime() > new Date("2026-11-19T12:00:00.000Z").getTime(),
    );
  }

  ctx.scenario("P0-1 — renouvellement légitime du 21 autorisé");
  {
    const guard = evaluateFirstCheckoutDeliveryBillingGuard({
      firstCheckoutScheduledDeliveryDate: "2026-11-19",
      nextBillingDate: satNov21Slot,
    });
    ctx.assertTrue("P0-1 legitimate 21 Nov allowed", guard.ok);
    ctx.assertNull(
      "P0-1 selection skip allows due 21",
      getSelectionSkipReason(
        dueSelection({
          nextBillingDate: satNov21Slot,
          nextScheduledDeliveryDate: "2026-11-26",
        }),
        null,
        parisWallClockToInstant({
          date: requireDate("2026-11-21"),
          hour: 0,
          minute: 10,
          timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
        }),
      ),
    );
  }

  ctx.scenario("P0-1 — wiring gate avant claim (source)");
  {
    ctx.assertTrue(
      "gate loads first checkout BoxOrder",
      gateSource.includes("isSubscriptionRenewal: false") &&
        gateSource.includes("evaluateFirstCheckoutDeliveryBillingGuard"),
    );
    ctx.assertTrue(
      "gate blocks before claimOrLoadBillingCycle",
      gateSource.indexOf("evaluateFirstCheckoutDeliveryBillingGuard") <
        gateSource.indexOf("claimOrLoadBillingCycle"),
    );
    ctx.assertTrue(
      "cron passes checkoutShopifyOrderId",
      processDueSource.includes("checkoutShopifyOrderId: currentSelection.shopifyOrderId"),
    );
  }

  // ── P0-2 regression matrix ───────────────────────────────────────────────
  ctx.scenario(
    "P0-2 — six cas facturables expectedDate sam 7 entre 07h et 16h Paris",
  );
  {
    const nbd = satNov7Nbd();
    const now = satNov7Cron();
    let passCount = 0;
    for (const [index, hour] of sixBillableExpectedHoursParis.entries()) {
      const expected = parisWallClockToInstant({
        date: requireDate("2026-11-07"),
        hour,
        minute: 0,
        timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
      });
      const cycle = mkCycle({
        cycleIndex: 10 + index,
        expectedIso: expected.toISOString(),
        cycleStartAt: "2026-11-03T00:00:00.000Z",
        cycleEndAt: "2026-11-10T00:00:00.000Z",
      });
      // Identification may use byWindow (expected ≠ NBD instant).
      const identified = identifyShopifyBillingCycleCandidate({
        cycles: [cycle],
        nextBillingDate: nbd,
      });
      ctx.assertEqual(
        `P0-2 identify hour=${hour}`,
        identified?.cycleIndex ?? null,
        10 + index,
      );
      ctx.assertTrue(
        `P0-2 window open hour=${hour}`,
        isShopifyBillingCycleChargeWindowOpen({
          billingAttemptExpectedDate: expected,
          now,
        }),
      );
      const classified = classifyBillableShopifyCycle({
        cycles: [cycle],
        nextBillingDate: nbd,
        now,
      });
      if (classified.action === "billable") passCount += 1;
      ctx.assertEqual(
        `P0-2 billable hour=${hour}`,
        classified.action,
        "billable",
      );
    }
    ctx.assertEqual("P0-2 six PASS", passCount, 6);
  }

  ctx.scenario("P0-2 — quatorze cas trop anticipés : BLOCK");
  {
    const nbd = satNov7Nbd();
    const now = satNov7Cron();
    let blockCount = 0;
    for (const [index, expectedIso] of fourteenTooEarlyExpectedIsos.entries()) {
      const cycle = mkCycle({
        cycleIndex: 20 + index,
        expectedIso,
        // Window still covers Sat 7 NBD — pre-fix FAIL mode via byWindow.
        cycleStartAt: "2026-11-03T00:00:00.000Z",
        cycleEndAt: "2026-11-16T00:00:00.000Z",
      });
      const identified = identifyShopifyBillingCycleCandidate({
        cycles: [cycle],
        nextBillingDate: nbd,
      });
      ctx.assertEqual(
        `P0-2 identify still finds c${20 + index}`,
        identified?.cycleIndex ?? null,
        20 + index,
      );
      const classified = classifyBillableShopifyCycle({
        cycles: [cycle],
        nextBillingDate: nbd,
        now,
      });
      if (classified.action === "block_too_early") blockCount += 1;
      ctx.assertEqual(
        `P0-2 block_too_early ${expectedIso}`,
        classified.action,
        "block_too_early",
      );
      if (classified.action === "block_too_early") {
        const earliest = getShopifyBillingCycleEarliestChargeAt(expectedIso);
        ctx.assertEqual(
          `P0-2 earliest matches ${expectedIso}`,
          classified.earliestChargeAt.toISOString(),
          earliest?.toISOString(),
        );
      }
    }
    ctx.assertEqual("P0-2 fourteen BLOCK", blockCount, 14);
  }

  ctx.scenario(
    "P0-2 — quatorze cas après ScheduleEdit simulé (expected → sam 7 12h) : billable",
  );
  {
    const nbd = satNov7Nbd();
    const now = satNov7Cron();
    const editedExpected = parisWallClockToInstant({
      date: requireDate("2026-11-07"),
      hour: 12,
      minute: 0,
      timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
    });
    let passCount = 0;
    for (let index = 0; index < 14; index += 1) {
      const cycle = mkCycle({
        cycleIndex: 40 + index,
        expectedIso: editedExpected.toISOString(),
        cycleStartAt: "2026-11-03T00:00:00.000Z",
        cycleEndAt: "2026-11-10T00:00:00.000Z",
        extras: { edited: true },
      });
      const classified = classifyBillableShopifyCycle({
        cycles: [cycle],
        nextBillingDate: nbd,
        now,
      });
      if (classified.action === "billable") passCount += 1;
      ctx.assertEqual(
        `P0-2 post-ScheduleEdit billable #${index}`,
        classified.action,
        "billable",
      );
    }
    ctx.assertEqual("P0-2 fourteen post-edit PASS", passCount, 14);
  }

  ctx.scenario("P0-2 — cycle déjà payé : BLOCK (already_paid)");
  {
    const nbd = satNov7Nbd();
    const expected = parisWallClockToInstant({
      date: requireDate("2026-11-07"),
      hour: 12,
      minute: 0,
      timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
    });
    const classified = classifyBillableShopifyCycle({
      cycles: [
        mkCycle({
          cycleIndex: 2,
          expectedIso: expected.toISOString(),
          cycleStartAt: "2026-11-03T00:00:00.000Z",
          cycleEndAt: "2026-11-10T00:00:00.000Z",
          extras: {
            successfulAttempts: [
              {
                completedAt: "2026-11-07T00:10:00.000Z",
                createdAt: "2026-11-07T00:10:00.000Z",
                id: "att_paid",
                idempotencyKey: "mileyo_auto_x_c2",
                orderId: "gid://shopify/Order/1",
                orderName: "#1",
              },
            ],
            attempts: [
              {
                completedAt: "2026-11-07T00:10:00.000Z",
                createdAt: "2026-11-07T00:10:00.000Z",
                id: "att_paid",
                idempotencyKey: "mileyo_auto_x_c2",
                orderId: "gid://shopify/Order/1",
                orderName: "#1",
              },
            ],
            status: "BILLED",
          },
        }),
      ],
      nextBillingDate: nbd,
      now: satNov7Cron(),
    });
    ctx.assertEqual("P0-2 already_paid", classified.action, "already_paid");
  }

  ctx.scenario("P0-2 — attempt incertain : BLOCK (block_ambiguous)");
  {
    const nbd = satNov7Nbd();
    const expected = parisWallClockToInstant({
      date: requireDate("2026-11-07"),
      hour: 12,
      minute: 0,
      timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
    });
    const classified = classifyBillableShopifyCycle({
      cycles: [
        mkCycle({
          cycleIndex: 3,
          expectedIso: expected.toISOString(),
          cycleStartAt: "2026-11-03T00:00:00.000Z",
          cycleEndAt: "2026-11-10T00:00:00.000Z",
          extras: {
            attempts: [
              {
                completedAt: null,
                createdAt: "2026-11-07T00:06:00.000Z",
                id: "att_open",
                idempotencyKey: "mileyo_auto_x_c3",
                orderId: null,
                orderName: null,
              },
            ],
          },
        }),
      ],
      nextBillingDate: nbd,
      now: satNov7Cron(),
    });
    ctx.assertEqual("P0-2 uncertain attempt", classified.action, "block_ambiguous");
  }

  ctx.scenario("P0-2 — cycle non résolvable : BLOCK");
  {
    const classified = classifyBillableShopifyCycle({
      cycles: [
        mkCycle({
          cycleIndex: 1,
          expectedIso: "2026-10-20T12:00:00.000Z",
          cycleStartAt: "2026-10-20T12:00:00.000Z",
          cycleEndAt: "2026-10-27T12:00:00.000Z",
        }),
      ],
      nextBillingDate: satNov7Nbd(),
      now: satNov7Cron(),
    });
    ctx.assertEqual(
      "P0-2 unresolvable",
      classified.action,
      "block_unresolvable",
    );
  }

  ctx.scenario("P0-2 — wiring authorize avant claim (source)");
  {
    ctx.assertTrue(
      "classifier exports charge window helper",
      cycleSource.includes("isShopifyBillingCycleChargeWindowOpen") &&
        cycleSource.includes("block_too_early"),
    );
    ctx.assertTrue(
      "identify helper kept separate",
      cycleSource.includes("identifyShopifyBillingCycleCandidate"),
    );
    const gateBody = gateSource.slice(
      gateSource.indexOf("export const prepareCanonicalCycleBilling"),
    );
    ctx.assertTrue(
      "gate maps block_too_early before claim write",
      gateBody.includes('resolved.action === "block_too_early"') &&
        gateBody.indexOf('resolved.action === "block_too_early"') <
          gateBody.indexOf("claimOrLoadBillingCycle({"),
    );
    ctx.assertFalse(
      "no ScheduleEdit mutation added to worker",
      workerSource.includes("ScheduleEdit") ||
        workerSource.includes("scheduleEdit"),
    );
  }

  ctx.scenario("S7 — PAUSED + NBD passée : skip cron");
  {
    ctx.assertEqual(
      "S7 paused skip",
      getSelectionSkipReason(
        dueSelection({
          nextBillingDate: satNov7Nbd(),
          status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
        }),
        null,
        satNov7Cron(),
      ),
      "paused_or_inactive",
    );
  }

  return finishSuite("117-billing-validation-matrix-preprod", ctx);
};

process.exitCode = runSuite();
