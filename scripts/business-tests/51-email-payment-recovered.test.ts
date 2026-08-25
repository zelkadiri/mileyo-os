/**
 * Business regression — EMAIL-2C PaymentRecoveredEmail wiring.
 *
 * Eligibility + closeRecoveryOnSuccessfulOrder hook only. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldSendPaymentRecoveredEmail } from "../../app/services/email/email.server";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("51-email-payment-recovered");

  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const webhookSource = readRepoFile(
    "app/services/subscriptionBillingAttemptWebhook.server.ts",
  );
  const ordersSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const cronSource = readRepoFile(
    "app/routes/api.cron.process-subscriptions.tsx",
  );

  const closeRecoverySource = recoverySource.slice(
    recoverySource.indexOf("export const closeRecoveryOnSuccessfulOrder"),
    recoverySource.indexOf("export type ProcessDueRecoveryRetriesOptions"),
  );

  ctx.scenario("A. Branchement uniquement dans closeRecoveryOnSuccessfulOrder");
  ctx.assertTrue(
    "trySendMileyoPaymentRecoveredEmail défini",
    recoverySource.includes("trySendMileyoPaymentRecoveredEmail"),
  );
  ctx.assertTrue(
    "closeRecovery appelle ensureAndProcess après transition",
    closeRecoverySource.includes("updateResult.count") &&
      closeRecoverySource.includes("ensureAndProcessEmailEventImmediately"),
  );
  ctx.assertTrue(
    "template payment-recovered utilisé",
    recoverySource.includes('template: "payment-recovered"'),
  );
  ctx.assertTrue(
    "idempotence paymentRecoveredEmailSentAt après send ok",
    recoverySource.includes("paymentRecoveredEmailSentAt: sentAt") ||
      recoverySource.includes("paymentRecoveredEmailSentAt: new Date()"),
  );
  ctx.assertTrue(
    "early return si aucune recovery ouverte",
    closeRecoverySource.includes("openRecoveries.length === 0"),
  );
  ctx.assertTrue(
    "early return si updateMany count === 0 (duplicate)",
    closeRecoverySource.includes("updateResult.count === 0"),
  );

  ctx.assertFalse(
    "webhook success ne branche pas payment-recovered directement",
    webhookSource.includes("payment-recovered") ||
      webhookSource.includes("trySendMileyoPaymentRecoveredEmail"),
  );
  ctx.assertTrue(
    "webhook success passe toujours par closeRecovery",
    webhookSource.includes("closeRecoveryOnSuccessfulOrder"),
  );
  ctx.assertFalse(
    "orders/create ne branche pas payment-recovered directement",
    ordersSource.includes("payment-recovered") ||
      ordersSource.includes("trySendMileyoPaymentRecoveredEmail"),
  );
  ctx.assertTrue(
    "orders/create passe toujours par closeRecovery",
    ordersSource.includes("closeRecoveryOnSuccessfulOrder"),
  );
  ctx.assertFalse(
    "cron ne branche pas payment-recovered",
    cronSource.includes("payment-recovered") ||
      cronSource.includes("trySendMileyoPaymentRecoveredEmail"),
  );

  ctx.scenario("B. Eligibility — recovery active + succès → déclenchable");
  ctx.assertTrue(
    "transition réelle + flag + recipient → send",
    shouldSendPaymentRecoveredEmail({
      hasRealTransition: true,
      hasRecipient: true,
      paymentRecoveredEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("C. Eligibility — succès normal sans recovery → aucun email");
  ctx.assertFalse(
    "pas de transition → no send",
    shouldSendPaymentRecoveredEmail({
      hasRealTransition: false,
      hasRecipient: true,
      paymentRecoveredEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("D. Eligibility — duplicate success → aucun email");
  ctx.assertFalse(
    "déjà envoyé → no send",
    shouldSendPaymentRecoveredEmail({
      hasRealTransition: true,
      hasRecipient: true,
      paymentRecoveredEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("E. Eligibility — flag désactivé → aucun email");
  ctx.assertFalse(
    "flag off → no send",
    shouldSendPaymentRecoveredEmail({
      hasRealTransition: true,
      hasRecipient: true,
      paymentRecoveredEmailSentAt: null,
      transactionalEmailsEnabled: false,
    }),
  );
  ctx.assertFalse(
    "pas de recipient → no send",
    shouldSendPaymentRecoveredEmail({
      hasRealTransition: true,
      hasRecipient: false,
      paymentRecoveredEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  return finishSuite("51-email-payment-recovered", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
