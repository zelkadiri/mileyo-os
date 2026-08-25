/**
 * Business regression — EMAIL-UX shared design system for transactional emails.
 *
 * Structural checks: shared layout, logo header, CTA, footer, preheader,
 * compact InfoCard, no technical copy, FR dates, all templates renderable.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatPaymentEmailDateTime,
  formatSubscriptionEmailDeliveryDate,
  renderEmailTemplate,
} from "../../app/services/email/email.server";
import { MILEYO_EMAIL_LOGO_URL } from "../../app/services/email/components/mileyoEmailLogo";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const FORBIDDEN_CLIENT_COPY = [
  "failureCount",
  "Tentative 1 enregistrée",
  "retry_scheduled",
  "subscriptionContract",
  "EmailEvent",
  "processing",
  "[object Object]",
  "undefined",
  "null",
];

const TEMPLATE_FILES = [
  "app/services/email/templates/SubscriptionCreatedEmail.tsx",
  "app/services/email/templates/SubscriptionPausedEmail.tsx",
  "app/services/email/templates/PaymentFailedEmail.tsx",
  "app/services/email/templates/PaymentRecoveredEmail.tsx",
  "app/services/email/templates/MealSelectionConfirmedEmail.tsx",
  "app/services/email/templates/MealSelectionReminderEmail.tsx",
  "app/services/email/templates/UpcomingDeliveryEmail.tsx",
] as const;

const COMPONENT_FILES = [
  "app/services/email/components/MileyoEmailLayout.tsx",
  "app/services/email/components/MileyoEmailHeader.tsx",
  "app/services/email/components/MileyoEmailButton.tsx",
  "app/services/email/components/MileyoEmailFooter.tsx",
  "app/services/email/components/MileyoInfoCard.tsx",
  "app/services/email/components/MileyoMealList.tsx",
  "app/services/email/components/mileyoEmailTokens.ts",
  "app/services/email/components/mileyoEmailLogo.ts",
  "app/services/email/components/emailGreeting.ts",
] as const;

const portalUrl = "https://mileyo-dev.myshopify.com/apps/box-builder/portal";

const runSuite = async () => {
  const ctx = createBusinessTestContext("74-email-template-design-system");

  ctx.scenario("A. Design system files présents");
  for (const relativePath of [...COMPONENT_FILES, ...TEMPLATE_FILES]) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  ctx.scenario("B. Layout / header logo CDN / CTA / footer partagés");
  for (const relativePath of TEMPLATE_FILES) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(
      `${relativePath} → MileyoEmailLayout`,
      source.includes("MileyoEmailLayout"),
    );
    ctx.assertTrue(
      `${relativePath} CTA button import`,
      source.includes("MileyoEmailButton"),
    );
    ctx.assertFalse(
      `${relativePath} sans wordmark texte MILEYO standalone`,
      />\s*MILEYO\s*</.test(source) || source.includes('">MILEYO</'),
    );
    ctx.assertFalse(
      `${relativePath} sans showFallbackLink`,
      source.includes("showFallbackLink"),
    );
    ctx.assertFalse(
      `${relativePath} sans URL logo hardcodée`,
      source.includes("cdn.shopify.com") ||
        source.includes("mileyo-logo.png"),
    );
  }

  const layoutSource = readRepoFile(
    "app/services/email/components/MileyoEmailLayout.tsx",
  );
  const headerSource = readRepoFile(
    "app/services/email/components/MileyoEmailHeader.tsx",
  );
  const logoHelperSource = readRepoFile(
    "app/services/email/components/mileyoEmailLogo.ts",
  );
  const infoCardSource = readRepoFile(
    "app/services/email/components/MileyoInfoCard.tsx",
  );
  const buttonSource = readRepoFile(
    "app/services/email/components/MileyoEmailButton.tsx",
  );
  const tokensSource = readRepoFile(
    "app/services/email/components/mileyoEmailTokens.ts",
  );

  ctx.assertTrue(
    "tokens: stack sans Inter / system (pas Georgia)",
    tokensSource.includes("Inter, -apple-system") &&
      !tokensSource.includes("Georgia") &&
      !tokensSource.includes("Times New Roman") &&
      !tokensSource.includes("Times, serif"),
  );
  ctx.assertTrue(
    "tokens: display = même famille sans serif",
    tokensSource.includes(
      "export const mileyoEmailDisplayFontFamily = mileyoEmailFontFamily",
    ),
  );
  ctx.assertTrue(
    "tokens: titres letter-spacing négatif",
    tokensSource.includes('letterSpacing: "-0.02em"') ||
      tokensSource.includes("letterSpacing: '-0.02em'"),
  );

  ctx.assertTrue(
    "layout embarque MileyoEmailHeader",
    layoutSource.includes("MileyoEmailHeader"),
  );
  ctx.assertTrue(
    "layout embarque MileyoEmailFooter",
    layoutSource.includes("MileyoEmailFooter"),
  );
  ctx.assertTrue(
    "layout embarque Preview (preheader)",
    layoutSource.includes("Preview"),
  );
  ctx.assertFalse(
    "layout sans wordmark texte MILEYO",
    layoutSource.includes(">MILEYO<") ||
      layoutSource.includes("MILEYO</Text>"),
  );
  ctx.assertTrue(
    "header utilise Img logo",
    headerSource.includes("Img") && headerSource.includes("getMileyoEmailLogoSrc"),
  );
  ctx.assertTrue(
    "header text-align center",
    headerSource.includes('textAlign: "center"') ||
      headerSource.includes("textAlign: 'center'"),
  );
  ctx.assertTrue(
    "helper logo CDN Shopify centralisé",
    logoHelperSource.includes("MILEYO_EMAIL_LOGO_URL") &&
      logoHelperSource.includes("cdn.shopify.com") &&
      logoHelperSource.includes("Mileyo_Mileyo_violet_sur_Blanc_1.png"),
  );
  ctx.assertFalse(
    "helper logo sans SHOPIFY_APP_URL",
    logoHelperSource.includes("SHOPIFY_APP_URL") ||
      logoHelperSource.includes("getMileyoLogoSrc"),
  );
  ctx.assertEqual(
    "constante logo = helper",
    MILEYO_EMAIL_LOGO_URL,
    "https://cdn.shopify.com/s/files/1/0965/8512/2120/files/Mileyo_Mileyo_violet_sur_Blanc_1.png?v=1779889306",
  );
  ctx.assertTrue(
    "InfoCard spacing compact (16px entre groupes)",
    infoCardSource.includes('marginBottom:') &&
      infoCardSource.includes('"16px"'),
  );
  ctx.assertTrue(
    "InfoCard padding interne compact",
    infoCardSource.includes('padding: "12px 14px"'),
  );
  ctx.assertTrue(
    "CTA couleur purple-black charte",
    buttonSource.includes("mileyoEmailColors.button") &&
      tokensSource.includes("#5A1B69"),
  );
  ctx.assertTrue("fond cream charte", tokensSource.includes("#FCF8F6"));
  ctx.assertFalse(
    "bouton sans fallback URL visible",
    buttonSource.includes("Le bouton ne fonctionne pas"),
  );

  ctx.scenario("C. Dates FR premium (sans horodatage technique)");
  ctx.assertEqual(
    "delivery date FR",
    formatSubscriptionEmailDeliveryDate("2026-08-27"),
    "27 août 2026",
  );
  const retryLabel = formatPaymentEmailDateTime(
    new Date("2026-08-26T09:28:23.000Z"),
  );
  ctx.assertTrue(
    "retry date sans secondes brutes",
    Boolean(retryLabel) &&
      !retryLabel!.includes(":") &&
      !retryLabel!.includes("2026-08-26T") &&
      retryLabel!.includes("août"),
  );

  ctx.scenario("D. Rendu des 7 templates + variantes pause");
  const renders = [
    await renderEmailTemplate("subscription-created", {
      customerName: "Alice",
      mealsCount: 8,
      nextDelivery: "27 août 2026",
      portalUrl,
    }),
    await renderEmailTemplate("subscription-paused", {
      customerName: "Bob",
      pauseCause: "user_voluntary",
      portalUrl,
    }),
    await renderEmailTemplate("subscription-paused", {
      customerName: "Claire",
      pauseCause: "payment_final_failure",
      portalUrl,
    }),
    await renderEmailTemplate("payment-failed", {
      customerName: "Dana",
      failureCount: 1,
      nextRetryAt: "26 août 2026",
      portalUrl,
    }),
    await renderEmailTemplate("payment-recovered", {
      customerName: "Eve",
      portalUrl,
    }),
    await renderEmailTemplate("meal-selection-confirmed", {
      customerName: "Fay",
      deliveryDateLabel: "27 août 2026",
      mealsCount: 2,
      portalUrl,
      selectedCount: 2,
      selectedMeals: ["Poulet", "Saumon"],
    }),
    await renderEmailTemplate("meal-selection-reminder", {
      customerName: "Gus",
      cutoffLabel: "24 août 2026",
      deliveryDateLabel: "27 août 2026",
      mealsCount: 8,
      portalUrl,
    }),
    await renderEmailTemplate("upcoming-delivery", {
      customerName: "Hana",
      deliveryDateLabel: "27 août 2026",
      mealsCount: 3,
      portalUrl,
      selectedMeals: ["Poulet curry", "Saumon teriyaki", "Lasagnes"],
      supportHref: "mailto:contact@mileyo.fr",
      supportLabel: "Nous contacter",
    }),
  ];

  for (const [index, rendered] of renders.entries()) {
    ctx.assertTrue(`render ${index} html non vide`, rendered.html.length > 0);
    ctx.assertTrue(`render ${index} text non vide`, rendered.text.length > 0);
    ctx.assertTrue(
      `render ${index} logo CDN Shopify`,
      rendered.html.includes(MILEYO_EMAIL_LOGO_URL) &&
        rendered.html.includes('alt="Mileyo"'),
    );
    ctx.assertFalse(
      `render ${index} sans logo app/ngrok`,
      rendered.html.includes("mileyo-logo.png") ||
        rendered.html.includes("ngrok"),
    );
    ctx.assertFalse(
      `render ${index} sans wordmark texte MILEYO`,
      />\s*MILEYO\s*</.test(rendered.html),
    );
    ctx.assertTrue(
      `render ${index} footer support`,
      rendered.html.includes("Une question ?"),
    );
    ctx.assertTrue(
      `render ${index} footer Mileyo`,
      rendered.html.includes("Mileyo"),
    );
    ctx.assertTrue(
      `render ${index} fond cream`,
      rendered.html.includes("#FCF8F6") || rendered.html.includes("#fcf8f6"),
    );
    ctx.assertFalse(
      `render ${index} sans undefined littéral`,
      /\bundefined\b/.test(rendered.html) || /\bundefined\b/.test(rendered.text),
    );
    ctx.assertFalse(
      `render ${index} sans [object Object]`,
      rendered.html.includes("[object Object]") ||
        rendered.text.includes("[object Object]"),
    );
    ctx.assertFalse(
      `render ${index} sans fallback URL long`,
      rendered.html.includes("Le bouton ne fonctionne pas"),
    );

    for (const forbidden of FORBIDDEN_CLIENT_COPY) {
      if (forbidden === "undefined" || forbidden === "null") {
        continue;
      }
      ctx.assertFalse(
        `render ${index} sans copy technique « ${forbidden} »`,
        rendered.html.includes(forbidden) || rendered.text.includes(forbidden),
      );
    }
  }

  const paymentFailed = renders[3]!;
  ctx.assertTrue(
    "PaymentFailed titre UX",
    paymentFailed.html.includes(
      "Un problème est survenu avec votre paiement",
    ),
  );
  ctx.assertTrue(
    "PaymentFailed retry humain",
    paymentFailed.html.includes("Nous réessaierons automatiquement le") &&
      paymentFailed.html.includes("26 août 2026"),
  );
  ctx.assertFalse(
    "PaymentFailed sans tentative enregistrée",
    paymentFailed.html.includes("Tentative") &&
      paymentFailed.html.includes("enregistrée"),
  );
  ctx.assertTrue(
    "PaymentFailed CTA",
    paymentFailed.html.includes("Gérer mon abonnement"),
  );

  const paymentRecovered = renders[4]!;
  ctx.assertTrue(
    "PaymentRecovered CTA",
    paymentRecovered.html.includes("Accéder à mon espace Mileyo"),
  );

  const created = renders[0]!;
  ctx.assertTrue(
    "SubscriptionCreated CTA",
    created.html.includes("Accéder à mon espace Mileyo"),
  );
  ctx.assertTrue(
    "SubscriptionCreated preheader",
    created.html.includes("Votre abonnement Mileyo est maintenant actif"),
  );
  ctx.assertTrue(
    "SubscriptionCreated CTA couleur charte",
    created.html.includes("#5A1B69") || created.html.includes("#5a1b69"),
  );
  ctx.assertTrue(
    "SubscriptionCreated titres charte",
    created.html.includes("#5A1B69") || created.html.includes("#5a1b69"),
  );

  const pausedVoluntary = renders[1]!;
  ctx.assertTrue(
    "Paused voluntary CTA",
    pausedVoluntary.html.includes("Gérer mon abonnement"),
  );

  const reminder = renders[6]!;
  ctx.assertTrue("Reminder CTA", reminder.html.includes("Choisir mes repas"));

  const upcoming = renders[7]!;
  ctx.assertTrue(
    "Upcoming layout partagé",
    upcoming.html.includes(MILEYO_EMAIL_LOGO_URL) &&
      upcoming.html.includes("Votre box arrive bientôt"),
  );
  ctx.assertTrue(
    "Upcoming CTA",
    upcoming.html.includes("Voir mes prochaines livraisons"),
  );
  ctx.assertFalse(
    "Upcoming sans fallback lien long",
    upcoming.html.includes("Le bouton ne fonctionne pas") ||
      upcoming.html.includes("Copiez ce lien"),
  );

  ctx.scenario("E. Greeting sans prénom → Bonjour,");
  const noName = await renderEmailTemplate("payment-recovered", {
    customerName: "   ",
    portalUrl,
  });
  ctx.assertTrue("greeting neutre", noName.html.includes("Bonjour,"));
  ctx.assertFalse(
    "pas de Bonjour undefined",
    noName.html.includes("Bonjour undefined") ||
      noName.html.includes("Bonjour null"),
  );

  ctx.scenario("F. Logo indépendant de SHOPIFY_APP_URL");
  const previousAppUrl = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = "https://should-not-appear-in-logo.ngrok.app";
  try {
    const withAppUrl = await renderEmailTemplate("payment-recovered", {
      customerName: "Iris",
      portalUrl,
    });
    ctx.assertTrue(
      "logo CDN présent même avec SHOPIFY_APP_URL",
      withAppUrl.html.includes(MILEYO_EMAIL_LOGO_URL),
    );
    ctx.assertFalse(
      "logo n'utilise pas SHOPIFY_APP_URL",
      withAppUrl.html.includes("should-not-appear-in-logo.ngrok.app"),
    );
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.SHOPIFY_APP_URL;
    } else {
      process.env.SHOPIFY_APP_URL = previousAppUrl;
    }
  }

  return finishSuite("74-email-template-design-system", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
