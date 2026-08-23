/**
 * Business regression — EMAIL-4C meal selection reminder runner.
 *
 * Send window, eligibility, idempotence, cron wiring. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RECOVERY_STATUS } from "../../app/constants/subscriptionPaymentRecovery";
import {
  hasExplicitMealSelectionForDelivery,
  isMealSelectionReminderSendWindowOpen,
  shouldSendMealSelectionReminderEmail,
} from "../../app/services/email/email.server";
import { classifyMealSelectionReminderCandidate } from "../../app/services/email/meal-selection-reminder-runner.server";
import {
  MEAL_SELECTION_REMINDER_WINDOW_START_HOUR,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../../app/constants/subscriptionCycle";
import {
  parseDeliveryDate,
  parisWallClockToInstant,
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

const eligibleSelection = {
  active: true,
  customerEmail: "client@example.com",
  lastBillingAttemptAt: null,
  lastBillingAttemptStatus: null,
  mealSelectionLastExplicitDeliveryDate: "2026-08-20",
  mealSelectionReminderDeliveryDate: null,
  mealsCount: 8,
  nextScheduledDeliveryDate: "2026-08-27",
  preferredDeliveryWeekday: 4,
  resumeAttemptOrderId: null,
  resumeAttemptStatus: null,
  selectedMeals: ["A", "A", "B", "B", "C", "C", "D", "D"],
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("57-email-meal-selection-reminder");

  const cronSource = readRepoFile("app/routes/api.cron.process-subscriptions.tsx");
  const runnerSource = readRepoFile(
    "app/services/email/meal-selection-reminder-runner.server.ts",
  );
  const mealSelectionEmailSource = readRepoFile(
    "app/services/email/meal-selection-email.server.ts",
  );

  ctx.scenario("A. Fenêtre temporelle — dimanche / lundi / cutoff");
  ctx.assertFalse(
    "dimanche 09h59 hors fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-23", hour: 9, minute: 59 }),
    ),
  );
  ctx.assertTrue(
    "dimanche 10h00 dans fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-23", hour: MEAL_SELECTION_REMINDER_WINDOW_START_HOUR }),
    ),
  );
  ctx.assertTrue(
    "dimanche 18h dans fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-23", hour: 18 }),
    ),
  );
  ctx.assertTrue(
    "lundi avant cutoff dans fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-24", hour: 8 }),
    ),
  );
  ctx.assertFalse(
    "samedi hors fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-22", hour: 12 }),
    ),
  );
  ctx.assertFalse(
    "mardi hors fenêtre",
    isMealSelectionReminderSendWindowOpen(
      parisAt({ date: "2026-08-25", hour: 8 }),
    ),
  );

  const sundayEligible = classifyMealSelectionReminderCandidate({
    now: parisAt({ date: "2026-08-23", hour: 11 }),
    selection: eligibleSelection,
  });
  ctx.assertNull("dimanche 11h candidat éligible", sundayEligible.skipReason);

  const afterCutoff = shouldSendMealSelectionReminderEmail({
    active: true,
    effectiveDeliveryDate: "2026-08-27",
    hasExplicitSelection: false,
    hasRecipient: true,
    mealSelectionReminderDeliveryDate: null,
    now: parisAt({ date: "2026-08-25", hour: 0 }),
    status: "active",
    subscriptionContractId: "gid://shopify/SubscriptionContract/1",
    transactionalEmailsEnabled: true,
  });
  ctx.assertFalse("après cutoff → skip", afterCutoff);

  ctx.scenario("B. Explicite / carry-over");
  ctx.assertTrue(
    "carry-over complet + explicit ancienne → reminder",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: null,
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "explicit === delivery → skip",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: hasExplicitMealSelectionForDelivery({
        effectiveDeliveryDate: "2026-08-27",
        mealSelectionLastExplicitDeliveryDate: "2026-08-27",
      }),
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: null,
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );

  const newCycle = classifyMealSelectionReminderCandidate({
    now: parisAt({ date: "2026-08-30", hour: 11 }),
    selection: {
      ...eligibleSelection,
      mealSelectionLastExplicitDeliveryDate: "2026-08-27",
      mealSelectionReminderDeliveryDate: "2026-08-27",
      nextScheduledDeliveryDate: "2026-09-03",
    },
  });
  ctx.assertNull(
    "nouvelle livraison redevient éligible",
    newCycle.skipReason,
  );

  ctx.scenario("C. Idempotence");
  ctx.assertFalse(
    "reminder déjà envoyé même cycle → skip",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: "2026-08-27",
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "sentAt jamais posé avant sendEmail reminder",
    !/mealSelectionReminderEmailSentAt:\s*sentAt[\s\S]{0,400}sendEmail/.test(
      mealSelectionEmailSource,
    ),
  );
  ctx.assertTrue(
    "updateMany conditionnel reminder delivery date",
    mealSelectionEmailSource.includes("mealSelectionReminderDeliveryDate: null") &&
      mealSelectionEmailSource.includes(
        "mealSelectionReminderDeliveryDate: { not: effectiveDeliveryDate }",
      ),
  );

  ctx.scenario("D. Guards — statut / recipient / delivery / recovery");
  ctx.assertEqual(
    "paused → inactive skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      selection: { ...eligibleSelection, status: "paused" },
    }).skipReason,
    "inactive",
  );
  ctx.assertEqual(
    "active false → inactive skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      selection: { ...eligibleSelection, active: false },
    }).skipReason,
    "inactive",
  );
  ctx.assertEqual(
    "sans contractId → inactive skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      selection: { ...eligibleSelection, subscriptionContractId: null },
    }).skipReason,
    "inactive",
  );
  ctx.assertEqual(
    "recipient absent → skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      selection: { ...eligibleSelection, customerEmail: null },
    }).skipReason,
    "no_recipient",
  );
  ctx.assertEqual(
    "delivery inconnue → skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      selection: {
        ...eligibleSelection,
        nextScheduledDeliveryDate: null,
        preferredDeliveryWeekday: null,
      },
    }).skipReason,
    "no_delivery",
  );
  ctx.assertEqual(
    "recovery processing → blocked skip",
    classifyMealSelectionReminderCandidate({
      now: parisAt({ date: "2026-08-23", hour: 11 }),
      recovery: { status: RECOVERY_STATUS.PROCESSING },
      selection: eligibleSelection,
    }).skipReason,
    "blocked",
  );

  const afterRecovery = classifyMealSelectionReminderCandidate({
    now: parisAt({ date: "2026-08-24", hour: 8 }),
    recovery: null,
    selection: eligibleSelection,
  });
  ctx.assertNull(
    "blocage levé lundi matin → éligible",
    afterRecovery.skipReason,
  );

  const cronRunBlock = cronSource.slice(
    cronSource.indexOf("const runProcessSubscriptionsCron"),
    cronSource.indexOf("export const loader"),
  );

  ctx.scenario("E. Runner + cron");
  ctx.assertTrue(
    "runner export processDueMealSelectionReminders",
    runnerSource.includes("export const processDueMealSelectionReminders"),
  );
  ctx.assertFalse(
    "runner séparé du billing worker",
    readRepoFile("app/services/subscriptionBillingWorker.server.ts").includes(
      "processDueMealSelectionReminders",
    ),
  );
  ctx.assertTrue(
    "cron appelle billing puis reminder",
    cronRunBlock.includes("processDueSubscriptionBillings") &&
      cronRunBlock.includes("processDueMealSelectionReminders"),
  );
  ctx.assertTrue(
    "cron billing avant reminder",
    cronRunBlock.indexOf("processDueSubscriptionBillings") <
      cronRunBlock.indexOf("processDueMealSelectionReminders"),
  );
  ctx.assertTrue(
    "cron reminder isolé try/catch",
    cronRunBlock.includes("mealSelectionReminderError"),
  );
  ctx.assertTrue(
    "cron conserve billing summary top-level",
    cronRunBlock.includes("...billingSummary"),
  );
  ctx.assertTrue(
    "runner préfiltre active + status active + contract",
    runnerSource.includes('status: "active"') &&
      runnerSource.includes("subscriptionContractId: { not: null }"),
  );
  ctx.assertTrue(
    "runner réutilise getPortalModificationBlockReason",
    runnerSource.includes("getPortalModificationBlockReason"),
  );
  ctx.assertTrue(
    "trySend reminder sujet attendu",
    mealSelectionEmailSource.includes(
      `subject: "N'oubliez pas de choisir vos repas"`,
    ),
  );

  ctx.scenario("F. EMAIL-INFRA-2 — batch dispatcher + outbox enqueue");
  ctx.assertTrue(
    "runner utilise dispatchEmailBatch",
    runnerSource.includes("dispatchEmailBatch({"),
  );
  ctx.assertTrue(
    "ensureEmailEvent délégué dans worker (pas de trySend direct)",
    runnerSource.includes("ensureEmailEvent({") &&
      runnerSource.includes("worker: async"),
  );
  ctx.assertFalse(
    "runner sans trySendMealSelectionReminderEmail",
    runnerSource.includes("trySendMealSelectionReminderEmail"),
  );
  ctx.assertTrue(
    "classify loop conserve for selection",
    runnerSource.includes("for (const selection of selections)"),
  );
  ctx.assertTrue(
    "errors reminder plafonnées (max 50)",
    runnerSource.includes("EMAIL_BATCH_DEFAULT_MAX_ERRORS") &&
      runnerSource.includes("summary.errors.length >="),
  );
  ctx.assertFalse(
    "pas de Promise.all sur runners cron",
    cronRunBlock.includes("Promise.all([") &&
      cronRunBlock.includes("processDueMealSelectionReminders"),
  );
  ctx.assertTrue(
    "summary outbox enqueuedCreated",
    runnerSource.includes("enqueuedCreated"),
  );
  ctx.assertFalse(
    "already_sent_for_delivery runtime skip retiré du runner",
    runnerSource.includes('reason === "already_sent_for_delivery"'),
  );

  return finishSuite("57-email-meal-selection-reminder", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
