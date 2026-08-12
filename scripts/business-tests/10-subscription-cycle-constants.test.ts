/**
 * Business regression — future weekly subscription cycle constants (13A).
 *
 * Constants only; no date calculation, billing runner, cron, or pause logic.
 */
import {
  SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS,
  SUBSCRIPTION_CYCLE_BILLING_WEEKDAY,
  SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS,
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR,
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE,
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_WEEKDAY,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../../app/constants/subscriptionCycle";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const runSuite = () => {
  const ctx = createBusinessTestContext("10-subscription-cycle-constants");

  ctx.scenario("Timezone abonnement");
  ctx.assertEqual(
    "subscription cycle timezone is Europe/Paris",
    SUBSCRIPTION_CYCLE_TIMEZONE,
    "Europe/Paris",
  );

  ctx.scenario("Billing principal samedi");
  ctx.assertEqual(
    "principal billing weekday is Saturday (6)",
    SUBSCRIPTION_CYCLE_BILLING_WEEKDAY,
    6,
  );

  ctx.scenario("Retries dimanche + lundi");
  ctx.assertEqual(
    "billing retry weekdays length is 2",
    SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS.length,
    2,
  );
  ctx.assertEqual(
    "first billing retry weekday is Sunday (0)",
    SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS[0],
    0,
  );
  ctx.assertEqual(
    "second billing retry weekday is Monday (1)",
    SUBSCRIPTION_CYCLE_BILLING_RETRY_WEEKDAYS[1],
    1,
  );

  ctx.scenario("Cutoff sélection repas lundi 23h59");
  ctx.assertEqual(
    "meal cutoff weekday is Monday (1)",
    SUBSCRIPTION_CYCLE_MEAL_CUTOFF_WEEKDAY,
    1,
  );
  ctx.assertEqual(
    "meal cutoff hour is 23",
    SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR,
    23,
  );
  ctx.assertEqual(
    "meal cutoff minute is 59",
    SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE,
    59,
  );

  ctx.scenario("Livraison jeudi + vendredi");
  ctx.assertEqual(
    "delivery weekdays length is 2",
    SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS.length,
    2,
  );
  ctx.assertEqual(
    "first delivery weekday is Thursday (4)",
    SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS[0],
    4,
  );
  ctx.assertEqual(
    "second delivery weekday is Friday (5)",
    SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS[1],
    5,
  );

  return finishSuite("10-subscription-cycle-constants", ctx);
};

process.exitCode = runSuite();
