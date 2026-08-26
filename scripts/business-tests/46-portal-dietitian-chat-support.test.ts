/**
 * Business regression — portal dietitian chat uses merchantSupport (UX-3A).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { renderPortal } from "../../app/features/portal/portal-render";
import type {
  PortalBoxProduct,
  PortalSelection,
} from "../../app/features/portal/portal-types";
import {
  MERCHANT_SUPPORT_FALLBACK_HREF,
  isAllowedSupportChatUrl,
  resolveMerchantSupportContact,
} from "../../app/utils/merchantSupport.server";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const CHAT_HREF = "https://chat.example/dietitian";

const activeSelection = (): PortalSelection => ({
  boxChangeAppliesNextCycle: false,
  boxChangeBlocked: false,
  boxChangeBlockedReason: null,
  boxSubscriptionPrice: "76.11",
  boxTitle: "Box 8 repas",
  createdAt: "2026-08-01T10:00:00.000Z",
  currentVariantId: "gid://shopify/ProductVariant/811",
  deliveryAddress: {
    address: {
      address1: "6 rue d'Armaille",
      address2: null,
      city: "Paris",
      countryCode: "FR",
      firstName: "Khalid",
      lastName: "Ramdani",
      provinceCode: null,
      zip: "75017",
    },
    blockKind: null,
    blockMessage: null,
    editable: true,
  },
  deliveryCutoff: {
    deadlineLabel: null,
    isKnown: false,
    isPassed: false,
  },
  forecastCycles: [],
  id: "sel-1",
  mealsCount: 8,
  modificationBlocked: false,
  modificationBlockedReason: null,
  nextBillingDate: "2026-08-27T00:00:00.000Z",
  nextScheduledDeliveryDate: "2026-08-27",
  objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  objectiveLabel: "Perte de poids",
  paymentUpdateAvailable: true,
  paymentUpdateUnavailableReason: null,
  pendingBoxChange: null,
  portalState: "active",
  preferredDeliveryWeekday: 4,
  recovery: null,
  resumeBlockedMessage: null,
  resumeRequiresPayment: false,
  selectedMeals: ["Poulet tikka"],
  shopifyOrderName: "#1001",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/1001",
});

const sampleBox = (): PortalBoxProduct => ({
  imageAlt: "Box 8 repas",
  imageUrl: null,
  mealCount: 8,
  objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  price: "76.11",
  title: "Box 8 repas",
  variantId: "gid://shopify/ProductVariant/811",
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("46-portal-dietitian-chat-support");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const settingsActions = readSource(
    "app/features/settings/settings-actions.server.ts",
  );
  const settingsRender = readSource(
    "app/features/settings/settings-render.tsx",
  );
  const schema = readSource("prisma/schema.prisma");

  ctx.scenario("A. Helper — priorité AppSettings → env → mailto");
  const fromSettings = resolveMerchantSupportContact({
    envUrl: "https://env.example/chat",
    supportChatUrl: CHAT_HREF,
  });
  ctx.assertEqual("AppSettings prioritaire", fromSettings.href, CHAT_HREF);
  ctx.assertTrue("AppSettings → isConfigured", fromSettings.isConfigured);

  const fromEnv = resolveMerchantSupportContact({
    envUrl: "https://env.example/chat",
    supportChatUrl: null,
  });
  ctx.assertEqual(
    "env utilisé si AppSettings absent",
    fromEnv.href,
    "https://env.example/chat",
  );
  ctx.assertTrue("env → isConfigured", fromEnv.isConfigured);

  const fromFallback = resolveMerchantSupportContact({
    envUrl: null,
    supportChatUrl: "   ",
  });
  ctx.assertEqual(
    "mailto fallback",
    fromFallback.href,
    MERCHANT_SUPPORT_FALLBACK_HREF,
  );
  ctx.assertFalse("fallback → not configured", fromFallback.isConfigured);

  ctx.assertTrue(
    "https autorisé",
    isAllowedSupportChatUrl("https://crisp.chat/example"),
  );
  ctx.assertTrue(
    "http autorisé",
    isAllowedSupportChatUrl("http://localhost:3000/chat"),
  );
  ctx.assertTrue(
    "mailto autorisé",
    isAllowedSupportChatUrl("mailto:contact@mileyo.fr"),
  );
  ctx.assertFalse(
    "javascript refusé",
    isAllowedSupportChatUrl("javascript:alert(1)"),
  );
  ctx.assertFalse("vide refusé", isAllowedSupportChatUrl(""));

  ctx.scenario("B. Portal — CTA diététicienne = lien merchantSupport");
  const html = await renderPortal({
    boxes: [sampleBox()],
    historyOrders: [],
    meals: [],
    merchantSupport: {
      href: CHAT_HREF,
      isConfigured: true,
      label: "Nous contacter",
    },
    selections: [activeSelection()],
    terminalSelections: [],
  }).text();

  ctx.assertTrue(
    "bloc diététicienne présent",
    html.includes("Votre diététicienne") && html.includes("Ouvrir le chat"),
  );
  ctx.assertTrue(
    "lien avec classe dietitian-chat-button",
    html.includes('class="portal-button secondary dietitian-chat-button"') &&
      html.includes(`href="${CHAT_HREF}"`),
  );
  ctx.assertTrue(
    "ouverture nouvel onglet sécurisée",
    html.includes('target="_blank"') &&
      html.includes('rel="noopener noreferrer"'),
  );
  ctx.assertFalse(
    "plus de bouton mort dietitian",
    html.includes('<button class="portal-button secondary dietitian-chat-button"'),
  );
  ctx.assertTrue(
    "render utilise merchantSupport.href pour le chat",
    portalRender.includes("dietitian-chat-button") &&
      portalRender.includes("merchantSupport.href"),
  );
  ctx.assertTrue(
    "portal-data appelle getMerchantSupportContact(shop)",
    portalData.includes("getMerchantSupportContact(shop)"),
  );
  ctx.assertFalse(
    "portal-client sans handler dietitian",
    portalClient.includes("dietitian"),
  );

  ctx.scenario("C. Admin + schema");
  ctx.assertTrue(
    "schema AppSettings.supportChatUrl",
    schema.includes("supportChatUrl"),
  );
  ctx.assertTrue(
    "settings intent saveSupportChatUrl",
    settingsActions.includes('intent === "saveSupportChatUrl"') &&
      settingsActions.includes("isAllowedSupportChatUrl"),
  );
  ctx.assertTrue(
    "section Support client dans settings",
    settingsRender.includes("Support client") &&
      settingsRender.includes("URL du chat diététicien") &&
      settingsRender.includes("saveSupportChatUrl"),
  );

  return finishSuite("46-portal-dietitian-chat-support", ctx);
};

process.exitCode = await runSuite();
