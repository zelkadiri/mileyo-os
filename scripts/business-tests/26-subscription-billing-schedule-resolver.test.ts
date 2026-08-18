/**
 * Business regression — delivery date → Saturday billing-cycle resolver (13K-B1).
 *
 * Pure calendar math. Does not call the billing worker, cron, recovery, or Shopify.
 */
import {
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
} from "../../app/constants/deliverySchedule";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
  referenceDateFromInstant,
  type DeliveryDateString,
} from "../../app/utils/deliveryDate";
import {
  resolveBillingCycleDateForDelivery,
  resolveNextBillingCycleAfterDelivery,
} from "../../app/utils/subscriptionBillingSchedule";
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

const runSuite = () => {
  const ctx = createBusinessTestContext("26-subscription-billing-schedule-resolver");

  ctx.scenario("A — livraison jeudi 20 août 2026");
  ctx.given("une box jeudi 20 août");
  const thursdayAugust20 = requireDate("2026-08-20");
  const saturdayAugust15 = cycleSlot(requireDate("2026-08-15"));
  ctx.when("on résout le samedi qui paie cette livraison");
  ctx.assertEqual(
    "Thursday 20 Aug bills Saturday 15 Aug 00:05 Paris",
    resolveBillingCycleDateForDelivery(thursdayAugust20)?.toISOString(),
    saturdayAugust15.toISOString(),
  );
  ctx.assertEqual(
    "Thursday 20 Aug UTC is 2026-08-14T22:05:00.000Z (CEST)",
    resolveBillingCycleDateForDelivery(thursdayAugust20)?.toISOString(),
    "2026-08-14T22:05:00.000Z",
  );

  ctx.scenario("B — livraison vendredi 21 août 2026");
  ctx.given("une box vendredi 21 août");
  ctx.assertEqual(
    "Friday 21 Aug bills the same Saturday 15 Aug",
    resolveBillingCycleDateForDelivery(requireDate("2026-08-21"))?.toISOString(),
    saturdayAugust15.toISOString(),
  );

  ctx.scenario("C — livraison jeudi 27 août 2026");
  ctx.given("une box jeudi 27 août");
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));
  ctx.assertEqual(
    "Thursday 27 Aug bills Saturday 22 Aug 00:05 Paris",
    resolveBillingCycleDateForDelivery(requireDate("2026-08-27"))?.toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "Thursday 27 Aug UTC is 2026-08-21T22:05:00.000Z (CEST)",
    resolveBillingCycleDateForDelivery(requireDate("2026-08-27"))?.toISOString(),
    "2026-08-21T22:05:00.000Z",
  );

  ctx.scenario("D — après livraison jeudi 20 août déjà payée");
  ctx.given("la box du 20 août est payée");
  ctx.then("le prochain billing paie la box du 27 août");
  ctx.assertEqual(
    "paid Thursday 20 Aug next-bills Saturday 22 Aug",
    resolveNextBillingCycleAfterDelivery(thursdayAugust20)?.toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "next billing after Thursday 20 equals billing of Thursday 27",
    resolveNextBillingCycleAfterDelivery(thursdayAugust20)?.toISOString(),
    resolveBillingCycleDateForDelivery(requireDate("2026-08-27"))?.toISOString(),
  );

  ctx.scenario("E — heure d’hiver janvier");
  ctx.given("une livraison jeudi 22 janvier 2026");
  const winterThursday = requireDate("2026-01-22");
  const winterBilling = resolveBillingCycleDateForDelivery(winterThursday);
  ctx.assertEqual(
    "winter Thursday 22 Jan bills Saturday 17 Jan 00:05 Paris",
    winterBilling?.toISOString(),
    cycleSlot(requireDate("2026-01-17")).toISOString(),
  );
  ctx.assertEqual(
    "winter UTC is 2026-01-16T23:05:00.000Z (CET)",
    winterBilling?.toISOString(),
    "2026-01-16T23:05:00.000Z",
  );
  ctx.assertEqual(
    "winter Paris calendar date of billing instant is 2026-01-17",
    winterBilling
      ? referenceDateFromInstant(winterBilling, SUBSCRIPTION_CYCLE_TIMEZONE)
      : null,
    "2026-01-17",
  );

  ctx.scenario("Date livraison invalide — fail-safe");
  ctx.assertNull(
    "invalid delivery date returns null",
    resolveBillingCycleDateForDelivery("2026-99-99"),
  );
  ctx.assertNull(
    "invalid delivery date next-cycle returns null",
    resolveNextBillingCycleAfterDelivery(null),
  );

  return finishSuite("26-subscription-billing-schedule-resolver", ctx);
};

process.exitCode = runSuite();
