/**
 * Business regression — EMAIL-2A payment email foundation.
 *
 * Templates + types + feature flag + recipient helpers.
 * No Resend network calls. No billing / recovery wiring.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPaymentFailedEmailData,
  buildPaymentRecoveredEmailData,
  ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV,
  isMileyoTransactionalEmailEnabled,
  renderEmailTemplate,
  resolvePaymentEmailRecipient,
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
  const ctx = createBusinessTestContext("49-email-payment-foundation");
  const previousFlag = process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];

  ctx.scenario("A. Structure — fichiers EMAIL-2A présents");
  const structureFiles = [
    "app/services/email/templates/PaymentFailedEmail.tsx",
    "app/services/email/templates/PaymentRecoveredEmail.tsx",
    "app/services/email/payment-email.server.ts",
  ];

  for (const relativePath of structureFiles) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  ctx.assertTrue(
    "recovery exporte toujours les constantes recovery",
    recoverySource.includes("RECOVERY_STATUS"),
  );

  ctx.scenario("B. Feature flag — off par défaut");
  delete process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  ctx.assertFalse(
    "flag unset → disabled",
    isMileyoTransactionalEmailEnabled(),
  );

  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "false";
  ctx.assertFalse(
    "flag false → disabled",
    isMileyoTransactionalEmailEnabled(),
  );

  process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = "true";
  ctx.assertTrue(
    "flag true → enabled",
    isMileyoTransactionalEmailEnabled(),
  );

  ctx.scenario("C. Renderer — PaymentFailedEmail");
  const failedRendered = await renderEmailTemplate("payment-failed", {
    customerName: "Alice",
    failureCount: 1,
    nextRetryAt: "26 août 2026",
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue("failed html non vide", failedRendered.html.length > 0);
  ctx.assertTrue(
    "failed html contient le titre",
    failedRendered.html.includes(
      "Un problème est survenu avec votre paiement",
    ),
  );
  ctx.assertTrue(
    "failed html contient le prénom",
    failedRendered.html.includes("Alice"),
  );
  ctx.assertTrue(
    "failed html contient nextRetryAt",
    failedRendered.html.includes("26 août 2026"),
  );
  ctx.assertFalse(
    "failed html sans copy technique tentative",
    failedRendered.html.includes("Tentative") &&
      failedRendered.html.includes("enregistrée"),
  );
  ctx.assertTrue(
    "failed html contient CTA",
    failedRendered.html.includes("Gérer mon abonnement"),
  );
  ctx.assertTrue("failed text non vide", failedRendered.text.length > 0);

  ctx.scenario("D. Renderer — PaymentRecoveredEmail");
  const recoveredRendered = await renderEmailTemplate("payment-recovered", {
    customerName: "Bob",
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue(
    "recovered html non vide",
    recoveredRendered.html.length > 0,
  );
  ctx.assertTrue(
    "recovered html contient le titre",
    recoveredRendered.html.includes("Paiement confirmé"),
  );
  ctx.assertTrue(
    "recovered html contient le prénom",
    recoveredRendered.html.includes("Bob"),
  );
  ctx.assertTrue(
    "recovered html contient CTA",
    recoveredRendered.html.includes("Accéder à mon espace Mileyo"),
  );
  ctx.assertTrue(
    "recovered text non vide",
    recoveredRendered.text.length > 0,
  );

  ctx.scenario("E. Helpers destinataire — sélection + order");
  const withEmail = resolvePaymentEmailRecipient(
    {
      customerEmail: "client@example.com",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
    },
    { customerName: "Alice Martin" },
  );
  ctx.assertEqual(
    "email depuis selection",
    withEmail.recipient?.email ?? null,
    "client@example.com",
  );
  ctx.assertEqual(
    "name depuis order",
    withEmail.customerName,
    "Alice Martin",
  );
  ctx.assertEqual(
    "recipient.name depuis order",
    withEmail.recipient?.name ?? null,
    "Alice Martin",
  );

  const fallbackEmail = resolvePaymentEmailRecipient(
    { customerEmail: null, subscriptionContractId: null },
    {
      customerEmail: "order@example.com",
      customerName: "Claire",
    },
  );
  ctx.assertEqual(
    "fallback email order",
    fallbackEmail.recipient?.email ?? null,
    "order@example.com",
  );

  const missingEmail = resolvePaymentEmailRecipient(
    { customerEmail: null, subscriptionContractId: "c1" },
    { customerName: "Sans Email" },
  );
  ctx.assertNull("recipient null sans email", missingEmail.recipient);
  ctx.assertEqual(
    "customerName conservé sans email",
    missingEmail.customerName,
    "Sans Email",
  );

  const failedData = buildPaymentFailedEmailData({
    customerName: " Alice ",
    failureCount: 2,
    nextRetryAt: new Date("2026-08-24T00:05:00.000Z"),
    recoveryId: "rec_1",
    subscriptionContractId: "contract_1",
  });
  ctx.assertEqual("failed data name trimmed", failedData.customerName, "Alice");
  ctx.assertEqual("failed data failureCount", failedData.failureCount, 2);
  ctx.assertEqual(
    "failed data nextRetryAt ISO",
    failedData.nextRetryAt,
    "2026-08-24T00:05:00.000Z",
  );
  ctx.assertEqual("failed data recoveryId", failedData.recoveryId, "rec_1");

  const recoveredData = buildPaymentRecoveredEmailData({
    customerName: "Bob",
    orderId: "gid://shopify/Order/9",
    recoveryId: "rec_2",
    subscriptionContractId: "contract_2",
  });
  ctx.assertEqual(
    "recovered data orderId",
    recoveredData.orderId,
    "gid://shopify/Order/9",
  );
  ctx.assertEqual(
    "recovered data customerName",
    recoveredData.customerName,
    "Bob",
  );

  if (previousFlag === undefined) {
    delete process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV];
  } else {
    process.env[ENABLE_MILEYO_TRANSACTIONAL_EMAILS_ENV] = previousFlag;
  }

  return finishSuite("49-email-payment-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
