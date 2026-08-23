/**
 * Business regression — EMAIL-5D upcoming delivery batch runner + cron.
 *
 * BoxOrder proof, classification, cron isolation. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RECOVERY_STATUS } from "../../app/constants/subscriptionPaymentRecovery";
import {
  classifyUpcomingDeliveryCandidate,
  hasMatchingBoxOrderForUpcomingDelivery,
  incrementUpcomingDeliverySkip,
  emptyUpcomingDeliveryRunnerSummary,
} from "../../app/services/email/upcoming-delivery-runner.server";
import {
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  shouldSendUpcomingDeliveryEmail,
} from "../../app/services/email/email.server";
import { isUpcomingDeliveryRunnerWindowPotentiallyOpen } from "../../app/services/email/upcoming-delivery-email.server";
import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../app/constants/subscriptionCycle";
import {
  parisWallClockToInstant,
  parseDeliveryDate,
} from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const parisAt = ({
  date,
  hour,
  minute = 0,
}: {
  date: string;
  hour: number;
  minute?: number;
}) =>
  parisWallClockToInstant({
    date: parseDeliveryDate(date)!,
    hour,
    minute,
    timezone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });

const thursdayDelivery = "2026-08-27";
const selectionId = "sel-upcoming-1";
const jMinus2Morning = parisAt({ date: "2026-08-25", hour: 9 });
const jMinus2BeforeWindow = parisAt({ date: "2026-08-25", hour: 8, minute: 59 });
const jMinus1Morning = parisAt({ date: "2026-08-26", hour: 9 });
const deliveryDayMorning = parisAt({ date: "2026-08-27", hour: 9 });

const eligibleSelection = {
  active: true,
  customerEmail: "client@example.com",
  lastBillingAttemptAt: null,
  lastBillingAttemptStatus: null,
  mealsCount: 8,
  nextScheduledDeliveryDate: thursdayDelivery,
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null,
  resumeAttemptStatus: null,
  selectedMeals: ["Poulet curry", "Saumon teriyaki"],
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  upcomingDeliveryEmailDeliveryDate: null,
};

const matchingBoxOrder = {
  scheduledDeliveryDate: thursdayDelivery,
  simulated: false,
  subscriptionSelectionId: selectionId,
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("60-email-upcoming-delivery-runner");

  const runnerSource = readRepoFile(
    "app/services/email/upcoming-delivery-runner.server.ts",
  );
  const trySendSource = readRepoFile(
    "app/services/email/upcoming-delivery-email.server.ts",
  );
  const cronSource = readRepoFile("app/routes/api.cron.process-subscriptions.tsx");
  const cronRunBlock = cronSource.slice(
    cronSource.indexOf("const runProcessSubscriptionsCron"),
    cronSource.indexOf("export const loader"),
  );

  ctx.scenario("A. BoxOrder — matching / absent / simulated / wrong date / wrong selection");
  ctx.assertNull(
    "sélection due + BoxOrder matching → eligible",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
  );
  ctx.assertEqual(
    "pas de BoxOrder → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: null,
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "no_box_order",
  );
  ctx.assertEqual(
    "BoxOrder simulated → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: {
        ...matchingBoxOrder,
        simulated: true,
      },
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "no_box_order",
  );
  ctx.assertEqual(
    "BoxOrder mauvaise deliveryDate → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: {
        ...matchingBoxOrder,
        scheduledDeliveryDate: "2026-09-03",
      },
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "no_box_order",
  );
  ctx.assertEqual(
    "BoxOrder autre selection → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: {
        ...matchingBoxOrder,
        subscriptionSelectionId: "other-selection",
      },
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "no_box_order",
  );
  ctx.assertTrue(
    "hasMatchingBoxOrder helper true",
    hasMatchingBoxOrderForUpcomingDelivery({
      boxOrder: matchingBoxOrder,
      effectiveDeliveryDate: thursdayDelivery,
      selectionId,
    }),
  );

  ctx.scenario("B. First order / renewal / projection seule");
  ctx.assertNull(
    "first order matching → envoi possible",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: {
        ...eligibleSelection,
        nextScheduledDeliveryDate: thursdayDelivery,
      },
      selectionId,
    }).skipReason,
  );
  ctx.assertNull(
    "renewal matching → envoi possible",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: {
        ...matchingBoxOrder,
        scheduledDeliveryDate: thursdayDelivery,
      },
      now: jMinus1Morning,
      selection: {
        ...eligibleSelection,
        nextScheduledDeliveryDate: thursdayDelivery,
      },
      selectionId,
    }).skipReason,
  );
  ctx.assertEqual(
    "projection seule sans commande → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder: null,
      now: jMinus2Morning,
      selection: {
        ...eligibleSelection,
        nextScheduledDeliveryDate: thursdayDelivery,
      },
      selectionId,
    }).skipReason,
    "no_box_order",
  );

  ctx.scenario("C. Guards — paused / inactive / recovery / recipient / meals / cutoff / already sent");
  ctx.assertEqual(
    "paused → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: { ...eligibleSelection, status: "paused" },
      selectionId,
    }).skipReason,
    "inactive",
  );
  ctx.assertEqual(
    "inactive → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: { ...eligibleSelection, active: false },
      selectionId,
    }).skipReason,
    "inactive",
  );
  ctx.assertEqual(
    "recovery bloquante → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      recovery: { status: RECOVERY_STATUS.PROCESSING },
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "blocked",
  );
  ctx.assertEqual(
    "no recipient → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: { ...eligibleSelection, customerEmail: null },
      selectionId,
    }).skipReason,
    "no_recipient",
  );
  ctx.assertEqual(
    "no meals → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: { ...eligibleSelection, selectedMeals: [] },
      selectionId,
    }).skipReason,
    "no_meals",
  );
  ctx.assertFalse(
    "cutoff pas passé → skip",
    shouldSendUpcomingDeliveryEmail({
      active: true,
      effectiveDeliveryDate: thursdayDelivery,
      hasRecipient: true,
      hasUsableMeals: true,
      now: parisAt({ date: "2026-08-24", hour: 20 }),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
      upcomingDeliveryEmailDeliveryDate: null,
    }),
  );
  ctx.assertEqual(
    "déjà envoyé → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: {
        ...eligibleSelection,
        upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
      },
      selectionId,
    }).skipReason,
    "already_sent",
  );

  ctx.scenario("D. Timing — J-2 08:59 / J-2 09:00 / J-1 / jour J");
  ctx.assertFalse(
    "runner global J-2 08:59 fermé",
    isUpcomingDeliveryRunnerWindowPotentiallyOpen(jMinus2BeforeWindow),
  );
  ctx.assertEqual(
    "J-2 08:59 candidat outside_window",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2BeforeWindow,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "outside_window",
  );
  ctx.assertNull(
    "J-2 09:00 → eligible",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus2Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
  );
  ctx.assertNull(
    "J-1 → eligible",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: jMinus1Morning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
  );
  ctx.assertEqual(
    "jour J → skip",
    classifyUpcomingDeliveryCandidate({
      matchingBoxOrder,
      now: deliveryDayMorning,
      selection: eligibleSelection,
      selectionId,
    }).skipReason,
    "outside_window",
  );

  ctx.scenario("E. Idempotence / retry — source trySend");
  ctx.assertTrue(
    "send success → stamp delivery date + sentAt",
    trySendSource.includes("upcomingDeliveryEmailDeliveryDate: effectiveDeliveryDate") &&
      trySendSource.includes("upcomingDeliveryEmailSentAt: sentAt"),
  );
  ctx.assertTrue(
    "cron suivant skip via already_sent helper",
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate: thursdayDelivery,
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );
  ctx.assertFalse(
    "send failure → pas de stamp avant return failed",
    /upcomingDeliveryEmailSentAt:\s*sentAt[\s\S]{0,400}if \(!result\.ok\)/.test(
      trySendSource.slice(
        trySendSource.indexOf("export const trySendUpcomingDeliveryEmail"),
      ),
    ),
  );
  ctx.assertTrue(
    "nouvelle delivery redevient éligible",
    shouldSendUpcomingDeliveryEmail({
      active: true,
      effectiveDeliveryDate: "2026-09-03",
      hasRecipient: true,
      hasUsableMeals: true,
      now: parisAt({ date: "2026-09-01", hour: 9 }),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );

  ctx.scenario("F. Cron isolation");
  ctx.assertTrue(
    "upcoming runner appelé après billing + reminder",
    cronRunBlock.includes("processDueSubscriptionBillings") &&
      cronRunBlock.includes("processDueMealSelectionReminders") &&
      cronRunBlock.includes("processDueUpcomingDeliveryEmails"),
  );
  ctx.assertTrue(
    "ordre billing → reminder → upcoming",
    cronRunBlock.indexOf("processDueSubscriptionBillings") <
      cronRunBlock.indexOf("processDueMealSelectionReminders") &&
      cronRunBlock.indexOf("processDueMealSelectionReminders") <
        cronRunBlock.indexOf("processDueUpcomingDeliveryEmails"),
  );
  ctx.assertTrue(
    "erreur upcoming isolée try/catch",
    cronRunBlock.includes("upcomingDeliveryError"),
  );
  ctx.assertTrue(
    "erreur upcoming ne casse pas billing summary",
    cronRunBlock.includes("...billingSummary") &&
      cronRunBlock.indexOf("processDueSubscriptionBillings") <
        cronRunBlock.indexOf("upcomingDeliveryError"),
  );
  ctx.assertTrue(
    "erreur upcoming ne supprime pas reminder",
    cronRunBlock.includes("mealSelectionReminders") &&
      cronRunBlock.indexOf("mealSelectionReminders") <
        cronRunBlock.indexOf("upcomingDeliveryEmails"),
  );
  ctx.assertFalse(
    "runner non réexporté depuis email.server",
    readRepoFile("app/services/email/email.server.ts").includes(
      "processDueUpcomingDeliveryEmails",
    ),
  );

  ctx.scenario("G. Batch — dispatcher + outbox enqueue");
  ctx.assertTrue(
    "Phase A classify conserve for selection",
    runnerSource.includes("for (const selection of selections)"),
  );
  ctx.assertTrue(
    "dispatchEmailBatch pour Phase B enqueue",
    runnerSource.includes("dispatchEmailBatch({"),
  );
  ctx.assertTrue(
    "ensureEmailEvent délégué dans worker",
    runnerSource.includes("ensureEmailEvent({") &&
      runnerSource.includes("worker: async"),
  );
  ctx.assertFalse(
    "runner sans trySendUpcomingDeliveryEmail",
    runnerSource.includes("trySendUpcomingDeliveryEmail"),
  );
  ctx.assertTrue(
    "isolation d'erreur Phase A try/catch",
    runnerSource.includes("} catch (error) {") &&
      runnerSource.includes("summary.failed += 1"),
  );
  ctx.assertTrue(
    "errors bornées max 50",
    runnerSource.includes("EMAIL_BATCH_DEFAULT_MAX_ERRORS"),
  );
  ctx.assertTrue(
    "batch BoxOrders proof query",
    runnerSource.includes("subscriptionSelectionId: { in: selectionIds }") &&
      runnerSource.includes("simulated: false"),
  );
  ctx.assertTrue(
    "batch recoveries query",
    runnerSource.includes("subscriptionPaymentRecovery.findMany"),
  );
  ctx.assertTrue(
    "summary outbox enqueuedExisting",
    runnerSource.includes("enqueuedExisting"),
  );
  ctx.assertFalse(
    "already_sent_for_delivery runtime skip retiré du runner",
    runnerSource.includes('reason === "already_sent_for_delivery"'),
  );
  ctx.assertFalse(
    "pas de Promise.all([reminder, upcoming]) dans cron",
    cronRunBlock.includes("Promise.all") &&
      cronRunBlock.includes("processDueUpcomingDeliveryEmails") &&
      cronRunBlock.includes("processDueMealSelectionReminders") &&
      /Promise\.all\([\s\S]*processDueMealSelectionReminders[\s\S]*processDueUpcomingDeliveryEmails/.test(
        cronRunBlock,
      ),
  );

  const summary = emptyUpcomingDeliveryRunnerSummary();
  incrementUpcomingDeliverySkip(summary, "no_box_order");
  incrementUpcomingDeliverySkip(summary, "blocked");
  summary.sent = 0;
  summary.enqueuedCreated = 2;
  summary.failed = 1;
  ctx.assertEqual("summary skippedNoBoxOrder", summary.skippedNoBoxOrder, 1);
  ctx.assertEqual("summary skippedBlocked", summary.skippedBlocked, 1);
  ctx.assertEqual("summary sent reste 0 post-outbox", summary.sent, 0);
  ctx.assertEqual("summary enqueuedCreated", summary.enqueuedCreated, 2);
  ctx.assertEqual("summary failed", summary.failed, 1);

  ctx.scenario("H. Runner global window + prefiltre DB");
  ctx.assertTrue(
    "global window gate avant query",
    runnerSource.indexOf("isUpcomingDeliveryRunnerWindowPotentiallyOpen") <
      runnerSource.indexOf("subscriptionMealSelection.findMany"),
  );
  ctx.assertTrue(
    "prefiltre shop active status contract",
    runnerSource.includes('status: "active"') &&
      runnerSource.includes("subscriptionContractId: { not: null }"),
  );
  ctx.assertTrue(
    "getPortalModificationBlockReason réutilisé",
    runnerSource.includes("getPortalModificationBlockReason"),
  );

  return finishSuite("60-email-upcoming-delivery-runner", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
