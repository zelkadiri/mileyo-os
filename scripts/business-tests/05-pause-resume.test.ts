/**
 * Business regression — pause and resume flows.
 */
import { SUBSCRIPTION_SELECTION_STATUS } from "../../app/constants/subscriptionMealSelection";
import { DELIVERY_TIMEZONE } from "../../app/constants/deliverySchedule";
import { RECOVERY_STATUS } from "../../app/constants/subscriptionPaymentRecovery";
import {
  getPortalModificationBlockReason,
} from "../../app/services/subscriptionModificationBlock.server";
import {
  calculateNextBillingDateFromPolicy,
  RESUME_LOCK_STATUS,
} from "../../app/services/subscriptionBillingWorker.server";
import { resolveResumeDeliverySchedule } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const parisInstant = (date: string, hour: number, minute: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const target = { day, hour, minute, month, second: 0, year };

  const readParis = (instant: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: DELIVERY_TIMEZONE,
      year: "numeric",
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    return {
      day: read("day"),
      hour: read("hour"),
      minute: read("minute"),
      month: read("month"),
      second: read("second"),
      year: read("year"),
    };
  };

  const compare = (
    left: typeof target,
    right: typeof target,
  ) => {
    for (const key of ["year", "month", "day", "hour", "minute", "second"] as const) {
      if (left[key] !== right[key]) {
        return left[key] - right[key];
      }
    }

    return 0;
  };

  const base = Date.UTC(year, month - 1, day);
  let lo = base - 24 * 60 * 60 * 1000;
  let hi = base + 48 * 60 * 60 * 1000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const paris = readParis(new Date(mid));

    if (compare(paris, target) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return new Date(lo);
};

const activeSelection = () => ({
  active: true,
  lastBillingAttemptAt: null as Date | null,
  lastBillingAttemptStatus: null as string | null,
  nextScheduledDeliveryDate: "2026-07-23" as string | null,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null as string | null,
  resumeAttemptStatus: null as string | null,
  status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  subscriptionContractId: "gid://shopify/SubscriptionContract/123",
});

const runSuite = () => {
  const ctx = createBusinessTestContext("05-pause-resume");
  const mondayBeforeCutoff = parisInstant("2026-07-20", 10, 0);
  const tuesdayAfterCutoff = parisInstant("2026-07-21", 12, 0);

  ctx.scenario("Pause avant cutoff — autorisée côté guard");
  ctx.given("livraison jeudi 23, lundi 20 juillet 10h");
  ctx.assertNull(
    "pause allowed before cutoff",
    getPortalModificationBlockReason(
      activeSelection(),
      null,
      mondayBeforeCutoff,
      "subscription_control",
    ),
  );

  ctx.scenario("Après cutoff — plats bloqués, pause/reprise autorisées");
  ctx.given("cutoff livraison jeudi 23 déjà passé");
  ctx.assertEqual(
    "meal change blocked after cutoff",
    getPortalModificationBlockReason(
      activeSelection(),
      null,
      tuesdayAfterCutoff,
      "modification",
    ),
    "cutoff_passed",
  );
  ctx.assertNull(
    "pause allowed after cutoff",
    getPortalModificationBlockReason(
      activeSelection(),
      null,
      tuesdayAfterCutoff,
      "subscription_control",
    ),
  );
  ctx.assertNull(
    "resume allowed after cutoff",
    getPortalModificationBlockReason(
      {
        ...activeSelection(),
        active: false,
        status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
      },
      null,
      tuesdayAfterCutoff,
      "subscription_control",
    ),
  );
  ctx.assertEqual(
    "cutoff alone still blocks modification DTO path",
    getPortalModificationBlockReason(
      activeSelection(),
      null,
      tuesdayAfterCutoff,
      "modification",
    ) !== null &&
      getPortalModificationBlockReason(
        activeSelection(),
        null,
        tuesdayAfterCutoff,
        "subscription_control",
      ) === null,
    true,
  );

  ctx.scenario("Locks transactionnels — pause toujours bloquée");
  ctx.given("cutoff passé + état billing/recovery/resume/missing contract");
  ctx.assertEqual(
    "pause blocked by billing_processing after cutoff",
    getPortalModificationBlockReason(
      {
        ...activeSelection(),
        lastBillingAttemptAt: new Date(),
        lastBillingAttemptStatus: "submitted",
      },
      null,
      tuesdayAfterCutoff,
      "subscription_control",
    ),
    "billing_processing",
  );
  ctx.assertEqual(
    "pause blocked by recovery_processing after cutoff",
    getPortalModificationBlockReason(
      activeSelection(),
      { status: RECOVERY_STATUS.PROCESSING },
      tuesdayAfterCutoff,
      "subscription_control",
    ),
    "recovery_processing",
  );
  ctx.assertEqual(
    "pause blocked by resume_processing",
    getPortalModificationBlockReason(
      {
        ...activeSelection(),
        resumeAttemptOrderId: null,
        resumeAttemptStatus: RESUME_LOCK_STATUS.PROCESSING,
      },
      null,
      tuesdayAfterCutoff,
      "subscription_control",
    ),
    "resume_processing",
  );
  ctx.assertEqual(
    "pause blocked by missing_contract",
    getPortalModificationBlockReason(
      {
        ...activeSelection(),
        subscriptionContractId: null,
      },
      null,
      tuesdayAfterCutoff,
      "subscription_control",
    ),
    "missing_contract",
  );

  ctx.scenario("Reprise simple avant cutoff");
  ctx.given("reprise lundi 20 juillet avant cutoff jeudi 23");
  const scheduleOnly = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: mondayBeforeCutoff,
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "schedule-only resume targets current week delivery",
    scheduleOnly?.resumeTargetDeliveryDate,
    "2026-07-23",
  );
  ctx.assertEqual(
    "schedule-only resume billing is Saturday cycle of the target delivery or next cycle",
    scheduleOnly?.alignedNextBillingDate.toISOString(),
    "2026-07-24T22:05:00.000Z",
  );

  ctx.scenario("Reprise simple après cutoff");
  ctx.given("reprise mardi 21 juillet");
  const scheduleAfterCutoff = resolveResumeDeliverySchedule({
    mode: "schedule_only",
    now: tuesdayAfterCutoff,
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "schedule-only resume after cutoff jumps to next week",
    scheduleAfterCutoff?.resumeTargetDeliveryDate,
    "2026-07-30",
  );

  ctx.scenario("Reprise avec paiement immédiat avant cutoff");
  ctx.given("paiement couvre livraison jeudi 23");
  const payNowBefore = resolveResumeDeliverySchedule({
    mode: "immediate_payment",
    now: mondayBeforeCutoff,
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "immediate payment covers active delivery",
    payNowBefore?.resumeTargetDeliveryDate,
    "2026-07-23",
  );
  ctx.assertEqual(
    "immediate payment billing targets following Saturday cycle",
    payNowBefore?.alignedNextBillingDate.toISOString(),
    "2026-07-24T22:05:00.000Z",
  );

  ctx.scenario("Reprise avec paiement immédiat après cutoff");
  ctx.given("paiement couvre semaine suivante");
  const payNowAfter = resolveResumeDeliverySchedule({
    mode: "immediate_payment",
    now: tuesdayAfterCutoff,
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "immediate payment after cutoff covers next week",
    payNowAfter?.resumeTargetDeliveryDate,
    "2026-07-30",
  );
  ctx.assertEqual(
    "immediate payment after cutoff bills Saturday of week after target",
    payNowAfter?.alignedNextBillingDate.toISOString(),
    "2026-07-31T22:05:00.000Z",
  );

  ctx.scenario("Ancienne logique paymentAt + 7 absente du flow actif");
  ctx.given("policy Shopify +7 depuis date de paiement");
  const legacyBilling = calculateNextBillingDateFromPolicy(tuesdayAfterCutoff, {
    interval: "WEEK",
    intervalCount: 1,
  });
  ctx.assertEqual(
    "resume delivery schedule differs from legacy +7",
    payNowAfter?.alignedNextBillingDate.toISOString() ===
      legacyBilling.toISOString(),
    false,
  );

  ctx.scenario("Pause volontaire multi-semaines — NBD stale → schedule_only");
  ctx.given("reprise mardi 21 juillet après 3 semaines, NBD passé, recovery=null");
  const staleBilling = parisInstant("2026-06-28", 0, 5);
  const voluntaryMultiWeek = resolveResumeDeliverySchedule({
    existingNextBillingDate: staleBilling,
    mode: "schedule_only",
    now: tuesdayAfterCutoff,
    selection: {
      nextScheduledDeliveryDate: "2026-07-16",
      preferredDeliveryWeekday: 4,
    },
  });
  ctx.assertEqual(
    "voluntary multi-week resume skips cutoff-passed delivery",
    voluntaryMultiWeek?.resumeTargetDeliveryDate,
    "2026-07-30",
  );
  ctx.assertTrue(
    "voluntary multi-week resume writes a future Saturday",
    (voluntaryMultiWeek?.alignedNextBillingDate.getTime() ?? 0) >
      tuesdayAfterCutoff.getTime(),
  );
  ctx.assertEqual(
    "voluntary multi-week next billing is Saturday that pays target delivery",
    voluntaryMultiWeek?.alignedNextBillingDate.toISOString(),
    "2026-07-24T22:05:00.000Z",
  );

  ctx.scenario("Pause avec données invalides — fail-safe");
  ctx.given("date livraison invalide");
  ctx.assertNull(
    "invalid delivery does not crash pause guard",
    getPortalModificationBlockReason(
      {
        ...activeSelection(),
        nextScheduledDeliveryDate: "2026-99-99",
      },
      null,
      mondayBeforeCutoff,
      "subscription_control",
    ),
  );

  return finishSuite("05-pause-resume", ctx);
};

process.exitCode = runSuite();
