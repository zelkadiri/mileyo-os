/**
 * Business regression — portal resume cycle billing (13K-E2).
 *
 * Covers resolveResumeDeliverySchedule date calculation only.
 * Does not call Shopify writers, portal actions, recovery, or the worker.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
  resolveResumeDeliverySchedule,
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

const parisInstant = (
  date: DeliveryDateString,
  hour: number,
  minute: number,
) =>
  parisWallClockToInstant({
    date,
    hour,
    minute,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

const cycleSlot = (date: DeliveryDateString) =>
  parisInstant(
    date,
    DELIVERY_BILLING_READY_HOUR,
    DELIVERY_BILLING_READY_MINUTE,
  );

const utilsDir = join(dirname(fileURLToPath(import.meta.url)), "../../app/utils");
const resumeHelperSource = readFileSync(
  join(utilsDir, "deliveryDate.ts"),
  "utf8",
);
const writerSource = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../app/services/deliverySchedule.server.ts",
  ),
  "utf8",
);

const thursdaySelection = () => ({
  nextScheduledDeliveryDate: "2026-08-27" as string | null,
  preferredDeliveryWeekday: 4,
});

const runSuite = () => {
  const ctx = createBusinessTestContext("30-portal-resume-cycle-billing");
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));
  const saturdayAugust29 = cycleSlot(requireDate("2026-08-29"));
  const fridayAugust21 = parisInstant(requireDate("2026-08-21"), 10, 0);
  const mondayAugust24 = parisInstant(requireDate("2026-08-24"), 10, 0);

  ctx.scenario("schedule_only — samedi associé encore futur");
  ctx.given("livraison jeudi 27 août, reprise vendredi 21 août");
  const scheduleOnlyFuture = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: fridayAugust21,
    selection: thursdaySelection(),
  });
  ctx.when("on calcule le billing de reprise sans paiement");
  ctx.assertEqual(
    "schedule_only targets Thursday 27 Aug",
    scheduleOnlyFuture?.resumeTargetDeliveryDate,
    "2026-08-27",
  );
  ctx.assertEqual(
    "schedule_only writes Saturday 22 Aug 00:05 Paris",
    scheduleOnlyFuture?.alignedNextBillingDate.toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "schedule_only UTC is 2026-08-21T22:05:00.000Z (CEST)",
    scheduleOnlyFuture?.alignedNextBillingDate.toISOString(),
    "2026-08-21T22:05:00.000Z",
  );

  ctx.scenario("immediate_payment — samedi de la box suivante");
  ctx.given("paiement resume qui couvre la box du jeudi 27 août");
  const immediatePayment = resolveResumeDeliverySchedule({
    mode: "immediate_payment",
    now: fridayAugust21,
    selection: thursdaySelection(),
  });
  ctx.when("le paiement immédiat réussit");
  ctx.assertEqual(
    "immediate_payment covers Thursday 27 Aug",
    immediatePayment?.resumeTargetDeliveryDate,
    "2026-08-27",
  );
  ctx.assertEqual(
    "immediate_payment writes Saturday 29 Aug of the next box",
    immediatePayment?.alignedNextBillingDate.toISOString(),
    saturdayAugust29.toISOString(),
  );
  ctx.assertEqual(
    "immediate_payment UTC is 2026-08-28T22:05:00.000Z (CEST)",
    immediatePayment?.alignedNextBillingDate.toISOString(),
    "2026-08-28T22:05:00.000Z",
  );

  ctx.scenario("schedule_only lundi après samedi associé — pas de date passée");
  ctx.given("reprise lundi 24 août après le samedi 22 août 00:05");
  const scheduleOnlyAfterSaturday = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: mondayAugust24,
    selection: thursdaySelection(),
  });
  ctx.assertEqual(
    "Monday resume still targets Thursday 27 Aug before cutoff",
    scheduleOnlyAfterSaturday?.resumeTargetDeliveryDate,
    "2026-08-27",
  );
  ctx.assertEqual(
    "Monday resume does not write past Saturday 22 Aug",
    scheduleOnlyAfterSaturday?.alignedNextBillingDate.toISOString() ===
      saturdayAugust22.toISOString(),
    false,
  );
  ctx.assertEqual(
    "Monday resume writes next cycle Saturday 29 Aug",
    scheduleOnlyAfterSaturday?.alignedNextBillingDate.toISOString(),
    saturdayAugust29.toISOString(),
  );
  ctx.assertEqual(
    "written resume billing stays in the future",
    (scheduleOnlyAfterSaturday?.alignedNextBillingDate.getTime() ?? 0) >
      mondayAugust24.getTime(),
    true,
  );

  ctx.scenario("schedule_only conserve un samedi cycle futur déjà cohérent");
  ctx.given("nextBillingDate Shopify déjà samedi 29 août");
  const keptExisting = resolveResumeDeliverySchedule({
    existingNextBillingDate: saturdayAugust29,
    mode: "schedule_only",
    now: fridayAugust21,
    selection: thursdaySelection(),
  });
  ctx.assertEqual(
    "existing future next-cycle Saturday is kept",
    keptExisting?.alignedNextBillingDate.toISOString(),
    saturdayAugust29.toISOString(),
  );

  ctx.scenario("Writers Shopify inchangés");
  ctx.assertEqual(
    "resume helper does not call Shopify nextBillingDate writer",
    resumeHelperSource.includes("setSubscriptionContractNextBillingDate"),
    false,
  );
  ctx.assertEqual(
    "Shopify resume writer still exists in deliverySchedule",
    writerSource.includes("setSubscriptionContractNextBillingDate"),
    true,
  );

  return finishSuite("30-portal-resume-cycle-billing", ctx);
};

process.exitCode = runSuite();
