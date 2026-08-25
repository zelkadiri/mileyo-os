/**
 * Business regression — EMAIL-3C SubscriptionPausedEmail wiring + resume reset.
 *
 * Pause volontaire, payment final failure, idempotence, reset après reprise.
 * No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  shouldSendSubscriptionPausedEmail,
} from "../../app/services/email/email.server";
import { MAX_RECOVERY_FAILURES } from "../../app/services/subscriptionPaymentRecovery.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("54-email-subscription-paused");

  const portalActionsSource = readRepoFile(
    "app/features/portal/portal-actions.server.ts",
  );
  const portalResumeSource = readRepoFile(
    "app/features/portal/portal-resume.server.ts",
  );
  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const subscriptionEmailSource = readRepoFile(
    "app/services/email/subscription-email.server.ts",
  );
  const billingWebhookSource = readRepoFile(
    "app/services/subscriptionBillingAttemptWebhook.server.ts",
  );
  const ordersSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );

  const handlePauseBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handlePauseSubscriptionAction"),
    portalActionsSource.indexOf("const handleSendPaymentUpdateEmailAction"),
  );

  const scheduleRecoverySource = recoverySource.slice(
    recoverySource.indexOf("const scheduleRecoveryAfterFailure"),
    recoverySource.indexOf("export type ProcessBillingAttemptFailureResult"),
  );

  ctx.scenario("A. Pause volontaire — branchement portail");
  ctx.assertTrue(
    "trySendSubscriptionPausedEmail défini",
    subscriptionEmailSource.includes("trySendSubscriptionPausedEmail"),
  );
  ctx.assertTrue(
    "pause portail appelle ensureAndProcess après update Prisma",
    handlePauseBlock.includes("status: \"paused\"") &&
      handlePauseBlock.indexOf("status: \"paused\"") <
        handlePauseBlock.indexOf("ensureAndProcessEmailEventImmediately"),
  );
  ctx.assertTrue(
    "cause user_voluntary",
    handlePauseBlock.includes('cause: "user_voluntary"'),
  );
  ctx.assertTrue(
    "ensure après archiveResumeAttemptOnPause",
    handlePauseBlock.indexOf("archiveResumeAttemptOnPause") <
      handlePauseBlock.indexOf("ensureAndProcessEmailEventImmediately"),
  );
  ctx.assertTrue(
    "ensureSubscriptionPauseEmailEpisode",
    handlePauseBlock.includes("ensureSubscriptionPauseEmailEpisode"),
  );
  ctx.assertTrue(
    "sujet pause volontaire",
    subscriptionEmailSource.includes("Votre abonnement est en pause"),
  );

  ctx.scenario("B. Pause volontaire — eligibility");
  ctx.assertTrue(
    "active → pause réussie simulée → déclenchable",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "timestamp déjà posé → skip",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "flag désactivé → skip",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: false,
    }),
  );
  ctx.assertFalse(
    "recipient absent → skip",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: false,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "status non paused → skip",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "active",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("C. Pause volontaire — garde-fous portail");
  ctx.assertTrue(
    "cutoff bloque avant pause Shopify",
    handlePauseBlock.includes("getPortalModificationBlockResponse"),
  );
  ctx.assertTrue(
    "Shopify error retourne avant update Prisma",
    handlePauseBlock.indexOf("\"error\" in shopifyResult") <
      handlePauseBlock.indexOf("status: \"paused\""),
  );
  ctx.assertTrue(
    "ensureAndProcess après succès Shopify + update local",
    handlePauseBlock.indexOf("status: \"paused\"") <
      handlePauseBlock.indexOf("ensureAndProcessEmailEventImmediately"),
  );

  ctx.scenario("D. Payment final failure — branchement recovery");
  ctx.assertTrue(
    "ensureAndProcess après MAX_RECOVERY_FAILURES",
    scheduleRecoverySource.includes(
      `nextFailureCount >= MAX_RECOVERY_FAILURES`,
    ) &&
      scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately") &&
      scheduleRecoverySource.includes("ensureSubscriptionPauseEmailEpisode"),
  );
  ctx.assertTrue(
    "cause payment_final_failure",
    scheduleRecoverySource.includes('cause: "payment_final_failure"'),
  );
  ctx.assertTrue(
    "email seulement si pause Shopify ok",
    scheduleRecoverySource.includes("!pauseResult.error") &&
      scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately"),
  );
  ctx.assertTrue(
    "sujet payment final failure",
    subscriptionEmailSource.includes("Votre abonnement a été suspendu"),
  );
  ctx.assertTrue(
    "premier échec reste PaymentFailedEmail",
    scheduleRecoverySource.includes("nextFailureCount === 1") &&
      (scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately") ||
        scheduleRecoverySource.includes("payment_failed") ||
        scheduleRecoverySource.includes("EMAIL_EVENT_TYPE.PAYMENT_FAILED")),
  );

  ctx.scenario("E. Payment final failure — eligibility");
  ctx.assertTrue(
    "3e échec + paused → déclenchable",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "payment_final_failure",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "premier échec → pas de Paused email (helper seul)",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "payment_final_failure",
      status: "active",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "MAX_RECOVERY_FAILURES vaut 3",
    MAX_RECOVERY_FAILURES === 3,
  );
  ctx.assertTrue(
    "duplicate failure early return avant pause",
    scheduleRecoverySource.includes("nextFailureCount > MAX_RECOVERY_FAILURES"),
  );

  ctx.scenario("F. Idempotence Paused email");
  ctx.assertTrue(
    "updateMany conditionnel sentAt null",
    subscriptionEmailSource.includes("subscriptionPausedEmailSentAt: null"),
  );
  ctx.assertFalse(
    "sentAt jamais posé avant sendEmail ok",
    /subscriptionPausedEmailSentAt:\s*sentAt[\s\S]{0,400}sendEmail/.test(
      subscriptionEmailSource,
    ),
  );
  ctx.assertTrue(
    "template subscription-paused",
    subscriptionEmailSource.includes('template: "subscription-paused"'),
  );

  ctx.scenario("G. Reset après reprise réussie");
  ctx.assertTrue(
    "resetSubscriptionPausedEmailSentAt défini",
    subscriptionEmailSource.includes("resetSubscriptionPausedEmailSentAt"),
  );
  ctx.assertTrue(
    "reset seulement si status active",
    subscriptionEmailSource.includes('status: "active"') &&
      subscriptionEmailSource.includes("subscriptionPausedEmailSentAt: null"),
  );
  ctx.assertTrue(
    "completePortalScheduledResume reset après active",
    portalResumeSource.includes("resetSubscriptionPausedEmailSentAt"),
  );
  ctx.assertTrue(
    "pay resume reset après lock SUCCEEDED",
    portalActionsSource.includes("resetSubscriptionPausedEmailSentAt") &&
      portalActionsSource.includes("RESUME_LOCK_STATUS.SUCCEEDED"),
  );
  ctx.assertTrue(
    "webhook resume reset après completeResumeRenewalFromWebhook",
    billingWebhookSource.includes("resetSubscriptionPausedEmailSentAt") &&
      billingWebhookSource.includes("completeResumeRenewalFromWebhook"),
  );
  ctx.assertTrue(
    "orders/create resume reset",
    ordersSource.includes("resetSubscriptionPausedEmailSentAt") &&
      ordersSource.includes("completeResumeRenewalFromWebhook"),
  );

  ctx.scenario("H. Reset — pas pendant tentative");
  const payResumeBlock = portalActionsSource.slice(
    portalActionsSource.indexOf("const handleResumeSubscriptionAndPayAction"),
    portalActionsSource.indexOf("const handleChangeSubscriptionBoxAction"),
  );
  ctx.assertFalse(
    "reset absent dans le try pay resume avant billing",
    payResumeBlock.slice(0, payResumeBlock.indexOf("} finally {")).includes(
      "resetSubscriptionPausedEmailSentAt",
    ),
  );
  ctx.assertFalse(
    "reset absent dans handlePauseSubscriptionAction",
    handlePauseBlock.includes("resetSubscriptionPausedEmailSentAt"),
  );
  ctx.assertTrue(
    "reset après releaseResumeBillingLock en finally",
    payResumeBlock.indexOf("releaseResumeBillingLock") <
      payResumeBlock.indexOf("resetSubscriptionPausedEmailSentAt"),
  );

  ctx.scenario("I. Future pause éligible après reprise");
  ctx.assertTrue(
    "après reset sentAt null → pause re-éligible",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("J. Isolation — subscription contract sync");
  ctx.assertFalse(
    "contract sync ne branche pas paused email",
    readRepoFile("app/services/subscriptionContractSync.server.ts").includes(
      "trySendSubscriptionPausedEmail",
    ),
  );

  return finishSuite("54-email-subscription-paused", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
