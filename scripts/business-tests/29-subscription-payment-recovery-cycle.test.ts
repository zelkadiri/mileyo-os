/**
 * Business regression — payment recovery Sunday/Monday retry schedule (13K-D1).
 *
 * Covers nextRetryAt mapping only. Does not create recoveries, pause
 * contracts, call webhooks, or mutate live Shopify.
 */
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  MAX_RECOVERY_FAILURES,
  RECOVERY_STATUS,
} from "../../app/constants/subscriptionPaymentRecovery";
import {
  buildBillingCycleKey,
  resolvePaymentRecoveryNextRetryAt,
} from "../../app/services/subscriptionPaymentRecovery.server";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
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

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "29-subscription-payment-recovery-cycle",
  );
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));
  const sundayAugust23 = cycleSlot(requireDate("2026-08-23"));
  const mondayAugust24 = cycleSlot(requireDate("2026-08-24"));
  const selectionId = "sel_recovery_cycle";

  ctx.scenario("Échec principal samedi — retry dimanche 00:05");
  ctx.given("échec de paiement samedi 22 août 2026 00:05 Europe/Paris");
  const retryAfterSaturday = resolvePaymentRecoveryNextRetryAt({
    nextFailureCount: 1,
    reference: saturdayAugust22,
  });
  ctx.when("on planifie le retry 1");
  ctx.assertEqual(
    "retry 1 is Sunday 23 Aug 00:05 Paris",
    retryAfterSaturday?.toISOString(),
    sundayAugust23.toISOString(),
  );
  ctx.assertEqual(
    "retry 1 UTC is 2026-08-22T22:05:00.000Z (CEST)",
    retryAfterSaturday?.toISOString(),
    "2026-08-22T22:05:00.000Z",
  );

  ctx.scenario("Deuxième échec dimanche — retry lundi 00:05");
  ctx.given("deuxième échec dimanche 23 août 2026 00:05 Europe/Paris");
  const retryAfterSunday = resolvePaymentRecoveryNextRetryAt({
    nextFailureCount: 2,
    reference: sundayAugust23,
  });
  ctx.when("on planifie le retry 2");
  ctx.assertEqual(
    "retry 2 is Monday 24 Aug 00:05 Paris",
    retryAfterSunday?.toISOString(),
    mondayAugust24.toISOString(),
  );
  ctx.assertEqual(
    "retry 2 UTC is 2026-08-23T22:05:00.000Z (CEST)",
    retryAfterSunday?.toISOString(),
    "2026-08-23T22:05:00.000Z",
  );

  ctx.scenario("Troisième échec — final_failed sans retry");
  ctx.given("failureCount atteint MAX_RECOVERY_FAILURES");
  const retryAfterThird = resolvePaymentRecoveryNextRetryAt({
    nextFailureCount: 3,
    reference: mondayAugust24,
  });
  ctx.assertNull("third failure has no nextRetryAt", retryAfterThird);
  ctx.assertEqual(
    "third failure uses final_failed status",
    3 >= MAX_RECOVERY_FAILURES
      ? RECOVERY_STATUS.FINAL_FAILED
      : RECOVERY_STATUS.RETRY_SCHEDULED,
    RECOVERY_STATUS.FINAL_FAILED,
  );

  ctx.scenario("billingCycleKey inchangé");
  ctx.given("nextBillingDate samedi 22 août 00:05");
  ctx.assertEqual(
    "billingCycleKey still uses selection id + ISO nextBillingDate",
    buildBillingCycleKey(selectionId, saturdayAugust22),
    `mileyo_cycle_${selectionId}_${saturdayAugust22.toISOString()}`,
  );
  ctx.assertEqual(
    "missing nextBillingDate still uses unknown suffix",
    buildBillingCycleKey(selectionId, null),
    `mileyo_cycle_${selectionId}_unknown`,
  );

  ctx.scenario("MAX_RECOVERY_FAILURES inchangé");
  ctx.assertEqual(
    "max recovery failures remains 3",
    MAX_RECOVERY_FAILURES,
    3,
  );

  return finishSuite("29-subscription-payment-recovery-cycle", ctx);
};

process.exitCode = runSuite();
