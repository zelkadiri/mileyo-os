/**
 * Business regression — schedule-only portal resume must be fail-closed.
 *
 * A partial resume (activate ok, align fail) must never leave an old
 * nextBillingDate billable. Covers T1–T12 for the resume calendar gate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  completePortalScheduledResume,
  derivePortalResumeUi,
  isPortalRecoveryOverdue,
  PORTAL_SCHEDULED_RESUME_CALENDAR_UNSECURED_ERROR,
  PORTAL_SCHEDULED_RESUME_DB_SYNC_FAILED_ERROR,
  PORTAL_SCHEDULED_RESUME_ROLLBACK_FAILED_ERROR,
} from "../../app/features/portal/portal-resume.server";
import { getSelectionSkipReason } from "../../app/services/subscriptionBillingWorker.server";
import {
  parseDeliveryDate,
  resolveResumeDeliverySchedule,
  type DeliveryDateString,
  type ResumeDeliveryScheduleResolution,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const requireDate = (value: string): DeliveryDateString => {
  const parsed = parseDeliveryDate(value);
  if (!parsed) {
    throw new Error(`Invalid fixture date: ${value}`);
  }
  return parsed;
};

const futureAligned = new Date("2026-11-21T23:05:00.000Z");
const pastAligned = new Date("2026-10-31T23:05:00.000Z");
const now = new Date("2026-11-11T10:00:00.000Z");

const resumeSchedule: ResumeDeliveryScheduleResolution = {
  alignedNextBillingDate: futureAligned,
  nextDeliveryAfterResume: requireDate("2026-11-27"),
  resumeTargetDeliveryDate: requireDate("2026-11-20"),
};

const admin = { graphql: async () => new Response("{}") };

const runSuite = async () => {
  const ctx = createBusinessTestContext("120-portal-resume-failclosed");
  const source = readRepoFile("app/features/portal/portal-resume.server.ts");
  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );

  ctx.scenario("Source — ordre fail-closed activate → align → active");
  const activateIdx = source.indexOf("const activateResult = await activate(");
  const alignIdx = source.indexOf("const alignmentResult = await align(");
  const calendarGateIdx = source.indexOf("const calendarSecured =");
  const markActiveIdx = source.indexOf("await markSelectionActive(");
  const pauseRollbackIdx = source.indexOf("const pauseResult = await pause(");
  ctx.assertTrue("activate before align", activateIdx > 0 && activateIdx < alignIdx);
  ctx.assertTrue(
    "calendar gate before mark active",
    calendarGateIdx > alignIdx && calendarGateIdx < markActiveIdx,
  );
  ctx.assertTrue(
    "pause rollback before mark active",
    pauseRollbackIdx > calendarGateIdx && pauseRollbackIdx < markActiveIdx,
  );
  ctx.assertTrue(
    "failed align path no longer marks active:true",
    !source.includes(
      'Votre abonnement est repris, mais la date de prochaine facturation n’a pas pu être mise à jour automatiquement.',
    ),
  );
  ctx.assertTrue(
    "skipped align is not treated as success",
    source.includes('alignmentResult.status === "skipped"') ||
      source.includes('alignStatus: alignmentResult.status'),
  );
  ctx.assertTrue(
    "pauseSubscriptionContractOnShopify imported for rollback",
    source.includes("pauseSubscriptionContractOnShopify"),
  );

  ctx.scenario("T1. Reprise normale — PASS");
  {
    const calls: string[] = [];
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => {
          calls.push("activate");
          return { ok: true as const, shopifyStatus: "ACTIVE" };
        },
        align: async () => {
          calls.push("align");
          return {
            alignedNextBillingDate: futureAligned,
            nextDeliveryAfterResume: requireDate("2026-11-27"),
            previousNextBillingDate: pastAligned,
            resumeTargetDeliveryDate: requireDate("2026-11-20"),
            status: "aligned" as const,
          };
        },
        pause: async () => {
          calls.push("pause");
          return {};
        },
        markSelectionActive: async () => {
          calls.push("markActive");
        },
        ensureSelectionPaused: async () => {
          calls.push("ensurePaused");
        },
        resetPausedEmail: async () => {
          calls.push("resetEmail");
        },
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-ok",
      subscriptionContractId: "26577011016",
    });
    ctx.assertEqual("T1 ok", result.ok, true);
    ctx.assertEqual("T1 call order", calls.join(">"), "activate>align>markActive>resetEmail");
    ctx.assertFalse("T1 no pause", calls.includes("pause"));
  }

  ctx.scenario("T2. NBD ancienne — réalignée correctement (schedule helper)");
  {
    const schedule = resolveResumeDeliverySchedule({
      existingNextBillingDate: pastAligned,
      mode: "schedule_only",
      now,
      selection: {
        nextScheduledDeliveryDate: "2026-11-13",
        preferredDeliveryWeekday: 4,
      },
    });
    ctx.assertTrue("T2 schedule computed", schedule != null);
    ctx.assertTrue(
      "T2 aligned NBD is future",
      (schedule?.alignedNextBillingDate.getTime() ?? 0) > now.getTime(),
    );
    ctx.assertTrue(
      "T2 does not keep past NBD",
      schedule?.alignedNextBillingDate.toISOString() !== pastAligned.toISOString(),
    );
  }

  ctx.scenario("T3. Échec Shopify Activate");
  {
    const calls: string[] = [];
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => {
          calls.push("activate");
          return {
            error: "activation failed",
            ok: false as const,
            shopifyStatus: "PAUSED",
          };
        },
        align: async () => {
          calls.push("align");
          return { error: "should-not-run", status: "failed" as const };
        },
        pause: async () => {
          calls.push("pause");
          return {};
        },
        markSelectionActive: async () => {
          calls.push("markActive");
        },
        ensureSelectionPaused: async () => {
          calls.push("ensurePaused");
        },
        resetPausedEmail: async () => {
          calls.push("resetEmail");
        },
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-activate-fail",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T3 ok false", result.ok, false);
    ctx.assertEqual("T3 only activate", calls.join(">"), "activate");
    ctx.assertEqual(
      "T3 error",
      !result.ok ? result.error : null,
      "activation failed",
    );
  }

  ctx.scenario("T4. Activate ok puis alignement échoué → rollback pause");
  {
    const calls: string[] = [];
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => {
          calls.push("activate");
          return { ok: true as const, shopifyStatus: "ACTIVE" };
        },
        align: async () => {
          calls.push("align");
          return { error: "draft commit failed", status: "failed" as const };
        },
        pause: async () => {
          calls.push("pause");
          return {};
        },
        markSelectionActive: async () => {
          calls.push("markActive");
        },
        ensureSelectionPaused: async () => {
          calls.push("ensurePaused");
        },
        resetPausedEmail: async () => {
          calls.push("resetEmail");
        },
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-align-fail",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T4 ok false", result.ok, false);
    ctx.assertEqual(
      "T4 call order",
      calls.join(">"),
      "activate>align>pause>ensurePaused",
    );
    ctx.assertEqual(
      "T4 error",
      !result.ok ? result.error : null,
      PORTAL_SCHEDULED_RESUME_CALENDAR_UNSECURED_ERROR,
    );
  }

  ctx.scenario("T4b. Align skipped → même rollback fail-closed");
  {
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => ({ ok: true as const, shopifyStatus: "ACTIVE" }),
        align: async () => ({
          reason: "missing_resume_delivery_schedule",
          status: "skipped" as const,
        }),
        pause: async () => ({}),
        markSelectionActive: async () => {
          throw new Error("must not mark active");
        },
        ensureSelectionPaused: async () => undefined,
        resetPausedEmail: async () => undefined,
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-align-skip",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T4b ok false", result.ok, false);
    ctx.assertEqual(
      "T4b error",
      !result.ok ? result.error : null,
      PORTAL_SCHEDULED_RESUME_CALENDAR_UNSECURED_ERROR,
    );
  }

  ctx.scenario("T4c. Align returns past NBD → rollback");
  {
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => ({ ok: true as const, shopifyStatus: "ACTIVE" }),
        align: async () => ({
          alignedNextBillingDate: pastAligned,
          nextDeliveryAfterResume: requireDate("2026-11-06"),
          previousNextBillingDate: pastAligned,
          resumeTargetDeliveryDate: requireDate("2026-11-06"),
          status: "aligned" as const,
        }),
        pause: async () => ({}),
        markSelectionActive: async () => {
          throw new Error("must not mark active on past NBD");
        },
        ensureSelectionPaused: async () => undefined,
        resetPausedEmail: async () => undefined,
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-past-nbd",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T4c ok false", result.ok, false);
  }

  ctx.scenario("T4d. Pause rollback échoue → erreur critique");
  {
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => ({ ok: true as const, shopifyStatus: "ACTIVE" }),
        align: async () => ({ error: "align boom", status: "failed" as const }),
        pause: async () => ({ error: "pause boom" }),
        markSelectionActive: async () => {
          throw new Error("must not mark active");
        },
        ensureSelectionPaused: async () => undefined,
        resetPausedEmail: async () => undefined,
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-rollback-fail",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T4d ok false", result.ok, false);
    ctx.assertEqual(
      "T4d critical error",
      !result.ok ? result.error : null,
      PORTAL_SCHEDULED_RESUME_ROLLBACK_FAILED_ERROR,
    );
  }

  ctx.scenario("T5. Échec synchronisation DB après calendrier sécurisé");
  {
    const calls: string[] = [];
    const result = await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => {
          calls.push("activate");
          return { ok: true as const, shopifyStatus: "ACTIVE" };
        },
        align: async () => {
          calls.push("align");
          return {
            alignedNextBillingDate: futureAligned,
            nextDeliveryAfterResume: requireDate("2026-11-27"),
            previousNextBillingDate: pastAligned,
            resumeTargetDeliveryDate: requireDate("2026-11-20"),
            status: "aligned" as const,
          };
        },
        pause: async () => {
          calls.push("pause");
          return {};
        },
        markSelectionActive: async () => {
          calls.push("markActive");
          throw new Error("db write failed");
        },
        ensureSelectionPaused: async () => {
          calls.push("ensurePaused");
        },
        resetPausedEmail: async () => {
          calls.push("resetEmail");
        },
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-db-fail",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T5 ok false", result.ok, false);
    ctx.assertEqual("T5 no pause of secured calendar", calls.includes("pause"), false);
    ctx.assertEqual(
      "T5 error",
      !result.ok ? result.error : null,
      PORTAL_SCHEDULED_RESUME_DB_SYNC_FAILED_ERROR,
    );
  }

  ctx.scenario("T6. Cron ne prélève pas une ancienne échéance si DB paused");
  {
    const skip = getSelectionSkipReason(
      {
        active: false,
        lastBillingAttemptAt: null,
        lastBillingAttemptStatus: null,
        nextBillingDate: pastAligned,
        nextScheduledDeliveryDate: "2026-11-06",
        preferredDeliveryWeekday: 4,
        resumeAttemptKey: null,
        resumeAttemptOrderId: null,
        resumeAttemptStartedAt: null,
        resumeAttemptStatus: null,
        status: "paused",
        subscriptionContractId: "1",
      },
      null,
      now,
    );
    ctx.assertEqual("T6 cron skip", skip, "paused_or_inactive");
  }

  ctx.scenario("T7. Aucun doublon — une seule activation sur succès");
  {
    let activateCount = 0;
    await completePortalScheduledResume({
      admin,
      deps: {
        activate: async () => {
          activateCount += 1;
          return { ok: true as const, shopifyStatus: "ACTIVE" };
        },
        align: async () => ({
          alignedNextBillingDate: futureAligned,
          nextDeliveryAfterResume: requireDate("2026-11-27"),
          previousNextBillingDate: pastAligned,
          resumeTargetDeliveryDate: requireDate("2026-11-20"),
          status: "aligned" as const,
        }),
        pause: async () => ({}),
        markSelectionActive: async () => undefined,
        ensureSelectionPaused: async () => undefined,
        resetPausedEmail: async () => undefined,
        now: () => now,
      },
      resumeSchedule,
      selectionId: "sel-once",
      subscriptionContractId: "1",
    });
    ctx.assertEqual("T7 single activate", activateCount, 1);
  }

  ctx.scenario("T8. Aucune reprise automatique d’un PAUSED");
  ctx.assertFalse(
    "T8 no auto activate outside completePortalScheduledResume schedule_only",
    /subscriptionContractActivate/.test(
      source.slice(0, source.indexOf("completePortalScheduledResume")),
    ),
  );
  ctx.assertTrue(
    "T8 portal actions still route schedule_only through completePortalScheduledResume",
    portalActionsSource.includes("completePortalScheduledResume"),
  );

  ctx.scenario("T9. Recovery finale préservée (pay_now, pas schedule_only)");
  ctx.assertTrue(
    "T9 final_failed is overdue recovery",
    isPortalRecoveryOverdue({ failureCount: 3, status: "final_failed" }),
  );
  const ui = derivePortalResumeUi({
    localNextBillingDate: pastAligned,
    now,
    recovery: { failureCount: 3, status: "final_failed" },
  });
  ctx.assertTrue("T9 pay_now UI", ui.resumeRequiresPayment);
  ctx.assertFalse(
    "T9 schedule_only path does not clear recovery tables",
    source.includes("subscriptionPaymentRecovery"),
  );

  ctx.scenario("T10. Remises Shopify préservées");
  ctx.assertFalse(
    "T10 no discount mutation in resume complete",
    /discount|Discount/.test(
      source.slice(source.indexOf("completePortalScheduledResume")),
    ),
  );
  ctx.assertFalse(
    "T10 worker pause helper does not touch discounts",
    workerSource.includes("pauseSubscriptionContractOnShopify") &&
      /pauseSubscriptionContractOnShopify[\s\S]{0,800}discount/i.test(
        workerSource,
      ) === false
      ? false
      : /subscriptionDiscount/.test(
          workerSource.slice(
            workerSource.indexOf("export const pauseSubscriptionContractOnShopify"),
            workerSource.indexOf("export const pauseSubscriptionContractOnShopify") +
              800,
          ),
        ),
  );

  ctx.scenario("T11. Pause / reprise portail fonctionnelles (contrat source)");
  ctx.assertTrue(
    "T11 pause action still present",
    portalActionsSource.includes("handlePauseSubscriptionAction"),
  );
  ctx.assertTrue(
    "T11 resume action still present",
    portalActionsSource.includes("handleResumeSubscriptionAction") ||
      portalActionsSource.includes("resumeSubscription"),
  );
  ctx.assertTrue(
    "T11 success path still resets paused email",
    source.includes("resetPausedEmail") ||
      source.includes("resetSubscriptionPausedEmailSentAt"),
  );

  ctx.scenario("T12. Abonnements normaux non affectés (cron active path)");
  {
    const skipActiveFuture = getSelectionSkipReason(
      {
        active: true,
        lastBillingAttemptAt: null,
        lastBillingAttemptStatus: null,
        nextBillingDate: futureAligned,
        nextScheduledDeliveryDate: "2026-11-20",
        preferredDeliveryWeekday: 4,
        resumeAttemptKey: null,
        resumeAttemptOrderId: null,
        resumeAttemptStartedAt: null,
        resumeAttemptStatus: null,
        status: "active",
        subscriptionContractId: "1",
      },
      null,
      now,
    );
    ctx.assertEqual(
      "T12 future active still skipped as next_billing_date_in_future",
      skipActiveFuture,
      "next_billing_date_in_future",
    );
  }

  return finishSuite("120-portal-resume-failclosed", ctx);
};

process.exit(await runSuite());
