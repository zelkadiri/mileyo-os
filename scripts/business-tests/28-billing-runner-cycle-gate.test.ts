/**
 * Business regression — billing runner cycle gate (13K-C2).
 *
 * nextBillingDate is the source of truth. Delivery J-2 no longer skips
 * or realigns Saturday dates. Does not exercise recovery, resume, or Shopify.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  getBillingRunnerDeliveryGate,
  getSelectionSkipReason,
} from "../../app/services/subscriptionBillingWorker.server";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
  shouldRealignLegacyNextBillingDate,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }

  return parsed;
};

const cycleSlot = (date: DeliveryDateString) =>
  parisWallClockToInstant({
    date,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

const dueSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  resumeAttemptKey: null as string | null,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStartedAt: null as Date | null,
  resumeAttemptStatus: null as string | null,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const workerSource = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../app/services/subscriptionBillingWorker.server.ts",
  ),
  "utf8",
);

const processDueSource = workerSource.slice(
  workerSource.indexOf("export const processDueSubscriptionBillings"),
);

const runSuite = () => {
  const ctx = createBusinessTestContext("28-billing-runner-cycle-gate");
  const saturdayAugust15 = cycleSlot(requireDate("2026-08-15"));
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));
  const tuesdayAugust18J2 = cycleSlot(requireDate("2026-08-18"));
  const saturdayAugust15AfterSlot = parisWallClockToInstant({
    date: requireDate("2026-08-15"),
    hour: 0,
    minute: 10,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

  ctx.scenario("Samedi dû + livraison jeudi suivante — billing autorisé");
  ctx.given("nextBillingDate samedi 15 août passé, livraison jeudi 20 août");
  const dueSaturdayGate = getBillingRunnerDeliveryGate({
    now: saturdayAugust15AfterSlot,
    selection: {
      nextBillingDate: saturdayAugust15,
      nextScheduledDeliveryDate: "2026-08-20",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.when("le cron tourne samedi 15 août 00h10 Paris");
  ctx.assertNull(
    "due Saturday is not skipped by delivery J-2",
    dueSaturdayGate.skipReason,
  );
  ctx.assertEqual(
    "due Saturday is not marked for J-2 realign",
    dueSaturdayGate.shouldRealignLegacyBillingDate,
    false,
  );
  ctx.assertEqual(
    "delivery context still projects Thursday 20 Aug",
    dueSaturdayGate.readiness.projectedActiveDeliveryDate,
    "2026-08-20",
  );
  ctx.assertEqual(
    "delivery J-2 context remains not ready on Saturday",
    dueSaturdayGate.readiness.isReady,
    false,
  );
  ctx.assertEqual(
    "getSelectionSkipReason allows due Saturday on an active contract",
    getSelectionSkipReason({
      ...dueSelection(),
      nextBillingDate: new Date(Date.now() - 60_000),
    }),
    null,
  );

  ctx.scenario("Samedi futur — skip next_billing_date_in_future");
  ctx.given("nextBillingDate samedi 22 août, maintenant avant ce samedi");
  ctx.assertEqual(
    "future Saturday is skipped as next_billing_date_in_future",
    getSelectionSkipReason({
      ...dueSelection(),
      nextBillingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
    "next_billing_date_in_future",
  );
  const futureSaturdayGate = getBillingRunnerDeliveryGate({
    now: saturdayAugust15AfterSlot,
    selection: {
      nextBillingDate: saturdayAugust22,
      nextScheduledDeliveryDate: "2026-08-20",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertNull(
    "delivery gate does not skip a future Saturday on J-2 grounds",
    futureSaturdayGate.skipReason,
  );

  ctx.scenario("Samedi vs delivery J-2 mardi — aucun realign");
  ctx.given("nextBillingDate samedi 15, billingReadyAt mardi 18 août");
  ctx.assertEqual(
    "Saturday is earlier than Tuesday J-2",
    saturdayAugust15.getTime() < tuesdayAugust18J2.getTime(),
    true,
  );
  ctx.assertEqual(
    "gate does not realign Saturday toward Tuesday J-2",
    dueSaturdayGate.shouldRealignLegacyBillingDate,
    false,
  );
  ctx.assertEqual(
    "gate skipReason stays null despite Saturday < J-2",
    dueSaturdayGate.skipReason,
    null,
  );

  ctx.scenario("Helper legacy isolé — existe mais n'est plus appelé");
  ctx.given("l'ancien helper J-2 reste disponible hors chemin actif");
  ctx.assertEqual(
    "legacy helper still flags Saturday as too early vs J-2",
    shouldRealignLegacyNextBillingDate({
      billingReadyAt: tuesdayAugust18J2,
      nextBillingDate: saturdayAugust15,
    }),
    true,
  );
  ctx.assertTrue(
    "legacy realign helper still exists in the worker",
    workerSource.includes("realignLegacyNextBillingDateFromDeliverySchedule"),
  );
  ctx.assertEqual(
    "processDue no longer calls legacy realign",
    processDueSource.includes("realignLegacyNextBillingDateFromDeliverySchedule"),
    false,
  );

  return finishSuite("28-billing-runner-cycle-gate", ctx);
};

process.exitCode = runSuite();
