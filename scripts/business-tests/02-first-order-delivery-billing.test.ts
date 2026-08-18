/**
 * Business regression — first subscription order delivery and billing.
 */
import { DELIVERY_DATE_PROPERTY_TECHNICAL } from "../../app/utils/orderLineItemProperties";
import {
  resolveFirstOrderBillingAlignment,
  resolveFirstOrderDeliverySchedule,
} from "../../app/services/deliverySchedule.server";
import { getBillingRunnerDeliveryGate } from "../../app/services/subscriptionBillingWorker.server";
import {
  computeNextWeeklyDeliveryDate,
  parseDeliveryDate,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const sampleMealProperties = [
  { name: "Type de commande", value: "Abonnement hebdomadaire" },
  { name: "Nombre de repas", value: "8" },
  { name: "Plat 1", value: "Poulet tikka" },
];

const ALIGNED_NEXT_BILLING_ISO = "2026-07-17T22:05:00.000Z";

const runSuite = () => {
  const ctx = createBusinessTestContext("02-first-order-delivery-billing");

  ctx.scenario("Première commande abonnement — livraison J+3");
  ctx.given("un checkout jeudi 10 juillet pour livraison jeudi 16 juillet");
  const jPlus3Schedule = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      ...sampleMealProperties,
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });
  const jPlus3Alignment = resolveFirstOrderBillingAlignment(jPlus3Schedule);
  ctx.when("la première livraison est enregistrée");
  ctx.assertEqual(
    "J+3 first delivery date",
    jPlus3Schedule?.scheduledDeliveryDate,
    "2026-07-16",
  );
  ctx.assertEqual(
    "J+3 preferred weekday from scheduled date",
    jPlus3Schedule?.preferredDeliveryWeekday,
    4,
  );
  ctx.then("le billing prépare la deuxième livraison");
  ctx.assertEqual(
    "J+3 next billing aligned on Saturday of the second delivery",
    jPlus3Alignment?.alignedNextBillingDate.toISOString(),
    ALIGNED_NEXT_BILLING_ISO,
  );
  ctx.assertEqual(
    "J+3 second delivery date",
    jPlus3Alignment?.nextDeliveryDate,
    "2026-07-23",
  );

  ctx.scenario("Première commande abonnement — livraison J+10");
  ctx.given("un checkout lundi 6 juillet pour livraison jeudi 16 juillet");
  const jPlus10Schedule = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      ...sampleMealProperties,
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ],
    orderCreatedAt: new Date("2026-07-06T12:00:00.000Z"),
  });
  const jPlus10Alignment = resolveFirstOrderBillingAlignment(jPlus10Schedule);
  ctx.when("le billing est calculé");
  ctx.assertEqual(
    "J+10 first delivery date",
    jPlus10Schedule?.scheduledDeliveryDate,
    "2026-07-16",
  );
  ctx.assertEqual(
    "J+10 billing is not checkout + 7",
    jPlus10Alignment?.alignedNextBillingDate.toISOString().startsWith("2026-07-13"),
    false,
  );
  ctx.assertEqual(
    "J+10 second delivery is J+17",
    computeNextWeeklyDeliveryDate(parseDeliveryDate("2026-07-16")!),
    "2026-07-23",
  );
  ctx.then("le runner ne bloque plus le billing sur la gate J-2");
  const gateBeforeBilling = getBillingRunnerDeliveryGate({
    now: new Date("2026-07-13T12:00:00.000Z"),
    selection: {
      nextBillingDate: new Date(ALIGNED_NEXT_BILLING_ISO),
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertNull(
    "J+10 cron is not blocked by delivery J-2",
    gateBeforeBilling.skipReason,
  );
  ctx.assertEqual(
    "J+10 cron does not realign Saturday to Tuesday",
    gateBeforeBilling.shouldRealignLegacyBillingDate,
    false,
  );

  ctx.scenario("Rejeu webhook orders-create — idempotence logique");
  ctx.given("la même première commande rejouée");
  const replaySchedule = resolveFirstOrderDeliverySchedule({
    lineItemProperties: [
      ...sampleMealProperties,
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ],
    orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
  });
  ctx.when("on recalcule le schedule");
  ctx.assertEqual(
    "idempotent replay keeps scheduled date",
    replaySchedule?.scheduledDeliveryDate,
    "2026-07-16",
  );
  ctx.assertEqual(
    "idempotent replay keeps billing alignment",
    resolveFirstOrderBillingAlignment(replaySchedule)?.alignedNextBillingDate.toISOString(),
    ALIGNED_NEXT_BILLING_ISO,
  );

  ctx.scenario("Première commande sans date livraison — fail-safe");
  ctx.given("un checkout sans propriété livraison");
  ctx.assertNull(
    "missing delivery date does not throw",
    resolveFirstOrderDeliverySchedule({
      lineItemProperties: sampleMealProperties,
      orderCreatedAt: new Date("2026-07-10T12:00:00.000Z"),
    }),
  );

  return finishSuite("02-first-order-delivery-billing", ctx);
};

process.exitCode = runSuite();
