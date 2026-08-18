/**
 * Business regression — legacy alignment audit and backfill.
 */
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  areBillingDatesAligned,
  computeDeliveryBillingAlignmentAudit,
  resolveProjectedActiveDeliveryDate,
  resolveRecommendedNextBillingDate,
} from "../../app/services/subscriptionDeliveryBillingAlignment.server";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const SATURDAY_OF_JULY_23 = "2026-07-17T22:05:00.000Z";
const SATURDAY_OF_JULY_30 = "2026-07-24T22:05:00.000Z";
const TUESDAY_J2_OF_JULY_23 = "2026-07-20T22:05:00.000Z";

const activeSelection = () => ({
  active: true,
  nextBillingDate: new Date("2026-07-13T10:00:00.000Z"),
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }

  return parsed;
};

const runSuite = () => {
  const ctx = createBusinessTestContext("08-legacy-alignment-backfill");

  ctx.scenario("Ancien contrat J+10 — nextBillingDate Shopify trop tôt");
  ctx.given("première livraison payée le 16/07, legacy billing le 13/07");
  const projected = resolveProjectedActiveDeliveryDate({
    nextScheduledDeliveryDate: "2026-07-16",
    now: new Date("2026-07-13T12:00:00.000Z"),
    preferredDeliveryWeekday: 4,
  });
  const recommended = resolveRecommendedNextBillingDate({
    activeDeliveryDate: projected!,
    hasBoxOrderForActiveDelivery: true,
  });
  const audit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: true,
    projectedActiveDeliveryDate: projected,
    selection: activeSelection(),
    shopifyNextBillingDate: new Date("2026-07-13T10:00:00.000Z"),
  });
  ctx.when("l'audit calcule la recommandation");
  ctx.assertEqual(
    "audit recommends second box billing",
    recommended?.toISOString(),
    SATURDAY_OF_JULY_23,
  );
  ctx.assertEqual(
    "dry-run marks Shopify+DB update needed",
    audit.action,
    "would_update_shopify_and_db",
  );

  ctx.scenario("Livraison active déjà payée — billing semaine suivante");
  ctx.given("BoxOrder existe pour jeudi 16");
  ctx.assertEqual(
    "paid active delivery bills next week",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: requireDate("2026-07-16"),
      hasBoxOrderForActiveDelivery: true,
    })?.toISOString(),
    SATURDAY_OF_JULY_23,
  );

  ctx.scenario("Livraison active non payée — billing cette livraison");
  ctx.given("aucune BoxOrder pour jeudi 23");
  ctx.assertEqual(
    "unpaid active delivery bills current delivery",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: requireDate("2026-07-23"),
      hasBoxOrderForActiveDelivery: false,
    })?.toISOString(),
    SATURDAY_OF_JULY_23,
  );

  ctx.scenario("Données invalides — skipped sans mutation");
  ctx.given("date livraison invalide");
  const invalidAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: null,
    selection: {
      ...activeSelection(),
      nextScheduledDeliveryDate: "2026-99-99",
      preferredDeliveryWeekday: null,
    },
  });
  ctx.assertEqual(
    "invalid data skipped",
    invalidAudit.action,
    "skipped_missing_delivery_context",
  );

  ctx.scenario("Contrat paused — skipped");
  ctx.given("abonnement en pause");
  const pausedAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-23"),
    selection: {
      ...activeSelection(),
      active: false,
      status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
    },
  });
  ctx.assertEqual("paused contract skipped", pausedAudit.action, "skipped_inactive_contract");

  ctx.scenario("Contrat terminal — skipped");
  ctx.given("abonnement annulé");
  const cancelledAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-23"),
    selection: {
      ...activeSelection(),
      status: SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
    },
  });
  ctx.assertEqual(
    "cancelled contract skipped",
    cancelledAudit.action,
    "skipped_inactive_contract",
  );

  ctx.scenario("Idempotence — déjà aligné");
  ctx.given("DB et Shopify déjà sur billing recommandé");
  const alignedAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-30"),
    selection: {
      ...activeSelection(),
      nextBillingDate: new Date(SATURDAY_OF_JULY_30),
      nextScheduledDeliveryDate: "2026-07-30",
    },
    shopifyNextBillingDate: new Date(SATURDAY_OF_JULY_30),
  });
  ctx.assertEqual("already aligned contracts unchanged", alignedAudit.action, "ok_already_aligned");
  ctx.assertTrue(
    "billing tolerance accepts small drift",
    areBillingDatesAligned(
      new Date("2026-07-24T22:05:30.000Z"),
      new Date(SATURDAY_OF_JULY_30),
    ),
  );

  ctx.scenario("Mardi J-2 legacy — mise à jour recommandée");
  ctx.given("DB et Shopify encore sur J-2 mardi pour jeudi 23 unpaid");
  const legacyTuesdayAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: requireDate("2026-07-23"),
    selection: {
      ...activeSelection(),
      nextBillingDate: new Date(TUESDAY_J2_OF_JULY_23),
      nextScheduledDeliveryDate: "2026-07-23",
    },
    shopifyNextBillingDate: new Date(TUESDAY_J2_OF_JULY_23),
  });
  ctx.assertEqual(
    "legacy Tuesday is marked for Shopify+DB update",
    legacyTuesdayAudit.action,
    "would_update_shopify_and_db",
  );
  ctx.assertEqual(
    "legacy Tuesday recommendation is Saturday of current delivery",
    legacyTuesdayAudit.recommendedNextBillingDate?.toISOString(),
    SATURDAY_OF_JULY_23,
  );

  return finishSuite("08-legacy-alignment-backfill", ctx);
};

process.exitCode = runSuite();
