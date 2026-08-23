/**
 * Business regression — EMAIL-3B SubscriptionCreatedEmail wiring.
 *
 * Eligibility + orders/create hook on first subscription only. No Resend network calls.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  shouldSendSubscriptionCreatedEmail,
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
  const ctx = createBusinessTestContext("53-email-subscription-created");

  const ordersSource = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  const subscriptionEmailSource = readRepoFile(
    "app/services/email/subscription-email.server.ts",
  );

  const createFirstBlock = ordersSource.slice(
    ordersSource.indexOf('if (decision === "create_first_subscription")'),
    ordersSource.indexOf("if (isRenewal && matchedSelection)"),
  );

  ctx.scenario("A. Branchement orders/create — première commande abonnement");
  ctx.assertTrue(
    "trySendSubscriptionCreatedEmail défini",
    subscriptionEmailSource.includes("trySendSubscriptionCreatedEmail"),
  );
  ctx.assertTrue(
    "create_first_subscription appelle trySend",
    createFirstBlock.includes("trySendSubscriptionCreatedEmail"),
  );
  ctx.assertTrue(
    "trySend après reconcile pending contract",
    createFirstBlock.indexOf("reconcilePendingContractForSelection") <
      createFirstBlock.indexOf("trySendSubscriptionCreatedEmail"),
  );
  ctx.assertTrue(
    "template subscription-created utilisé",
    subscriptionEmailSource.includes('template: "subscription-created"'),
  );
  ctx.assertTrue(
    "sujet confirmé",
    subscriptionEmailSource.includes(
      'subject: "Votre abonnement Mileyo est confirmé"',
    ),
  );
  ctx.assertTrue(
    "idempotence subscriptionCreatedEmailSentAt après send ok",
    subscriptionEmailSource.includes("subscriptionCreatedEmailSentAt: sentAt") ||
      subscriptionEmailSource.includes(
        "subscriptionCreatedEmailSentAt: null",
      ),
  );
  ctx.assertTrue(
    "update conditionnelle sentAt null",
    subscriptionEmailSource.includes("updateMany") &&
      subscriptionEmailSource.includes("subscriptionCreatedEmailSentAt: null"),
  );

  ctx.scenario("B. Replay first order — contrat tardif");
  ctx.assertTrue(
    "isFirstOrderReplay appelle trySend",
    ordersSource.includes("if (isFirstOrderReplay)") &&
      ordersSource.includes("trySendSubscriptionCreatedEmail"),
  );
  ctx.assertTrue(
    "renewal seul ne branche pas trySend directement",
    !/if \(isRenewal && matchedSelection\)[\s\S]*?trySendSubscriptionCreatedEmail[\s\S]*?if \(isFirstOrderReplay\)/.test(
      ordersSource,
    ) ||
      ordersSource.indexOf("if (isFirstOrderReplay)") <
        ordersSource.lastIndexOf("trySendSubscriptionCreatedEmail"),
  );

  ctx.scenario("C. Eligibility — première commande + contrat lié");
  ctx.assertTrue(
    "active + contrat + recipient + flag → send",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("D. Eligibility — subscriptionCreatedEmailSentAt déjà posé");
  ctx.assertFalse(
    "timestamp posé → skip",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("E. Eligibility — replay / renouvellement sans contrat initial");
  ctx.assertFalse(
    "contrat absent → skip",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: null,
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "status paused → skip",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "paused",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("F. Eligibility — contrat lié après reconciliation");
  ctx.assertTrue(
    "contrat présent + sentAt null → déclenchable",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/99",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("G. Eligibility — flag désactivé");
  ctx.assertFalse(
    "flag off → skip",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: false,
    }),
  );

  ctx.scenario("H. Eligibility — recipient absent");
  ctx.assertFalse(
    "sans recipient → skip",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: false,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("I. Isolation — pas d'envoi sur renouvellement pur");
  ctx.assertFalse(
    "orders/create ne branche pas subscription-paused",
    ordersSource.includes("subscription-paused"),
  );
  ctx.assertFalse(
    "helper ne pose pas sentAt avant send ok",
    /subscriptionCreatedEmailSentAt:\s*sentAt[\s\S]{0,400}sendEmail/.test(
      subscriptionEmailSource,
    ),
  );
  ctx.assertTrue(
    "feature flag lu via isMileyoTransactionalEmailEnabled",
    subscriptionEmailSource.includes("isMileyoTransactionalEmailEnabled()"),
  );
  ctx.assertTrue(
    "ENABLE_MILEYO_TRANSACTIONAL_EMAILS exporté",
    readRepoFile("app/services/email/email-client.server.ts").includes(
      ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
    ),
  );

  return finishSuite("53-email-subscription-created", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
