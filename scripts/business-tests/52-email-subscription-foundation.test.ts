/**
 * Business regression — EMAIL-3A subscription email foundation.
 *
 * Templates + types + helpers + Prisma sent-at fields.
 * No Resend network calls. No business wiring.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSubscriptionCreatedEmailData,
  buildSubscriptionPausedEmailData,
  formatSubscriptionEmailDeliveryDate,
  renderEmailTemplate,
  resolveSubscriptionEmailRecipient,
  shouldSendSubscriptionCreatedEmail,
  shouldSendSubscriptionPausedEmail,
  SUBSCRIPTION_PORTAL_PATH,
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
  const ctx = createBusinessTestContext("52-email-subscription-foundation");

  const renderSource = readRepoFile("app/services/email/email-render.server.ts");
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260823120000_add_subscription_transactional_email_sent_at/migration.sql",
  );

  ctx.scenario("A. Structure — fichiers EMAIL-3A présents");
  const structureFiles = [
    "app/services/email/templates/SubscriptionCreatedEmail.tsx",
    "app/services/email/templates/SubscriptionPausedEmail.tsx",
    "app/services/email/subscription-email.server.ts",
  ];

  for (const relativePath of structureFiles) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  ctx.assertTrue(
    "registry subscription-created",
    renderSource.includes('"subscription-created"'),
  );
  ctx.assertTrue(
    "registry subscription-paused",
    renderSource.includes('"subscription-paused"'),
  );

  ctx.scenario("B. Schema + migration — sent-at fields");
  ctx.assertTrue(
    "schema subscriptionCreatedEmailSentAt",
    schemaSource.includes("subscriptionCreatedEmailSentAt"),
  );
  ctx.assertTrue(
    "schema subscriptionPausedEmailSentAt",
    schemaSource.includes("subscriptionPausedEmailSentAt"),
  );
  ctx.assertTrue(
    "migration subscriptionCreatedEmailSentAt",
    migrationSource.includes("subscriptionCreatedEmailSentAt"),
  );
  ctx.assertTrue(
    "migration subscriptionPausedEmailSentAt",
    migrationSource.includes("subscriptionPausedEmailSentAt"),
  );

  ctx.scenario("C. Renderer — SubscriptionCreatedEmail");
  const createdRendered = await renderEmailTemplate("subscription-created", {
    customerName: "Alice",
    mealsCount: 8,
    nextDelivery: "jeudi 28 août 2026",
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue("created html non vide", createdRendered.html.length > 0);
  ctx.assertTrue(
    "created html contient le titre",
    createdRendered.html.includes("Votre abonnement est confirmé"),
  );
  ctx.assertTrue(
    "created html contient le prénom",
    createdRendered.html.includes("Alice"),
  );
  ctx.assertTrue(
    "created html contient mealsCount",
    createdRendered.html.includes("8 repas"),
  );
  ctx.assertTrue(
    "created html contient nextDelivery",
    createdRendered.html.includes("jeudi 28 août 2026"),
  );
  ctx.assertTrue(
    "created html contient le lien portail",
    createdRendered.html.includes("/apps/box-builder/portal"),
  );
  ctx.assertTrue(
    "created html contient CTA",
    createdRendered.html.includes("Accéder à mon espace Mileyo"),
  );
  ctx.assertTrue("created text non vide", createdRendered.text.length > 0);

  ctx.scenario("D. Renderer — SubscriptionPausedEmail user_voluntary");
  const voluntaryRendered = await renderEmailTemplate("subscription-paused", {
    customerName: "Bob",
    pauseCause: "user_voluntary",
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue(
    "voluntary html contient le titre pause",
    voluntaryRendered.html.includes("Votre abonnement est en pause"),
  );
  ctx.assertTrue(
    "voluntary html contient confirmation pause",
    voluntaryRendered.html.includes("maintenant en pause"),
  );
  ctx.assertTrue(
    "voluntary html contient reprendre",
    voluntaryRendered.html.includes("reprendre"),
  );
  ctx.assertFalse(
    "voluntary html sans copie échec paiement",
    voluntaryRendered.html.includes("finaliser le paiement"),
  );

  ctx.scenario("E. Renderer — SubscriptionPausedEmail payment_final_failure");
  const failureRendered = await renderEmailTemplate("subscription-paused", {
    customerName: "Claire",
    pauseCause: "payment_final_failure",
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue(
    "failure html contient le titre suspendu",
    failureRendered.html.includes(
      "Votre abonnement est temporairement suspendu",
    ),
  );
  ctx.assertTrue(
    "failure html explique échecs paiement",
    failureRendered.html.includes("finaliser le paiement"),
  );
  ctx.assertTrue(
    "failure html mentionne moyen de paiement",
    failureRendered.html.includes("moyen de paiement"),
  );
  ctx.assertFalse(
    "failure html sans copie pause volontaire",
    failureRendered.html.includes("maintenant en pause"),
  );

  ctx.scenario("F. Eligibility — SubscriptionCreatedEmail");
  ctx.assertFalse(
    "created refusé sans subscriptionContractId",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: null,
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "created refusé si timestamp déjà posé",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "created accepté quand éligible",
    shouldSendSubscriptionCreatedEmail({
      hasRecipient: true,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      subscriptionCreatedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("G. Eligibility — SubscriptionPausedEmail");
  ctx.assertFalse(
    "paused refusé si timestamp déjà posé",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: new Date("2026-08-22T00:00:00.000Z"),
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "paused refusé cause non autorisée",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "resume_billing_failed",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "paused accepté user_voluntary",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "user_voluntary",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertTrue(
    "paused accepté payment_final_failure",
    shouldSendSubscriptionPausedEmail({
      hasRecipient: true,
      pauseCause: "payment_final_failure",
      status: "paused",
      subscriptionPausedEmailSentAt: null,
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("H. Helpers destinataire — sans appel réseau");
  const withEmail = resolveSubscriptionEmailRecipient(
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

  const fallbackEmail = resolveSubscriptionEmailRecipient(
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

  ctx.scenario("I. Format date FR + builders");
  const formattedDelivery = formatSubscriptionEmailDeliveryDate("2026-08-28");
  ctx.assertTrue(
    "date livraison formatée en français",
    formattedDelivery !== null && formattedDelivery.includes("2026"),
  );

  const createdData = buildSubscriptionCreatedEmailData({
    customerName: " Alice ",
    mealsCount: 6,
    nextScheduledDeliveryDate: "2026-08-28",
    shop: "mileyo-dev.myshopify.com",
  });
  ctx.assertEqual("created data name trimmed", createdData.customerName, "Alice");
  ctx.assertEqual("created data mealsCount", createdData.mealsCount, 6);
  ctx.assertEqual(
    "created data portalUrl depuis shop",
    createdData.portalUrl,
    `https://mileyo-dev.myshopify.com${SUBSCRIPTION_PORTAL_PATH}`,
  );
  ctx.assertTrue(
    "created data nextDelivery formatée",
    Boolean(createdData.nextDelivery && createdData.nextDelivery.length > 0),
  );

  const pausedData = buildSubscriptionPausedEmailData({
    customerName: "Bob",
    pauseCause: "payment_final_failure",
    portalUrl: "https://custom.example/portal",
  });
  ctx.assertEqual("paused data cause", pausedData.pauseCause, "payment_final_failure");
  ctx.assertEqual(
    "paused data portalUrl override",
    pausedData.portalUrl,
    "https://custom.example/portal",
  );

  return finishSuite("52-email-subscription-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
