/**
 * Business regression — subscription renewal cycle.
 */
import {
  resolveRenewalDeliverySchedule,
  resolveRenewalDeliveryScheduleFromSelection,
} from "../../app/services/deliverySchedule.server";
import {
  computeNextBillingDateFromCurrentDelivery,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const RENEWAL_BILLING_FOR_NEXT_WEEK = "2026-07-27T22:05:00.000Z";

const runSuite = () => {
  const ctx = createBusinessTestContext("03-renewal-cycle");

  ctx.scenario("Renouvellement normal — livraison projetée active");
  ctx.given("une première livraison passée le 16/07 et billing le 21/07 pour livraison 23/07");
  const renewalSchedule = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: new Date("2026-07-21T00:05:00.000Z"),
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.when("le renouvellement est calculé");
  ctx.assertEqual(
    "renewal uses projected active delivery",
    renewalSchedule?.scheduledDeliveryDate,
    "2026-07-23",
  );
  ctx.assertEqual(
    "renewal does not reschedule from payment date",
    renewalSchedule?.deliveryRescheduleReason,
    null,
  );

  ctx.scenario("Renouvellement — legacy J+3 ne doit pas overshoot");
  ctx.given("l'ancienne règle orderCreatedAt + J+3");
  const legacyRenewal = resolveRenewalDeliverySchedule({
    orderCreatedAt: new Date("2026-07-21T00:05:00.000Z"),
    preferredDeliveryWeekday: 4,
  });
  ctx.then("la nouvelle règle garde jeudi 23, pas jeudi 30");
  ctx.assertEqual(
    "legacy renewal would target next week",
    legacyRenewal?.scheduledDeliveryDate,
    "2026-07-30",
  );
  ctx.assertEqual(
    "projected renewal keeps thursday 23",
    renewalSchedule?.scheduledDeliveryDate,
    "2026-07-23",
  );

  ctx.scenario("Après renouvellement — billing sur livraison suivante");
  ctx.given("une livraison renouvelée le jeudi 23 juillet");
  const alignedBilling = computeNextBillingDateFromCurrentDelivery("2026-07-23");
  ctx.when("on calcule le prochain billing");
  ctx.assertEqual(
    "renewal next billing targets following delivery",
    alignedBilling?.toISOString(),
    RENEWAL_BILLING_FOR_NEXT_WEEK,
  );
  ctx.assertEqual(
    "renewal billing is not Shopify +7 from payment",
    alignedBilling?.toISOString().startsWith("2026-07-28"),
    false,
  );

  ctx.scenario("Renouvellement sans weekday — projection depuis date stockée");
  ctx.given("une sélection avec date passée mais sans preferredDeliveryWeekday");
  const renewalWithoutWeekday = resolveRenewalDeliveryScheduleFromSelection({
    orderCreatedAt: new Date("2026-07-21T00:05:00.000Z"),
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: null,
    },
  });
  ctx.assertEqual(
    "renewal without weekday still projects from stored date",
    renewalWithoutWeekday?.scheduledDeliveryDate,
    "2026-07-23",
  );

  ctx.scenario("Renouvellement sans date ni weekday — fail-safe");
  ctx.given("une sélection sans date ni preferredDeliveryWeekday");
  ctx.assertNull(
    "renewal without date and weekday returns null",
    resolveRenewalDeliveryScheduleFromSelection({
      orderCreatedAt: new Date("2026-07-21T00:05:00.000Z"),
      selection: {
        nextScheduledDeliveryDate: null,
        preferredDeliveryWeekday: null,
      },
    }),
  );

  return finishSuite("03-renewal-cycle", ctx);
};

process.exitCode = runSuite();
