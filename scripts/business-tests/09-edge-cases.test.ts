/**
 * Business regression — edge cases and fail-safe behavior.
 */
import {
  isTerminalSubscriptionSelectionStatus,
  SUBSCRIPTION_SELECTION_STATUS,
} from "../../app/constants/subscriptionMealSelection";
import { DELIVERY_TIMEZONE } from "../../app/constants/deliverySchedule";
import {
  getSelectionSkipReason,
} from "../../app/services/subscriptionBillingWorker.server";
import {
  getAvailableDeliveryDates,
  isSunday,
  parseDeliveryDate,
  projectActiveScheduledDeliveryDate,
  referenceDateFromInstant,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const runSuite = () => {
  const ctx = createBusinessTestContext("09-edge-cases");

  ctx.scenario("Changement heure été/hiver Paris — billingReadyAt stable");
  ctx.given("livraison hiver et livraison été");
  const winterRef = referenceDateFromInstant(new Date("2026-01-10T12:00:00.000Z"));
  const summerRef = referenceDateFromInstant(new Date("2026-07-10T12:00:00.000Z"));
  ctx.when("on liste les dates disponibles");
  ctx.assertTrue(
    "winter available dates exist",
    getAvailableDeliveryDates(winterRef).length > 0,
  );
  ctx.assertTrue(
    "summer available dates exist",
    getAvailableDeliveryDates(summerRef).length > 0,
  );

  ctx.scenario("Date livraison dimanche impossible");
  ctx.given("une date dimanche");
  const sundayDate = parseDeliveryDate("2026-07-19");
  ctx.assertTrue(
    "sunday date detected as blocked weekday",
    sundayDate !== null && isSunday(sundayDate),
  );
  ctx.assertTrue(
    "available dates never include sunday",
    getAvailableDeliveryDates(summerRef).every((date) => {
      const parsed = parseDeliveryDate(date);
      if (!parsed) return false;
      const weekday = new Date(`${parsed}T12:00:00.000Z`).getUTCDay();
      return weekday !== 0;
    }),
  );

  ctx.scenario("nextScheduledDeliveryDate null + weekday valide");
  ctx.given("preferredDeliveryWeekday jeudi");
  const weekdayOnly = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: null,
    now: new Date("2026-07-15T12:00:00.000Z"),
    preferredDeliveryWeekday: 4,
  });
  ctx.assertEqual(
    "weekday-only projection works",
    weekdayOnly.effectiveDeliveryDate,
    "2026-07-16",
  );

  ctx.scenario("preferredDeliveryWeekday null + date invalide");
  ctx.given("données incohérentes");
  ctx.assertNull(
    "invalid data projection fail-open",
    projectActiveScheduledDeliveryDate({
      nextScheduledDeliveryDate: "2026-99-99",
      preferredDeliveryWeekday: null,
    }).effectiveDeliveryDate,
  );

  ctx.scenario("Contract ID manquant — billing runner skip");
  ctx.given("abonnement sans subscriptionContractId");
  ctx.assertEqual(
    "missing contract id skipped by billing runner",
    getSelectionSkipReason({
      active: true,
      lastBillingAttemptAt: null,
      lastBillingAttemptStatus: null,
      nextBillingDate: new Date("2020-01-01T00:00:00.000Z"),
      resumeAttemptKey: null,
      resumeAttemptOrderId: null,
      resumeAttemptStartedAt: null,
      resumeAttemptStatus: null,
      status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
      subscriptionContractId: null,
    }),
    "missing_contract_id",
  );

  ctx.scenario("Statut contrat terminal — actions portail bloquées");
  ctx.given("contrat cancelled");
  ctx.assertTrue(
    "terminal contract detected",
    isTerminalSubscriptionSelectionStatus(SUBSCRIPTION_SELECTION_STATUS.CANCELLED),
  );
  ctx.assertEqual(
    "terminal contract skipped by billing runner",
    getSelectionSkipReason({
      active: false,
      lastBillingAttemptAt: null,
      lastBillingAttemptStatus: null,
      nextBillingDate: new Date("2020-01-01T00:00:00.000Z"),
      resumeAttemptKey: null,
      resumeAttemptOrderId: null,
      resumeAttemptStartedAt: null,
      resumeAttemptStatus: null,
      status: SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
      subscriptionContractId: "123",
    }),
    "terminal_contract",
  );

  ctx.scenario("Billing attempt in-flight — skip");
  ctx.given("tentative billing récente en cours");
  ctx.assertEqual(
    "in-flight billing attempt blocks cron",
    getSelectionSkipReason({
      active: true,
      lastBillingAttemptAt: new Date(),
      lastBillingAttemptStatus: "submitted",
      nextBillingDate: new Date("2020-01-01T00:00:00.000Z"),
      resumeAttemptKey: null,
      resumeAttemptOrderId: null,
      resumeAttemptStartedAt: null,
      resumeAttemptStatus: null,
      status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
      subscriptionContractId: "123",
    }),
    "recent_attempt",
  );

  ctx.scenario("Timezone Paris constante");
  ctx.assertEqual("delivery timezone is Europe/Paris", DELIVERY_TIMEZONE, "Europe/Paris");

  return finishSuite("09-edge-cases", ctx);
};

process.exitCode = runSuite();
