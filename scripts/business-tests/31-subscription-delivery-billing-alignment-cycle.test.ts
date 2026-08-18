/**
 * Business regression — delivery billing alignment cycle recommendation (13K-F2).
 *
 * Covers resolveRecommendedNextBillingDate only. Does not run the backfill
 * script, apply mutations, or call Shopify.
 */
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import {
  computeDeliveryBillingAlignmentAudit,
  resolveRecommendedNextBillingDate,
} from "../../app/services/subscriptionDeliveryBillingAlignment.server";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const SATURDAY_AUGUST_15 = "2026-08-14T22:05:00.000Z";
const SATURDAY_AUGUST_22 = "2026-08-21T22:05:00.000Z";
const TUESDAY_J2_AUGUST_20 = "2026-08-17T22:05:00.000Z";

const requireDate = (value: string) => {
  const parsed = parseDeliveryDate(value);

  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }

  return parsed;
};

const activeSelection = (nextBillingDate: Date) => ({
  active: true,
  nextBillingDate,
  nextScheduledDeliveryDate: "2026-08-20" as string | null,
  preferredDeliveryWeekday: 4,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const runSuite = () => {
  const ctx = createBusinessTestContext(
    "31-subscription-delivery-billing-alignment-cycle",
  );
  const thursdayAugust20 = requireDate("2026-08-20");

  ctx.scenario("BoxOrder présent — samedi de D+7");
  ctx.given("livraison jeudi 20 août déjà payée");
  ctx.assertEqual(
    "paid Thursday 20 Aug recommends Saturday 22 Aug",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: thursdayAugust20,
      hasBoxOrderForActiveDelivery: true,
    })?.toISOString(),
    SATURDAY_AUGUST_22,
  );

  ctx.scenario("Pas de BoxOrder — samedi de D");
  ctx.given("livraison jeudi 20 août non payée");
  ctx.assertEqual(
    "unpaid Thursday 20 Aug recommends Saturday 15 Aug",
    resolveRecommendedNextBillingDate({
      activeDeliveryDate: thursdayAugust20,
      hasBoxOrderForActiveDelivery: false,
    })?.toISOString(),
    SATURDAY_AUGUST_15,
  );

  ctx.scenario("Samedi déjà aligné");
  ctx.given("DB et Shopify déjà sur samedi 15 août");
  const alignedAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: thursdayAugust20,
    selection: activeSelection(new Date(SATURDAY_AUGUST_15)),
    shopifyNextBillingDate: new Date(SATURDAY_AUGUST_15),
  });
  ctx.assertEqual(
    "Saturday cycle is ok_already_aligned",
    alignedAudit.action,
    "ok_already_aligned",
  );

  ctx.scenario("Mardi J-2 legacy");
  ctx.given("DB et Shopify encore sur mardi 18 août 00:05");
  const legacyAudit = computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery: false,
    projectedActiveDeliveryDate: thursdayAugust20,
    selection: activeSelection(new Date(TUESDAY_J2_AUGUST_20)),
    shopifyNextBillingDate: new Date(TUESDAY_J2_AUGUST_20),
  });
  ctx.assertEqual(
    "legacy Tuesday would_update_shopify_and_db",
    legacyAudit.action,
    "would_update_shopify_and_db",
  );
  ctx.assertEqual(
    "legacy Tuesday recommendation is Saturday 15 Aug",
    legacyAudit.recommendedNextBillingDate?.toISOString(),
    SATURDAY_AUGUST_15,
  );

  ctx.scenario("Skips existants conservés");
  ctx.assertEqual(
    "paused contract skipped",
    computeDeliveryBillingAlignmentAudit({
      hasBoxOrderForActiveDelivery: false,
      projectedActiveDeliveryDate: thursdayAugust20,
      selection: {
        ...activeSelection(new Date(SATURDAY_AUGUST_15)),
        active: false,
        status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
      },
    }).action,
    "skipped_inactive_contract",
  );
  ctx.assertEqual(
    "terminal contract skipped",
    computeDeliveryBillingAlignmentAudit({
      hasBoxOrderForActiveDelivery: false,
      projectedActiveDeliveryDate: thursdayAugust20,
      selection: {
        ...activeSelection(new Date(SATURDAY_AUGUST_15)),
        status: SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
      },
    }).action,
    "skipped_inactive_contract",
  );
  ctx.assertEqual(
    "invalid delivery skipped",
    computeDeliveryBillingAlignmentAudit({
      hasBoxOrderForActiveDelivery: false,
      projectedActiveDeliveryDate: null,
      selection: {
        ...activeSelection(new Date(SATURDAY_AUGUST_15)),
        nextScheduledDeliveryDate: "2026-99-99",
        preferredDeliveryWeekday: null,
      },
    }).action,
    "skipped_missing_delivery_context",
  );

  return finishSuite("31-subscription-delivery-billing-alignment-cycle", ctx);
};

process.exitCode = runSuite();
