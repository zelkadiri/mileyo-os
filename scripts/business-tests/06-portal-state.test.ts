/**
 * Business regression — portal client state and guards coherence.
 */
import {
  derivePortalResumeUi,
  isSubscriptionBillingDue,
} from "../../app/features/portal/portal-resume.server";
import {
  formatScheduledDeliveryLabel,
  validateMealSelection,
} from "../../app/features/portal/portal-formatters";
import {
  getPortalModificationBlockReason,
} from "../../app/services/subscriptionModificationBlock.server";
import {
  getDeliveryCutoffStatus,
  projectActiveScheduledDeliveryDate,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
  samplePortalMeals,
} from "./_framework";

const portalMeals = samplePortalMeals(4);

const activeSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextScheduledDeliveryDate: "2026-07-16" as string | null,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const runSuite = () => {
  const ctx = createBusinessTestContext("06-portal-state");
  const nowAfterStoredDate = new Date("2026-07-17T12:00:00.000Z");

  ctx.scenario("Portail affiche la prochaine livraison projetée");
  ctx.given("DB stocke jeudi 16 juillet alors qu'on est après le 16");
  const projected = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: "2026-07-16",
    now: nowAfterStoredDate,
    preferredDeliveryWeekday: 4,
  });
  ctx.when("le portail calcule la date effective");
  ctx.assertEqual(
    "portal projected delivery is thursday 23",
    projected.effectiveDeliveryDate,
    "2026-07-23",
  );
  const projectedLabel = formatScheduledDeliveryLabel(
    projected.effectiveDeliveryDate,
  );
  ctx.assertEqual(
    "portal delivery label is thursday→saturday window",
    projectedLabel,
    "entre jeudi 23 juillet et samedi 25 juillet",
  );
  ctx.assertTrue(
    "portal delivery label omits Livraison prefix for hero",
    projectedLabel !== null && !projectedLabel.startsWith("Livraison"),
  );

  ctx.scenario("Portail — fenêtre d'affichage dérivée du jeudi métier");
  ctx.given("nextScheduledDeliveryDate reste un jeudi ISO");
  ctx.assertEqual(
    "source thursday unchanged for september window",
    formatScheduledDeliveryLabel("2026-09-10"),
    "entre jeudi 10 septembre et samedi 12 septembre",
  );
  ctx.assertEqual(
    "cross-month display from thursday 30 avril",
    formatScheduledDeliveryLabel("2026-04-30"),
    "entre jeudi 30 avril et samedi 2 mai",
  );
  ctx.assertEqual(
    "cross-year display from thursday 31 décembre",
    formatScheduledDeliveryLabel("2026-12-31"),
    "entre jeudi 31 décembre et samedi 2 janvier",
  );

  ctx.scenario("Portail affiche cutoff cohérent sur date projetée");
  ctx.given("livraison effective jeudi 23");
  const cutoff = getDeliveryCutoffStatus(projected.effectiveDeliveryDate, nowAfterStoredDate);
  ctx.assertTrue("cutoff known for projected delivery", cutoff.isKnown);
  ctx.assertFalse("cutoff still open after first delivery passed", cutoff.isPassed);

  ctx.scenario("Guards serveur cohérents avec UI avant cutoff");
  ctx.given("même sélection côté actions portail");
  ctx.assertNull(
    "server guard allows meal update before projected cutoff",
    getPortalModificationBlockReason(activeSelection(), null, nowAfterStoredDate),
  );

  ctx.scenario("Actions portail — modifier repas");
  ctx.given("4 repas sélectionnés pour une box 4");
  const mealUpdate = validateMealSelection({
    meals: portalMeals,
    mealsCount: 4,
    quantities: {
      "meal-1": 1,
      "meal-2": 1,
      "meal-3": 1,
      "meal-4": 1,
    },
  });
  ctx.assertEqual("portal meal update valid", "titles" in mealUpdate, true);

  ctx.scenario("Actions portail — changement box bloqué après cutoff");
  ctx.given("cutoff passé pour livraison jeudi 16");
  ctx.assertEqual(
    "box change blocked after cutoff",
    getPortalModificationBlockReason(
      activeSelection(),
      null,
      new Date("2026-07-14T00:00:00.000Z"),
    ),
    "cutoff_passed",
  );

  ctx.scenario("Reprise UI — paiement requis si billing dû");
  ctx.given("nextBillingDate dans le passé");
  ctx.when("derivePortalResumeUi évalue le mode");
  const resumeUi = derivePortalResumeUi({
    freshNextBillingDate: new Date("2026-07-01T00:00:00.000Z"),
    localNextBillingDate: new Date("2026-07-01T00:00:00.000Z"),
    recovery: null,
  });
  ctx.assertTrue("resume requires payment when billing due", resumeUi.resumeRequiresPayment);
  ctx.assertTrue(
    "billing due helper matches resume UI",
    isSubscriptionBillingDue(
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z"),
    ),
  );

  ctx.scenario("Reprise UI — reprise simple si billing futur");
  ctx.given("nextBillingDate dans le futur");
  const simpleResume = derivePortalResumeUi({
    freshNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    localNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    recovery: null,
  });
  ctx.assertFalse(
    "resume does not require payment when billing future",
    simpleResume.resumeRequiresPayment,
  );

  return finishSuite("06-portal-state", ctx);
};

process.exitCode = runSuite();
