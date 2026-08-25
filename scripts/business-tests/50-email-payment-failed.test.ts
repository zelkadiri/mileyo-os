/**
 * Business regression — EMAIL-2B PaymentFailedEmail wiring.
 *
 * Eligibility + recovery hook on first failure only. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  shouldSendPaymentFailedEmail,
} from "../../app/services/email/email.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("50-email-payment-failed");

  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260822120000_add_payment_transactional_email_sent_at/migration.sql",
  );

  const scheduleRecoverySource = recoverySource.slice(
    recoverySource.indexOf("const scheduleRecoveryAfterFailure"),
    recoverySource.indexOf("export type ProcessBillingAttemptFailureResult"),
  );

  ctx.scenario("A. Schema + migration — sent-at fields");
  ctx.assertTrue(
    "schema paymentFailedEmailSentAt",
    schemaSource.includes("paymentFailedEmailSentAt"),
  );
  ctx.assertTrue(
    "schema paymentRecoveredEmailSentAt",
    schemaSource.includes("paymentRecoveredEmailSentAt"),
  );
  ctx.assertTrue(
    "migration paymentFailedEmailSentAt",
    migrationSource.includes("paymentFailedEmailSentAt"),
  );
  ctx.assertTrue(
    "migration paymentRecoveredEmailSentAt",
    migrationSource.includes("paymentRecoveredEmailSentAt"),
  );

  ctx.scenario("B. Recovery — branchement premier échec uniquement");
  ctx.assertTrue(
    "trySendMileyoPaymentFailedEmail défini",
    recoverySource.includes("trySendMileyoPaymentFailedEmail"),
  );
  ctx.assertTrue(
    "appel après failureCount === 1",
    scheduleRecoverySource.includes("if (nextFailureCount === 1)") &&
      scheduleRecoverySource.includes("ensureAndProcessEmailEventImmediately") &&
      (scheduleRecoverySource.includes("EMAIL_EVENT_TYPE.PAYMENT_FAILED") ||
        scheduleRecoverySource.includes("payment_failed")),
  );
  ctx.assertTrue(
    "Shopify payment update email conservé",
    scheduleRecoverySource.includes("sendPaymentUpdateEmailForSelection"),
  );
  ctx.assertTrue(
    "template payment-failed utilisé",
    recoverySource.includes('template: "payment-failed"'),
  );
  ctx.assertTrue(
    "idempotence paymentFailedEmailSentAt après send ok",
    recoverySource.includes("paymentFailedEmailSentAt: new Date()") ||
      recoverySource.includes("paymentFailedEmailSentAt: sentAt") ||
      recoverySource.includes("stampPaymentFailedEmailSentAt") ||
      recoverySource.includes("backfillPaymentFailedStampFromSentEvent"),
  );
  ctx.assertTrue(
    "duplicate path return early avant send",
    scheduleRecoverySource.indexOf("isRecoveryFailureAlreadyRecorded") <
      scheduleRecoverySource.indexOf("ensureAndProcessEmailEventImmediately"),
  );

  ctx.scenario("C. Eligibility — premier échec déclenchable");
  ctx.assertTrue(
    "failureCount 1 + flag + recipient → send",
    shouldSendPaymentFailedEmail({
      failureCount: 1,
      hasRecipient: true,
      paymentFailedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("D. Eligibility — deuxième échec → aucun email");
  ctx.assertFalse(
    "failureCount 2 → no send",
    shouldSendPaymentFailedEmail({
      failureCount: 2,
      hasRecipient: true,
      paymentFailedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "failureCount 3 final → no send",
    shouldSendPaymentFailedEmail({
      failureCount: 3,
      hasRecipient: true,
      paymentFailedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("E. Eligibility — flag désactivé → aucun email");
  ctx.assertFalse(
    "flag off → no send",
    shouldSendPaymentFailedEmail({
      failureCount: 1,
      hasRecipient: true,
      paymentFailedEmailSentAt: null,
      transactionalEmailsEnabled: false,
    }),
  );

  ctx.scenario("F. Eligibility — duplicate (déjà envoyé) → aucun email");
  ctx.assertFalse(
    "already sent → no send",
    shouldSendPaymentFailedEmail({
      failureCount: 1,
      hasRecipient: true,
      paymentFailedEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "no recipient → no send",
    shouldSendPaymentFailedEmail({
      failureCount: 1,
      hasRecipient: false,
      paymentFailedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("G. Hors périmètre — webhooks / cron / worker inchangés");
  const webhookSource = readRepoFile(
    "app/services/subscriptionBillingAttemptWebhook.server.ts",
  );
  const cronSource = readRepoFile(
    "app/routes/api.cron.process-subscriptions.tsx",
  );
  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );

  ctx.assertFalse(
    "webhook n’importe pas payment-failed",
    webhookSource.includes("payment-failed") ||
      webhookSource.includes("trySendMileyoPaymentFailedEmail"),
  );
  ctx.assertFalse(
    "cron n’importe pas payment-failed",
    cronSource.includes("payment-failed") ||
      cronSource.includes("trySendMileyoPaymentFailedEmail"),
  );
  ctx.assertFalse(
    "billing worker n’importe pas payment-failed",
    workerSource.includes("payment-failed") ||
      workerSource.includes("trySendMileyoPaymentFailedEmail"),
  );

  return finishSuite("50-email-payment-failed", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
