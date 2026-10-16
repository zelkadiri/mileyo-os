/**
 * Business regression — portal client state and guards coherence.
 */
import {
  derivePortalResumeUi,
  isPortalRecoveryOverdue,
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
  resolveResumeDeliverySchedule,
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

const thursdaySelection = () => ({
  nextScheduledDeliveryDate: "2026-08-27" as string | null,
  preferredDeliveryWeekday: 4,
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

  ctx.scenario("Reprise UI — pause volontaire + NBD stale ne force pas pay_now");
  ctx.given("pause 3 semaines, nextBillingDate passée, recovery=null");
  const stalePast = new Date("2026-07-01T00:00:00.000Z");
  const voluntaryStale = derivePortalResumeUi({
    freshNextBillingDate: stalePast,
    localNextBillingDate: stalePast,
    now: new Date("2026-08-21T10:00:00.000Z"),
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse(
    "voluntary pause with past NBD does not require payment",
    voluntaryStale.resumeRequiresPayment,
  );
  ctx.assertTrue(
    "display next billing is future after schedule resolve",
    (voluntaryStale.resumeDisplayNextBillingDate?.getTime() ?? 0) >
      new Date("2026-08-21T10:00:00.000Z").getTime(),
  );

  ctx.scenario("Reprise UI — locale past + Shopify future → schedule_only UI");
  ctx.given("DB stale, Shopify futur, recovery=null");
  const mixedDates = derivePortalResumeUi({
    freshNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    localNextBillingDate: stalePast,
    now: new Date("2026-08-21T10:00:00.000Z"),
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse(
    "Shopify future + local past does not require payment",
    mixedDates.resumeRequiresPayment,
  );

  ctx.scenario("Reprise UI — Shopify + locale passées hors recovery → pas pay_now");
  const bothPast = derivePortalResumeUi({
    freshNextBillingDate: stalePast,
    localNextBillingDate: stalePast,
    now: new Date("2026-08-21T10:00:00.000Z"),
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse(
    "both past dates without recovery do not require payment",
    bothPast.resumeRequiresPayment,
  );

  ctx.scenario("Reprise UI — recovery overdue + NBD future → pay_now");
  ctx.given("failureCount > 0, nextBillingDate future");
  const recoveryFuture = derivePortalResumeUi({
    freshNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    localNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    recovery: { failureCount: 1, status: "retry_scheduled" },
    selection: thursdaySelection(),
  });
  ctx.assertTrue(
    "recovery overdue requires payment even with future NBD",
    recoveryFuture.resumeRequiresPayment,
  );
  ctx.assertTrue(
    "recovery overdue helper agrees",
    isPortalRecoveryOverdue({ failureCount: 1, status: "retry_scheduled" }),
  );

  ctx.scenario("Reprise UI — recovery overdue + NBD passée → pay_now");
  const recoveryPast = derivePortalResumeUi({
    freshNextBillingDate: stalePast,
    localNextBillingDate: stalePast,
    recovery: { failureCount: 2, status: "final_failed" },
    selection: thursdaySelection(),
  });
  ctx.assertTrue(
    "recovery overdue requires payment with past NBD",
    recoveryPast.resumeRequiresPayment,
  );

  ctx.scenario("Reprise UI — reprise simple si billing futur hors recovery");
  ctx.given("nextBillingDate dans le futur");
  const simpleResume = derivePortalResumeUi({
    freshNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    localNextBillingDate: new Date("2099-01-01T00:00:00.000Z"),
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse(
    "resume does not require payment when billing future",
    simpleResume.resumeRequiresPayment,
  );

  ctx.scenario("Reprise schedule — vendredi NBD samedi lendemain conservé");
  ctx.given("vendredi 21 août, livraison 27, NBD samedi 22");
  const fridayNow = new Date("2026-08-21T08:00:00.000Z");
  const saturdayBilling = new Date("2026-08-21T22:05:00.000Z");
  const fridayResume = resolveResumeDeliverySchedule({
    existingNextBillingDate: saturdayBilling,
    mode: "schedule_only",
    now: fridayNow,
    selection: thursdaySelection(),
  });
  const fridayUi = derivePortalResumeUi({
    freshNextBillingDate: saturdayBilling,
    localNextBillingDate: saturdayBilling,
    now: fridayNow,
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse("friday future Saturday is schedule_only UI", fridayUi.resumeRequiresPayment);
  ctx.assertEqual(
    "friday keeps Saturday 22 billing",
    fridayResume?.alignedNextBillingDate.toISOString(),
    saturdayBilling.toISOString(),
  );

  ctx.scenario("Reprise schedule — mardi après cutoff + NBD stale");
  ctx.given("mardi 25 août après cutoff lundi 24, NBD passé");
  const tuesdayAfterCutoff = new Date("2026-08-25T10:00:00.000Z");
  const afterCutoff = resolveResumeDeliverySchedule({
    existingNextBillingDate: stalePast,
    mode: "schedule_only",
    now: tuesdayAfterCutoff,
    selection: thursdaySelection(),
  });
  const afterCutoffUi = derivePortalResumeUi({
    freshNextBillingDate: stalePast,
    localNextBillingDate: stalePast,
    now: tuesdayAfterCutoff,
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse("after cutoff voluntary is not pay_now", afterCutoffUi.resumeRequiresPayment);
  ctx.assertEqual(
    "after cutoff skips to next Thursday",
    afterCutoff?.resumeTargetDeliveryDate,
    "2026-09-03",
  );
  ctx.assertTrue(
    "after cutoff billing stays in the future",
    (afterCutoff?.alignedNextBillingDate.getTime() ?? 0) >
      tuesdayAfterCutoff.getTime(),
  );

  ctx.scenario("Reprise schedule — samedi avant/après 00:05 hors recovery");
  const saturdayBefore = new Date("2026-08-21T22:00:00.000Z");
  const saturdayAfter = new Date("2026-08-21T22:10:00.000Z");
  const beforeUi = derivePortalResumeUi({
    freshNextBillingDate: saturdayBilling,
    localNextBillingDate: saturdayBilling,
    now: saturdayBefore,
    recovery: null,
    selection: thursdaySelection(),
  });
  const afterUi = derivePortalResumeUi({
    freshNextBillingDate: saturdayBilling,
    localNextBillingDate: saturdayBilling,
    now: saturdayAfter,
    recovery: null,
    selection: thursdaySelection(),
  });
  ctx.assertFalse("Saturday before 00:05 is not pay_now", beforeUi.resumeRequiresPayment);
  ctx.assertFalse(
    "Saturday after 00:05 voluntary pause is not pay_now solely because slot passed",
    afterUi.resumeRequiresPayment,
  );
  const afterSchedule = resolveResumeDeliverySchedule({
    existingNextBillingDate: saturdayBilling,
    mode: "schedule_only",
    now: saturdayAfter,
    selection: thursdaySelection(),
  });
  ctx.assertTrue(
    "Saturday after 00:05 realigns to a future billing slot",
    (afterSchedule?.alignedNextBillingDate.getTime() ?? 0) >
      saturdayAfter.getTime(),
  );

  return finishSuite("06-portal-state", ctx);
};

process.exitCode = runSuite();
