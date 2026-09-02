/**
 * Business regression — EMAIL-5A upcoming delivery email foundation.
 *
 * Prisma tracking, timing window J-2/J-1, cutoff, idempotence, builders.
 * No Resend network calls. No runner / cron wiring.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildUpcomingDeliveryEmailData,
  formatUpcomingDeliveryDateLabel,
  hasUsableUpcomingDeliveryMeals,
  isUpcomingDeliveryCutoffSatisfied,
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  isUpcomingDeliveryEmailSendWindowOpen,
  renderEmailTemplate,
  resolveUpcomingDeliveryCycle,
  shouldSendUpcomingDeliveryEmail,
  SUBSCRIPTION_PORTAL_PATH,
} from "../../app/services/email/email.server";
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

const parisInstant = (date: string, hour: number, minute: number) =>
  parisWallClockToInstant({
    date: parseDeliveryDate(date)!,
    hour,
    minute,
  });

const eligibleBase = {
  active: true as boolean | null,
  hasRecipient: true,
  hasUsableMeals: true,
  status: "active" as string | null,
  subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  transactionalEmailsEnabled: true,
  upcomingDeliveryEmailDeliveryDate: null as string | null,
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("58-email-upcoming-delivery-foundation");

  const renderSource = readRepoFile("app/services/email/email-render.server.ts");
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260823150000_add_upcoming_delivery_email_tracking/migration.sql",
  );
  const serviceSource = readRepoFile(
    "app/services/email/upcoming-delivery-email.server.ts",
  );

  ctx.scenario("A. Structure — fichiers EMAIL-5A présents");
  const structureFiles = [
    "app/services/email/templates/UpcomingDeliveryEmail.tsx",
    "app/services/email/upcoming-delivery-email.server.ts",
  ];

  for (const relativePath of structureFiles) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  ctx.assertTrue(
    "registry upcoming-delivery",
    renderSource.includes('"upcoming-delivery"'),
  );
  ctx.assertTrue(
    "sendEmail uniquement via import dynamique dans trySend",
    serviceSource.includes('await import("./email.server")') &&
      serviceSource.includes("export const trySendUpcomingDeliveryEmail"),
  );

  ctx.scenario("B. Prisma / schema — deux nouveaux champs");
  for (const field of [
    "upcomingDeliveryEmailSentAt",
    "upcomingDeliveryEmailDeliveryDate",
  ]) {
    ctx.assertTrue(`schema ${field}`, schemaSource.includes(field));
    ctx.assertTrue(`migration ${field}`, migrationSource.includes(field));
  }

  ctx.scenario("C. Cycle — effectiveDeliveryDate via projection");
  const cycleNow = new Date("2026-08-20T08:00:00.000Z");
  const cycle = resolveUpcomingDeliveryCycle(
    {
      nextScheduledDeliveryDate: "2026-08-27",
      preferredDeliveryWeekday: 4,
    },
    cycleNow,
  );
  ctx.assertEqual(
    "effectiveDeliveryDate = nextScheduledDeliveryDate future",
    cycle.effectiveDeliveryDate,
    "2026-08-27",
  );

  const projectedCycle = resolveUpcomingDeliveryCycle(
    {
      nextScheduledDeliveryDate: "2026-08-13",
      preferredDeliveryWeekday: 4,
    },
    new Date("2026-08-20T08:00:00.000Z"),
  );
  ctx.assertEqual(
    "effectiveDeliveryDate projetée +7j",
    projectedCycle.effectiveDeliveryDate,
    "2026-08-20",
  );
  ctx.assertTrue("projection flag wasProjected", projectedCycle.wasProjected);

  ctx.scenario("D. Cycle — date inconnue → skip");
  const unknownCycle = resolveUpcomingDeliveryCycle(
    {
      nextScheduledDeliveryDate: null,
      preferredDeliveryWeekday: null,
    },
    cycleNow,
  );
  ctx.assertEqual(
    "effectiveDeliveryDate null sans ancrage",
    unknownCycle.effectiveDeliveryDate,
    null,
  );
  ctx.assertFalse(
    "shouldSend refuse date inconnue",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: null,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );

  ctx.scenario("E. Fenêtre jeudi — J-3 / J-2 / J-1 / jour J");
  const thursdayDelivery = "2026-08-27";

  ctx.assertFalse(
    "J-3 → false",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-24", 12, 0),
    }),
  );
  ctx.assertFalse(
    "J-2 08:59 → false",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 8, 59),
    }),
  );
  ctx.assertTrue(
    "J-2 09:00 → true",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );
  ctx.assertTrue(
    "J-1 → true",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-26", 9, 0),
    }),
  );
  ctx.assertFalse(
    "jour J → false",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-27", 9, 0),
    }),
  );

  ctx.scenario("F. Fenêtre vendredi — mercredi / jeudi / vendredi");
  const fridayDelivery = "2026-08-28";

  ctx.assertTrue(
    "mercredi 09h → true",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: fridayDelivery,
      now: parisInstant("2026-08-26", 9, 0),
    }),
  );
  ctx.assertTrue(
    "jeudi 09h → true",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: fridayDelivery,
      now: parisInstant("2026-08-27", 9, 0),
    }),
  );
  ctx.assertFalse(
    "vendredi → false",
    isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate: fridayDelivery,
      now: parisInstant("2026-08-28", 9, 0),
    }),
  );

  ctx.scenario("G. Cutoff — avant / après / inconnu");
  ctx.assertFalse(
    "avant cutoff → false",
    isUpcomingDeliveryCutoffSatisfied(
      thursdayDelivery,
      parisInstant("2026-08-24", 20, 0),
    ),
  );
  ctx.assertTrue(
    "après cutoff → true",
    isUpcomingDeliveryCutoffSatisfied(
      thursdayDelivery,
      parisInstant("2026-08-25", 0, 0),
    ),
  );
  ctx.assertFalse(
    "cutoff inconnu → false",
    isUpcomingDeliveryCutoffSatisfied(null, parisInstant("2026-08-25", 9, 0)),
  );
  ctx.assertFalse(
    "shouldSend refuse avant cutoff",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-24", 20, 0),
    }),
  );
  ctx.assertTrue(
    "shouldSend accepte après cutoff + fenêtre",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );
  ctx.assertFalse(
    "shouldSend refuse cutoff inconnu",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: "not-a-date",
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );

  ctx.scenario("H. Idempotence");
  ctx.assertTrue(
    "déjà envoyé même effectiveDeliveryDate",
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate: thursdayDelivery,
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );
  ctx.assertFalse(
    "shouldSend skip si déjà envoyé",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );
  ctx.assertTrue(
    "nouvelle effectiveDeliveryDate → eligible",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: "2026-09-03",
      now: parisInstant("2026-09-01", 9, 0),
      upcomingDeliveryEmailDeliveryDate: thursdayDelivery,
    }),
  );

  ctx.scenario("I. Guards — paused / inactive / contract / recipient / meals");
  ctx.assertFalse(
    "paused → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
      status: "paused",
    }),
  );
  ctx.assertFalse(
    "inactive → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      active: false,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );
  ctx.assertFalse(
    "contractId absent → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      now: parisInstant("2026-08-25", 9, 0),
      subscriptionContractId: null,
    }),
  );
  ctx.assertFalse(
    "recipient absent → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      hasRecipient: false,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );
  ctx.assertFalse(
    "selectedMeals non exploitables → skip",
    shouldSendUpcomingDeliveryEmail({
      ...eligibleBase,
      effectiveDeliveryDate: thursdayDelivery,
      hasUsableMeals: false,
      now: parisInstant("2026-08-25", 9, 0),
    }),
  );
  ctx.assertFalse(
    "mealsCount invalide → non usable",
    hasUsableUpcomingDeliveryMeals({
      mealsCount: 0,
      selectedMeals: ["Poulet"],
    }),
  );
  ctx.assertFalse(
    "selectedMeals vide → non usable",
    hasUsableUpcomingDeliveryMeals({
      mealsCount: 8,
      selectedMeals: [],
    }),
  );
  ctx.assertTrue(
    "meals exploitables",
    hasUsableUpcomingDeliveryMeals({
      mealsCount: 8,
      selectedMeals: ["Poulet rôti", "Saumon"],
    }),
  );

  ctx.scenario("J. Builder — date / mealsCount / liste / portalUrl");
  const data = buildUpcomingDeliveryEmailData({
    customerName: " Alice ",
    effectiveDeliveryDate: thursdayDelivery,
    mealsCount: 8,
    selectedMeals: ["Poulet rôti", "Saumon"],
    shop: "mileyo-dev.myshopify.com",
  });
  ctx.assertTrue("builder retourne data", data != null);
  ctx.assertEqual("customerName trimmed", data!.customerName, "Alice");
  ctx.assertEqual(
    "deliveryDateLabel fenêtre jeudi→samedi",
    data!.deliveryDateLabel,
    "entre jeudi 27 août et samedi 29 août",
  );
  ctx.assertEqual("mealsCount", data!.mealsCount, 8);
  ctx.assertEqual("selectedMeals length", data!.selectedMeals.length, 2);
  ctx.assertEqual("selectedMeals[0]", data!.selectedMeals[0], "Poulet rôti");
  ctx.assertEqual(
    "portalUrl depuis shop",
    data!.portalUrl,
    `https://mileyo-dev.myshopify.com${SUBSCRIPTION_PORTAL_PATH}`,
  );

  ctx.assertEqual(
    "upcoming same-month window",
    formatUpcomingDeliveryDateLabel("2026-09-10"),
    "entre jeudi 10 septembre et samedi 12 septembre",
  );
  ctx.assertEqual(
    "upcoming cross-month window",
    formatUpcomingDeliveryDateLabel("2026-04-30"),
    "entre jeudi 30 avril et samedi 2 mai",
  );
  ctx.assertEqual(
    "upcoming cross-year window",
    formatUpcomingDeliveryDateLabel("2026-12-31"),
    "entre jeudi 31 décembre et samedi 2 janvier",
  );

  ctx.scenario("K. Renderer — UpcomingDeliveryEmail polish");
  const portalUrl = "https://mileyo-dev.myshopify.com/apps/box-builder/portal";
  const baseRenderProps = {
    deliveryDateLabel: "entre jeudi 27 août et samedi 29 août",
    mealsCount: 8,
    portalUrl,
    selectedMeals: ["Poulet curry", "Saumon teriyaki", "Lasagnes"],
  };

  const renderedWithName = await renderEmailTemplate("upcoming-delivery", {
    ...baseRenderProps,
    customerName: "Alice",
    supportHref: "mailto:contact@mileyo.fr",
    supportLabel: "Contactez notre équipe",
  });
  const renderedWithoutName = await renderEmailTemplate("upcoming-delivery", {
    ...baseRenderProps,
  });

  const combinedHtml = `${renderedWithName.html} ${renderedWithoutName.html}`;
  const combinedText = `${renderedWithName.text} ${renderedWithoutName.text}`;
  const combinedLower = `${combinedHtml} ${combinedText}`.toLowerCase();

  ctx.assertTrue("html non vide", renderedWithName.html.length > 0);
  ctx.assertTrue("text non vide", renderedWithName.text.length > 0);
  ctx.assertTrue(
    "rendu avec customerName",
    renderedWithName.html.includes("Bonjour Alice"),
  );
  ctx.assertTrue(
    "rendu sans customerName",
    renderedWithoutName.html.includes("Bonjour,"),
  );
  ctx.assertFalse(
    "sans customerName n'invente pas de prénom",
    renderedWithoutName.html.includes("Bonjour Alice"),
  );
  ctx.assertTrue(
    "date livraison présente",
    renderedWithName.html.includes("entre jeudi 27 août et samedi 29 août"),
  );
  ctx.assertTrue(
    "mealsCount rendu",
    renderedWithName.text.includes("8 repas") &&
      renderedWithName.text.includes("dans votre box"),
  );
  ctx.assertTrue(
    "liste repas rendue",
    renderedWithName.html.includes("Poulet curry") &&
      renderedWithName.html.includes("Saumon teriyaki") &&
      renderedWithName.html.includes("Lasagnes"),
  );
  ctx.assertTrue(
    "portalUrl présente",
    renderedWithName.html.includes(portalUrl),
  );
  ctx.assertTrue(
    "CTA Voir mes prochaines livraisons",
    renderedWithName.html.includes("Voir mes prochaines livraisons"),
  );
  ctx.assertTrue(
    "support affiché si fourni",
    renderedWithName.html.includes("Une question ?") &&
      renderedWithName.html.includes("Contactez notre équipe"),
  );
  ctx.assertTrue(
    "support fallback sans supportHref",
    renderedWithoutName.html.includes("Une question ?") &&
      renderedWithoutName.html.includes("Nous contacter"),
  );
  ctx.assertTrue(
    "wording prudent — arrive bientôt",
    renderedWithName.html.includes("arrive bientôt"),
  );
  ctx.assertFalse(
    "absence promesse sera livrée à",
    combinedLower.includes("sera livrée"),
  );
  ctx.assertFalse(
    "pas de CTA modifier repas",
    combinedLower.includes("modifier ma sélection") ||
      combinedLower.includes("modifier mes repas"),
  );

  for (const forbidden of [
    "tracking",
    "adresse",
    "prix",
    "objectif",
    "objective",
    "expédiée aujourd",
  ]) {
    ctx.assertFalse(
      `aucune mention ${forbidden}`,
      combinedLower.includes(forbidden),
    );
  }

  ctx.assertTrue(
    "header logo Mileyo",
    renderedWithName.html.includes("cdn.shopify.com") ||
      renderedWithName.html.includes('alt="Mileyo"') ||
      renderedWithName.html.includes("Mileyo"),
  );
  ctx.assertTrue(
    "titre prochaine box",
    renderedWithName.html.includes("Votre box arrive bientôt"),
  );
  ctx.assertFalse(
    "pas de fallback URL long sous CTA",
    renderedWithName.html.includes("Le bouton ne fonctionne pas") ||
      renderedWithName.html.includes("Copiez ce lien"),
  );

  return finishSuite("58-email-upcoming-delivery-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
