/**
 * Business regression — EMAIL-4A meal selection email foundation.
 *
 * Explicit delivery tracking, templates, helpers, Prisma fields.
 * No Resend network calls. No business wiring.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMealSelectionConfirmedEmailData,
  buildMealSelectionReminderEmailData,
  hasExplicitMealSelectionForDelivery,
  renderEmailTemplate,
  resolveMealSelectionCycle,
  shouldSendMealSelectionConfirmedEmail,
  shouldSendMealSelectionReminderEmail,
  SUBSCRIPTION_PORTAL_PATH,
} from "../../app/services/email/email.server";
import { parisWallClockToInstant, parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const runSuite = async () => {
  const ctx = createBusinessTestContext("55-email-meal-selection-foundation");

  const renderSource = readRepoFile("app/services/email/email-render.server.ts");
  const schemaSource = readRepoFile("prisma/schema.prisma");
  const migrationSource = readRepoFile(
    "prisma/migrations/20260823140000_add_meal_selection_email_tracking/migration.sql",
  );

  ctx.scenario("A. Structure — fichiers EMAIL-4A présents");
  const structureFiles = [
    "app/services/email/templates/MealSelectionConfirmedEmail.tsx",
    "app/services/email/templates/MealSelectionReminderEmail.tsx",
    "app/services/email/meal-selection-email.server.ts",
  ];

  for (const relativePath of structureFiles) {
    const source = readRepoFile(relativePath);
    ctx.assertTrue(`${relativePath} non vide`, source.trim().length > 0);
  }

  ctx.assertTrue(
    "registry meal-selection-confirmed",
    renderSource.includes('"meal-selection-confirmed"'),
  );
  ctx.assertTrue(
    "registry meal-selection-reminder",
    renderSource.includes('"meal-selection-reminder"'),
  );

  ctx.scenario("B. Schema + migration — tracking explicite");
  const prismaFields = [
    "mealSelectionLastExplicitDeliveryDate",
    "mealSelectionConfirmedEmailSentAt",
    "mealSelectionConfirmedDeliveryDate",
    "mealSelectionReminderEmailSentAt",
    "mealSelectionReminderDeliveryDate",
  ];

  for (const field of prismaFields) {
    ctx.assertTrue(`schema ${field}`, schemaSource.includes(field));
    ctx.assertTrue(`migration ${field}`, migrationSource.includes(field));
  }

  ctx.scenario("C. Renderer — MealSelectionConfirmedEmail");
  const confirmedRendered = await renderEmailTemplate("meal-selection-confirmed", {
    customerName: "Alice",
    deliveryDateLabel: "jeudi 27 août 2026",
    mealsCount: 8,
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
    selectedCount: 8,
    selectedMeals: ["Poulet rôti", "Saumon"],
  });
  ctx.assertTrue("confirmed html non vide", confirmedRendered.html.length > 0);
  ctx.assertTrue(
    "confirmed html contient le titre",
    confirmedRendered.html.includes("Sélection confirmée"),
  );
  ctx.assertTrue(
    "confirmed html contient la date",
    confirmedRendered.html.includes("jeudi 27 août 2026"),
  );
  ctx.assertTrue(
    "confirmed html contient CTA modifier",
    confirmedRendered.html.includes("Modifier ma sélection"),
  );
  ctx.assertTrue("confirmed text non vide", confirmedRendered.text.length > 0);

  ctx.scenario("D. Renderer — MealSelectionReminderEmail");
  const reminderRendered = await renderEmailTemplate("meal-selection-reminder", {
    customerName: "Bob",
    cutoffLabel: "lundi 24 août à 23h59",
    deliveryDateLabel: "jeudi 27 août 2026",
    mealsCount: 8,
    portalUrl: "https://mileyo-dev.myshopify.com/apps/box-builder/portal",
  });
  ctx.assertTrue("reminder html non vide", reminderRendered.html.length > 0);
  ctx.assertTrue(
    "reminder html contient le titre",
    reminderRendered.html.includes("Choisissez vos repas"),
  );
  ctx.assertTrue(
    "reminder html mentionne carry-over",
    reminderRendered.html.includes("dernière livraison"),
  );
  ctx.assertTrue(
    "reminder html contient CTA choisir",
    reminderRendered.html.includes("Choisir mes repas"),
  );
  ctx.assertTrue("reminder text non vide", reminderRendered.text.length > 0);

  ctx.scenario("E. Cycle key — effectiveDeliveryDate via projection");
  const cycleNow = new Date("2026-08-20T08:00:00.000Z");
  const cycle = resolveMealSelectionCycle(
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

  const projectedCycle = resolveMealSelectionCycle(
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

  ctx.scenario("F. Explicit tracking — même livraison");
  ctx.assertTrue(
    "hasExplicit true quand dates identiques",
    hasExplicitMealSelectionForDelivery({
      effectiveDeliveryDate: "2026-08-27",
      mealSelectionLastExplicitDeliveryDate: "2026-08-27",
    }),
  );

  ctx.scenario("G. Explicit tracking — nouvelle livraison");
  ctx.assertFalse(
    "hasExplicit false quand explicit date ancienne",
    hasExplicitMealSelectionForDelivery({
      effectiveDeliveryDate: "2026-09-03",
      mealSelectionLastExplicitDeliveryDate: "2026-08-27",
    }),
  );

  ctx.scenario("H. Carry-over complet sans explicit — reminder éligible");
  const carryOverEligible = shouldSendMealSelectionReminderEmail({
    active: true,
    effectiveDeliveryDate: "2026-09-03",
    hasExplicitSelection: false,
    hasRecipient: true,
    mealSelectionReminderDeliveryDate: null,
    now: new Date("2026-08-24T08:00:00.000Z"),
    status: "active",
    subscriptionContractId: "gid://shopify/SubscriptionContract/1",
    transactionalEmailsEnabled: true,
  });
  ctx.assertTrue(
    "reminder accepté malgré selectedMeals complets carry-over",
    carryOverEligible,
  );

  ctx.scenario("I. Reminder idempotence — même delivery date");
  ctx.assertFalse(
    "reminder refusé si déjà envoyé même cycle",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-09-03",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: "2026-09-03",
      now: new Date("2026-08-24T08:00:00.000Z"),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("J. Reminder idempotence — nouvelle delivery date");
  ctx.assertTrue(
    "reminder redevient éligible sur nouveau cycle",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-09-10",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: "2026-09-03",
      now: new Date("2026-08-31T08:00:00.000Z"),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("K. Confirmation idempotence — même cycle");
  ctx.assertFalse(
    "confirmation refusée si déjà envoyée même cycle",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: "2026-08-27",
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("L. Cutoff passé — reminder refusé");
  const tuesdayAfterCutoff = parisWallClockToInstant({
    date: parseDeliveryDate("2026-08-26")!,
    hour: 0,
    minute: 0,
  });
  ctx.assertFalse(
    "reminder refusé après cutoff lundi 23h59",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-28",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: null,
      now: tuesdayAfterCutoff,
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("M. Paused / inactive — reminder refusé");
  ctx.assertFalse(
    "reminder refusé status paused",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: null,
      now: new Date("2026-08-24T08:00:00.000Z"),
      status: "paused",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "reminder refusé active false",
    shouldSendMealSelectionReminderEmail({
      active: false,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: false,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate: null,
      now: new Date("2026-08-24T08:00:00.000Z"),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("N. Recipient absent — refusé");
  ctx.assertFalse(
    "reminder refusé sans recipient",
    shouldSendMealSelectionReminderEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: false,
      hasRecipient: false,
      mealSelectionReminderDeliveryDate: null,
      now: new Date("2026-08-24T08:00:00.000Z"),
      status: "active",
      subscriptionContractId: "gid://shopify/SubscriptionContract/1",
      transactionalEmailsEnabled: true,
    }),
  );
  ctx.assertFalse(
    "confirmation refusée sans recipient",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: true,
      hasRecipient: false,
      mealSelectionConfirmedDeliveryDate: null,
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );

  ctx.scenario("O. Builders — formatage FR + portail");
  const confirmedData = buildMealSelectionConfirmedEmailData({
    customerName: " Alice ",
    effectiveDeliveryDate: "2026-08-27",
    mealsCount: 8,
    selectedMeals: ["Poulet rôti", "Saumon"],
    shop: "mileyo-dev.myshopify.com",
  });
  ctx.assertEqual("confirmed data name trimmed", confirmedData.customerName, "Alice");
  ctx.assertEqual("confirmed data selectedCount", confirmedData.selectedCount, 2);
  ctx.assertTrue(
    "confirmed data deliveryDateLabel formatée",
    confirmedData.deliveryDateLabel.includes("2026"),
  );
  ctx.assertEqual(
    "confirmed data portalUrl depuis shop",
    confirmedData.portalUrl,
    `https://mileyo-dev.myshopify.com${SUBSCRIPTION_PORTAL_PATH}`,
  );

  const reminderData = buildMealSelectionReminderEmailData({
    customerName: "Bob",
    effectiveDeliveryDate: "2026-08-27",
    mealsCount: 8,
    shop: "mileyo-dev.myshopify.com",
  });
  ctx.assertTrue(
    "reminder data cutoffLabel présent",
    reminderData.cutoffLabel.length > 0,
  );
  ctx.assertTrue(
    "reminder data deliveryDateLabel formatée",
    reminderData.deliveryDateLabel.includes("2026"),
  );

  ctx.scenario("P. Explicit date identique — confirmation éligible");
  ctx.assertTrue(
    "confirmation acceptée quand explicit + pas encore envoyée",
    shouldSendMealSelectionConfirmedEmail({
      active: true,
      effectiveDeliveryDate: "2026-08-27",
      hasExplicitSelection: hasExplicitMealSelectionForDelivery({
        effectiveDeliveryDate: "2026-08-27",
        mealSelectionLastExplicitDeliveryDate: "2026-08-27",
      }),
      hasRecipient: true,
      mealSelectionConfirmedDeliveryDate: null,
      status: "active",
      transactionalEmailsEnabled: true,
    }),
  );

  return finishSuite("55-email-meal-selection-foundation", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
