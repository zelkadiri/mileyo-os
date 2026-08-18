/**
 * Business regression — future Saturday billing / Sunday+Monday retry helpers (13K-A).
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
  computeNextSubscriptionCycleBillingAt,
  computeNextSubscriptionCycleRetryAt,
} from "../../app/utils/subscriptionCycleBilling";
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
  const ctx = createBusinessTestContext("25-subscription-cycle-billing");

  ctx.scenario("Billing samedi — vendredi avant samedi");
  ctx.given("vendredi 21 août 2026 10h Europe/Paris");
  const fridayBeforeSaturday = parisInstant(requireDate("2026-08-21"), 10, 0);
  const saturdayAugust22 = cycleSlot(requireDate("2026-08-22"));
  ctx.when("on calcule le prochain billing de cycle");
  ctx.assertEqual(
    "Friday 10:00 Paris bills Saturday 00:05 Paris",
    computeNextSubscriptionCycleBillingAt(fridayBeforeSaturday).toISOString(),
    saturdayAugust22.toISOString(),
  );
  ctx.assertEqual(
    "Friday case UTC is 2026-08-21T22:05:00.000Z (CEST)",
    computeNextSubscriptionCycleBillingAt(fridayBeforeSaturday).toISOString(),
    "2026-08-21T22:05:00.000Z",
  );

  ctx.scenario("Billing samedi — lundi avant samedi");
  ctx.given("lundi 17 août 2026 10h Europe/Paris");
  const mondayBeforeSaturday = parisInstant(requireDate("2026-08-17"), 10, 0);
  ctx.assertEqual(
    "Monday 10:00 Paris bills Saturday 22 August 00:05",
    computeNextSubscriptionCycleBillingAt(mondayBeforeSaturday).toISOString(),
    saturdayAugust22.toISOString(),
  );

  ctx.scenario("Billing samedi — avant 00:05");
  ctx.given("samedi 22 août 2026 00h00 Europe/Paris");
  const saturdayBeforeClock = parisInstant(requireDate("2026-08-22"), 0, 0);
  ctx.assertEqual(
    "Saturday 00:00 still targets this Saturday 00:05",
    computeNextSubscriptionCycleBillingAt(saturdayBeforeClock).toISOString(),
    saturdayAugust22.toISOString(),
  );

  ctx.scenario("Billing samedi — après 00:05");
  ctx.given("samedi 22 août 2026 10h Europe/Paris");
  const saturdayAfterClock = parisInstant(requireDate("2026-08-22"), 10, 0);
  const nextSaturday = cycleSlot(requireDate("2026-08-29"));
  ctx.then("le billing vise le samedi suivant");
  ctx.assertEqual(
    "Saturday 10:00 Paris bills the following Saturday",
    computeNextSubscriptionCycleBillingAt(saturdayAfterClock).toISOString(),
    nextSaturday.toISOString(),
  );
  ctx.assertEqual(
    "Following Saturday UTC is 2026-08-28T22:05:00.000Z (CEST)",
    nextSaturday.toISOString(),
    "2026-08-28T22:05:00.000Z",
  );

  ctx.scenario("Billing samedi — dimanche");
  ctx.given("dimanche 23 août 2026 10h Europe/Paris");
  const sundayAfterBilling = parisInstant(requireDate("2026-08-23"), 10, 0);
  ctx.assertEqual(
    "Sunday 10:00 Paris bills the following Saturday",
    computeNextSubscriptionCycleBillingAt(sundayAfterBilling).toISOString(),
    nextSaturday.toISOString(),
  );

  ctx.scenario("Retries — échec samedi");
  ctx.given("échec de paiement samedi 22 août 2026 00h10 Europe/Paris");
  const saturdayFailure = parisInstant(requireDate("2026-08-22"), 0, 10);
  const sundayRetry = cycleSlot(requireDate("2026-08-23"));
  const mondayRetry = cycleSlot(requireDate("2026-08-24"));
  ctx.assertEqual(
    "retry 1 is Sunday 00:05 Paris",
    computeNextSubscriptionCycleRetryAt(saturdayFailure, 1).toISOString(),
    sundayRetry.toISOString(),
  );
  ctx.assertEqual(
    "retry 1 UTC is 2026-08-22T22:05:00.000Z (CEST)",
    sundayRetry.toISOString(),
    "2026-08-22T22:05:00.000Z",
  );
  ctx.assertEqual(
    "retry 2 is Monday 00:05 Paris",
    computeNextSubscriptionCycleRetryAt(saturdayFailure, 2).toISOString(),
    mondayRetry.toISOString(),
  );
  ctx.assertEqual(
    "retry 2 UTC is 2026-08-23T22:05:00.000Z (CEST)",
    mondayRetry.toISOString(),
    "2026-08-23T22:05:00.000Z",
  );

  ctx.scenario("Retries — dimanche après 00:05");
  ctx.given("dimanche 23 août 2026 10h Europe/Paris");
  ctx.assertEqual(
    "Sunday 10:00 retry 1 jumps to next Sunday",
    computeNextSubscriptionCycleRetryAt(sundayAfterBilling, 1).toISOString(),
    cycleSlot(requireDate("2026-08-30")).toISOString(),
  );
  ctx.assertEqual(
    "Sunday 10:00 retry 2 stays this week's Monday",
    computeNextSubscriptionCycleRetryAt(sundayAfterBilling, 2).toISOString(),
    mondayRetry.toISOString(),
  );

  ctx.scenario("Retries — lundi après 00:05");
  ctx.given("lundi 24 août 2026 10h Europe/Paris");
  const mondayAfterClock = parisInstant(requireDate("2026-08-24"), 10, 0);
  ctx.assertEqual(
    "Monday 10:00 retry 1 is next Sunday",
    computeNextSubscriptionCycleRetryAt(mondayAfterClock, 1).toISOString(),
    cycleSlot(requireDate("2026-08-30")).toISOString(),
  );
  ctx.assertEqual(
    "Monday 10:00 retry 2 is next Monday",
    computeNextSubscriptionCycleRetryAt(mondayAfterClock, 2).toISOString(),
    cycleSlot(requireDate("2026-08-31")).toISOString(),
  );

  ctx.scenario("Heure d’hiver — conversion UTC");
  ctx.given("vendredi 9 janvier 2026 10h Europe/Paris (CET)");
  const winterFriday = parisInstant(requireDate("2026-01-09"), 10, 0);
  const winterSaturday = computeNextSubscriptionCycleBillingAt(winterFriday);
  ctx.assertEqual(
    "winter Saturday UTC is 2026-01-09T23:05:00.000Z (CET)",
    winterSaturday.toISOString(),
    "2026-01-09T23:05:00.000Z",
  );
  ctx.assertEqual(
    "winter Saturday calendar date in Paris is 2026-01-10",
    referenceDateFromInstant(winterSaturday, SUBSCRIPTION_CYCLE_TIMEZONE),
    "2026-01-10",
  );

  ctx.scenario("Heure d’été — conversion UTC");
  ctx.given("le slot samedi 22 août 00:05 déjà calculé");
  ctx.assertEqual(
    "summer Paris calendar date of billing instant is 2026-08-22",
    referenceDateFromInstant(saturdayAugust22, SUBSCRIPTION_CYCLE_TIMEZONE),
    "2026-08-22",
  );

  return finishSuite("25-subscription-cycle-billing", ctx);
};

process.exitCode = runSuite();
