/**
 * Business regression — portal change-objective is support-only (no mutation).
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
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SUPPORT_HREF = "https://support.example/chat";
const OBJECTIVE_HELP_MESSAGE =
  "Le changement d'objectif nécessite l'aide de notre équipe afin d'adapter votre abonnement. Contactez-nous via le chat.";

const activeSelection = (): PortalSelection => ({
  boxChangeBlocked: false,
  boxChangeBlockedReason: null,
  boxSubscriptionPrice: "76.11",
  boxTitle: "Box 8 repas",
  currentVariantId: "gid://shopify/ProductVariant/811",
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
  portalState: "active",
  recovery: null,
  resumeBlockedMessage: null,
  resumeRequiresPayment: false,
  selectedMeals: ["Poulet tikka"],
  shopifyOrderName: "#1001",
  status: "active",
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

const extractChangeObjectiveClickHandler = (portalClient: string) => {
  const start = portalClient.indexOf(
    'changeObjectiveButton.addEventListener("click"',
  );
  const end = portalClient.indexOf("var pauseButton", start);

  return start >= 0 && end > start ? portalClient.slice(start, end) : "";
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("34-portal-change-objective-support");
  const portalActions = readSource("app/features/portal/portal-actions.server.ts");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const merchantSupportHelper = readSource("app/utils/merchantSupport.server.ts");
  const changeObjectiveClick = extractChangeObjectiveClickHandler(portalClient);

  const html = await renderPortal({
    boxes: [sampleBox()],
    historyOrders: [],
    meals: [],
    merchantSupport: {
      href: SUPPORT_HREF,
      isConfigured: true,
      label: "Nous contacter",
    },
    selections: [activeSelection()],
    terminalSelections: [],
  }).text();

  ctx.scenario("A. Bouton, message d'aide et CTA support présents");
  ctx.assertTrue(
    "bouton Changer d'objectif rendu",
    html.includes("Changer d'objectif") &&
      html.includes("change-objective-button"),
  );
  ctx.assertTrue("message d'aide rendu", html.includes(OBJECTIVE_HELP_MESSAGE));
  ctx.assertTrue(
    "CTA Contacter le support rendu",
    html.includes("Contacter le support") &&
      html.includes("objective-support-contact"),
  );
  ctx.assertTrue(
    "CTA réutilise merchantSupport.href",
    html.includes(`href="${SUPPORT_HREF}"`),
  );
  ctx.assertTrue(
    "portail continue d'utiliser getMerchantSupportContact",
    portalData.includes("getMerchantSupportContact(shop)"),
  );
  ctx.assertTrue(
    "helper support — URL configurable (AppSettings + env + fallback)",
    merchantSupportHelper.includes("MILEYO_SUPPORT_CONTACT_URL") &&
      merchantSupportHelper.includes("mailto:contact@mileyo.fr") &&
      merchantSupportHelper.includes("supportChatUrl"),
  );
  ctx.assertTrue(
    "render branche le CTA sur merchantSupport.href",
    portalRender.includes("merchantSupport.href") &&
      portalRender.includes("Contacter le support"),
  );
  ctx.assertTrue(
    "bouton distinct des autres actions",
    html.includes("Préparer ma semaine") &&
      html.includes("Changer de box") &&
      html.includes("Mettre mon abonnement en pause") &&
      html.includes("objective-support"),
  );

  ctx.scenario("B. Aucune action serveur de changement d'objectif");
  ctx.assertFalse(
    "pas d'intent changeObjective",
    portalActions.includes('intent === "changeObjective"') ||
      portalActions.includes('intent === "updateObjective"') ||
      portalActions.includes("changeSubscriptionObjective"),
  );
  ctx.assertFalse(
    "client ne poste pas d'intent objectif",
    portalClient.includes("changeSubscriptionObjective") ||
      portalClient.includes('body.set("intent", "changeObjective"') ||
      portalClient.includes('body.set("intent", "updateObjective"'),
  );
  ctx.assertTrue(
    "intents portail inchangés",
    portalActions.includes('intent === "pauseSubscription"') &&
      portalActions.includes('intent === "changeSubscriptionBox"') &&
      portalActions.includes('intent !== "updateFutureMealSelection"') &&
      portalActions.includes('intent === "resumeSubscription"'),
  );

  ctx.scenario("C. Aucune mutation Shopify ajoutée");
  ctx.assertTrue(
    "clic objectif uniquement affiche le panneau",
    changeObjectiveClick.includes('objectiveSupportPanel.classList.remove("hidden")'),
  );
  ctx.assertFalse(
    "clic objectif ne fait pas de POST",
    changeObjectiveClick.includes("fetch(") ||
      changeObjectiveClick.includes("XMLHttpRequest") ||
      changeObjectiveClick.includes("method: \"POST\""),
  );
  ctx.assertFalse(
    "clic objectif ne crée pas de draft Shopify",
    changeObjectiveClick.includes("subscriptionContract") ||
      changeObjectiveClick.includes("subscriptionDraft") ||
      changeObjectiveClick.includes("intent"),
  );
  ctx.assertFalse(
    "actions portail n'ajoutent pas de mutation objectif",
    portalActions.includes("updateSubscriptionObjective") ||
      portalActions.includes("SubscriptionContractUpdateForObjective"),
  );

  return finishSuite("34-portal-change-objective-support", ctx);
};

process.exitCode = await runSuite();
