/**
 * Business regression — first-order and renewal billing cycle alignment (13K-C1).
 *
 * Covers deliverySchedule date calculation only. Does not call the billing
 * worker, cron, recovery, resume, or live Shopify.
 */
import {
  resolveFirstOrderBillingAlignment,
  type FirstOrderDeliveryScheduleResolution,
} from "../../app/services/deliverySchedule.server";
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import { resolveNextBillingCycleAfterDelivery } from "../../app/utils/subscriptionBillingSchedule";
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

const firstOrderScheduleFor = (
  scheduledDeliveryDate: DeliveryDateString,
): FirstOrderDeliveryScheduleResolution => ({
  deliveryRescheduleReason: null,
  desiredDeliveryDate: scheduledDeliveryDate,
  preferredDeliveryWeekday: 4,
  referenceDate: scheduledDeliveryDate,
  scheduledDeliveryDate,
});

const runSuite = () => {
  const ctx = createBusinessTestContext("27-first-order-renewal-cycle-alignment");
  const thursdayAugust20 = requireDate("2026-08-20");
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));

  ctx.scenario("First order — livraison jeudi 20 août");
  ctx.given("un checkout payé pour la box du jeudi 20 août");
  const firstOrderAlignment = resolveFirstOrderBillingAlignment(
    firstOrderScheduleFor(thursdayAugust20),
  );
  ctx.when("on aligne le prochain billing sur la box suivante");
  ctx.assertEqual(
    "first order next delivery is Thursday 27 Aug",
    firstOrderAlignment?.nextDeliveryDate,
    "2026-08-27",
  );
  ctx.assertEqual(
    "first order nextBillingDate is Saturday 22 Aug 00:05 Paris",
    firstOrderAlignment?.alignedNextBillingDate.toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "first order UTC is 2026-08-21T22:05:00.000Z (CEST)",
    firstOrderAlignment?.alignedNextBillingDate.toISOString(),
    "2026-08-21T22:05:00.000Z",
  );

  ctx.scenario("Renewal — box livrée jeudi 20 août");
  ctx.given("un renouvellement payé pour la livraison du 20 août");
  const renewalNextBilling =
    resolveNextBillingCycleAfterDelivery(thursdayAugust20);
  ctx.then("le prochain billing paie la box du jeudi 27 août");
  ctx.assertEqual(
    "renewal nextBillingDate is Saturday 22 Aug 00:05 Paris",
    renewalNextBilling?.toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "renewal uses the same resolver as first-order alignment",
    renewalNextBilling?.toISOString(),
    firstOrderAlignment?.alignedNextBillingDate.toISOString(),
  );

  ctx.scenario("Writer Shopify non recalculé ici");
  ctx.given("alignBillingWithDeliverySchedule reste le writer générique");
  ctx.assertEqual(
    "first-order alignment still returns a Date for the writer",
    firstOrderAlignment?.alignedNextBillingDate instanceof Date,
    true,
  );
  ctx.assertNull(
    "missing first-order schedule does not throw",
    resolveFirstOrderBillingAlignment(null),
  );

  return finishSuite("27-first-order-renewal-cycle-alignment", ctx);
};

process.exitCode = runSuite();
