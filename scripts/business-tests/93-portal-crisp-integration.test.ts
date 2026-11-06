/**
 * Business regression — Crisp widget on portal + box builder (CRISP-1).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { renderBuilder } from "../../app/features/builder/builder-render";
import {
  renderPortalCrispScript,
  resolvePortalCrispConfig,
} from "../../app/features/portal/portal-crisp";
import { renderPortal } from "../../app/features/portal/portal-render";
import type {
  PortalBoxProduct,
  PortalSelection,
} from "../../app/features/portal/portal-types";
import {
  renderCrispScript,
  resolveCrispConfig,
} from "../../app/utils/crisp";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const CHAT_HREF = "https://chat.example/dietitian";
const TEST_CRISP_WEBSITE_ID = "test-crisp-website-id";

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
  subscriptionControlBlocked: false,
  subscriptionControlBlockedReason: null,
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

const renderPortalHtml = async () =>
  renderPortal({
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

const restoreEnv = (
  previous: Record<string, string | undefined>,
  values: Record<string, string | undefined>,
) => {
  for (const key of Object.keys(values)) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const applyEnv = (
  values: Record<string, string | undefined>,
  previous: Record<string, string | undefined>,
) => {
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const withEnvSync = <T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T => {
  const previous: Record<string, string | undefined> = {};
  applyEnv(values, previous);

  try {
    return run();
  } finally {
    restoreEnv(previous, values);
  }
};

const withEnv = async <T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> => {
  const previous: Record<string, string | undefined> = {};
  applyEnv(values, previous);

  try {
    return await run();
  } finally {
    restoreEnv(previous, values);
  }
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("93-portal-crisp-integration");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalCrisp = readSource("app/features/portal/portal-crisp.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");

  ctx.scenario("A. Config — Crisp désactivé");
  withEnvSync(
    {
      CRISP_WEBSITE_ID: undefined,
      ENABLE_PORTAL_CRISP: undefined,
    },
    () => {
      ctx.assertFalse(
        "flag absent → disabled",
        resolvePortalCrispConfig({
          crispWebsiteId: TEST_CRISP_WEBSITE_ID,
        }).enabled,
      );
      ctx.assertFalse(
        "flag false → disabled",
        resolvePortalCrispConfig({
          crispWebsiteId: TEST_CRISP_WEBSITE_ID,
          enablePortalCrisp: "false",
        }).enabled,
      );
      ctx.assertFalse(
        "Website ID absent → disabled",
        resolvePortalCrispConfig({
          crispWebsiteId: "",
          enablePortalCrisp: "true",
        }).enabled,
      );
      ctx.assertFalse(
        "Website ID whitespace → disabled",
        resolvePortalCrispConfig({
          crispWebsiteId: "   ",
          enablePortalCrisp: "true",
        }).enabled,
      );
      ctx.assertFalse(
        "flag whitespace → disabled",
        resolvePortalCrispConfig({
          crispWebsiteId: TEST_CRISP_WEBSITE_ID,
          enablePortalCrisp: "   ",
        }).enabled,
      );
      ctx.assertTrue(
        "flag true + Website ID → enabled",
        resolvePortalCrispConfig({
          crispWebsiteId: TEST_CRISP_WEBSITE_ID,
          enablePortalCrisp: "true",
        }).enabled,
      );
      ctx.assertFalse(
        "no env fallback when flag absent",
        resolvePortalCrispConfig().enabled,
      );
    },
  );

  const disabledHtml = await withEnv(
    {
      CRISP_WEBSITE_ID: "",
      ENABLE_PORTAL_CRISP: "false",
    },
    renderPortalHtml,
  );

  ctx.assertFalse(
    "HTML sans loader Crisp",
    disabledHtml.includes("client.crisp.chat/l.js"),
  );
  ctx.assertFalse(
    "HTML sans CRISP_WEBSITE_ID quand désactivé",
    disabledHtml.includes("CRISP_WEBSITE_ID"),
  );
  ctx.assertTrue(
    "lien support historique préservé",
    disabledHtml.includes(`href="${CHAT_HREF}"`) &&
      disabledHtml.includes('target="_blank"') &&
      disabledHtml.includes("dietitian-chat-button"),
  );
  ctx.assertFalse(
    "pas de bouton Crisp diététicienne quand désactivé",
    disabledHtml.includes(
      'class="portal-button secondary dietitian-chat-button portal-crisp-chat-trigger"',
    ),
  );
  ctx.assertFalse(
    "pas de bouton Crisp objectif quand désactivé",
    disabledHtml.includes(
      'class="portal-button objective-support-contact portal-crisp-chat-trigger"',
    ),
  );
  ctx.assertTrue(
    "objectif conserve lien href historique",
    disabledHtml.includes(
      `<a\n            class="portal-button objective-support-contact"\n            href="${CHAT_HREF}"`,
    ),
  );

  ctx.scenario("B. Portal — Crisp activé");
  const enabledHtml = await withEnv(
    {
      CRISP_WEBSITE_ID: TEST_CRISP_WEBSITE_ID,
      ENABLE_PORTAL_CRISP: "true",
    },
    renderPortalHtml,
  );

  ctx.assertTrue(
    "initialisation $crisp",
    enabledHtml.includes("window.$crisp=[]"),
  );
  ctx.assertTrue(
    "garde anti double-init",
    enabledHtml.includes("__MILEYO_CRISP_LOADED__"),
  );
  ctx.assertTrue(
    "CRISP_WEBSITE_ID injecté",
    enabledHtml.includes("CRISP_WEBSITE_ID"),
  );
  ctx.assertTrue(
    "Website ID depuis config",
    enabledHtml.includes(TEST_CRISP_WEBSITE_ID),
  );
  ctx.assertTrue(
    "loader async Crisp",
    enabledHtml.includes("https://client.crisp.chat/l.js") &&
      enabledHtml.includes("s.async=1"),
  );
  ctx.assertTrue(
    "une seule occurrence du loader Crisp",
    (enabledHtml.match(/client\.crisp\.chat\/l\.js/g) ?? []).length === 1,
  );

  ctx.scenario("C. CTAs Crisp — diététicienne et changement d'objectif");
  ctx.assertTrue(
    "Discuter avec la diététicienne rendu",
    enabledHtml.includes("Discuter avec la diététicienne"),
  );
  ctx.assertTrue(
    "diététicienne avec trigger Crisp",
    enabledHtml.includes(
      'class="portal-button secondary dietitian-chat-button portal-crisp-chat-trigger"',
    ) && enabledHtml.includes(`data-fallback-href="${CHAT_HREF}"`),
  );
  ctx.assertTrue(
    "Contacter le support avec trigger Crisp",
    enabledHtml.includes("Contacter le support") &&
      enabledHtml.includes(
        'class="portal-button objective-support-contact portal-crisp-chat-trigger"',
      ) &&
      enabledHtml.includes(`data-fallback-href="${CHAT_HREF}"`),
  );
  ctx.assertFalse(
    "pas de href direct sur diététicienne quand Crisp actif",
    enabledHtml.includes(
      'class="portal-button secondary dietitian-chat-button"\n            href=',
    ),
  );
  ctx.assertFalse(
    "pas de href direct sur Contacter le support quand Crisp actif",
    enabledHtml.includes(
      'class="portal-button objective-support-contact"\n            href=',
    ),
  );

  ctx.scenario("D. Handler client");
  ctx.assertTrue(
    "chat:open dans portal-client",
    portalClient.includes('["do", "chat:open"]'),
  );
  ctx.assertTrue(
    "sélecteur trigger Crisp partagé",
    portalClient.includes(".portal-crisp-chat-trigger[data-fallback-href]"),
  );
  ctx.assertFalse(
    "pas de handler dupliqué dietitian",
    portalClient.includes(".dietitian-chat-button[data-fallback-href]"),
  );
  ctx.assertTrue(
    "fallback window.open sécurisé",
    portalClient.includes('window.open(fallbackHref, "_blank", "noopener,noreferrer")'),
  );

  ctx.scenario("E. Sécurité");
  const sharedCrisp = readSource("app/utils/crisp.ts");
  const builderRender = readSource("app/features/builder/builder-render.ts");
  const builderStyles = readSource("app/features/builder/builder-styles.ts");
  ctx.assertFalse(
    "aucun user:email Crisp",
    sharedCrisp.includes("user:email") ||
      portalCrisp.includes("user:email") ||
      portalClient.includes("user:email") ||
      builderRender.includes("user:email"),
  );
  ctx.assertFalse(
    "aucun user:nickname Crisp",
    sharedCrisp.includes("user:nickname") ||
      portalCrisp.includes("user:nickname") ||
      portalClient.includes("user:nickname") ||
      builderRender.includes("user:nickname"),
  );
  ctx.assertFalse(
    "aucun session:data Crisp",
    sharedCrisp.includes("session:data") ||
      portalCrisp.includes("session:data") ||
      portalClient.includes("session:data") ||
      builderRender.includes("session:data"),
  );
  ctx.assertFalse(
    "Website ID DEV non hardcodé",
    sharedCrisp.includes("55aab303-5098-4b68-b5cb-436055ed4ee5") ||
      portalCrisp.includes("55aab303-5098-4b68-b5cb-436055ed4ee5") ||
      portalRender.includes("55aab303-5098-4b68-b5cb-436055ed4ee5") ||
      builderRender.includes("55aab303-5098-4b68-b5cb-436055ed4ee5"),
  );
  ctx.assertTrue(
    "Website ID sérialisé via JSON.stringify",
    renderPortalCrispScript(TEST_CRISP_WEBSITE_ID).includes(
      `"${TEST_CRISP_WEBSITE_ID}"`,
    ) &&
      renderCrispScript(TEST_CRISP_WEBSITE_ID).includes(
        `"${TEST_CRISP_WEBSITE_ID}"`,
      ),
  );

  ctx.scenario("F. Wiring render partagé");
  ctx.assertTrue(
    "portal-render utilise utils/crisp + config portal",
    portalRender.includes('from "../../utils/crisp"') &&
      portalRender.includes("renderCrispScriptTag") &&
      portalRender.includes('from "./portal-crisp"') &&
      portalRender.includes("resolvePortalCrispConfig"),
  );
  ctx.assertTrue(
    "portal-crisp re-exporte utils/crisp",
    portalCrisp.includes('from "../../utils/crisp"') &&
      portalCrisp.includes("resolveCrispConfig") &&
      portalCrisp.includes("renderCrispScript"),
  );
  ctx.assertTrue(
    "builder-render importe renderCrispScriptTag",
    builderRender.includes('from "../../utils/crisp"') &&
      builderRender.includes("renderCrispScriptTag"),
  );
  ctx.assertFalse(
    "builder n’offsette pas .crisp-client (évite chat coupé)",
    builderStyles.includes(".tunnel-body .crisp-client") ||
      /crisp-client\s*\{[^}]*bottom\s*:/.test(builderStyles),
  );
  ctx.assertTrue(
    "builder laisse de la place au launcher via padding footer mobile",
    builderStyles.includes(".tunnel-footer-inner") &&
      builderStyles.includes("padding-right: 72px") &&
      builderStyles.includes("native Crisp launcher"),
  );

  ctx.scenario("G. Box Builder — même Website ID / flag");
  const disabledBuilderHtml = await withEnv(
    {
      CRISP_WEBSITE_ID: "",
      ENABLE_PORTAL_CRISP: "false",
    },
    async () =>
      renderBuilder({
        boxes: [],
        deliveryConfig: { deliveryWindowOptions: [], timezone: "Europe/Paris" },
        meals: [],
      }).text(),
  );
  ctx.assertFalse(
    "builder sans loader Crisp quand désactivé",
    disabledBuilderHtml.includes("client.crisp.chat/l.js"),
  );

  const enabledBuilderHtml = await withEnv(
    {
      CRISP_WEBSITE_ID: TEST_CRISP_WEBSITE_ID,
      ENABLE_PORTAL_CRISP: "true",
    },
    async () =>
      renderBuilder({
        boxes: [],
        deliveryConfig: { deliveryWindowOptions: [], timezone: "Europe/Paris" },
        meals: [],
      }).text(),
  );
  ctx.assertTrue(
    "builder initialise $crisp",
    enabledBuilderHtml.includes("window.$crisp=[]"),
  );
  ctx.assertTrue(
    "builder injecte le même Website ID",
    enabledBuilderHtml.includes(TEST_CRISP_WEBSITE_ID),
  );
  ctx.assertTrue(
    "builder loader async unique",
    enabledBuilderHtml.includes("https://client.crisp.chat/l.js") &&
      enabledBuilderHtml.includes("s.async=1") &&
      (enabledBuilderHtml.match(/client\.crisp\.chat\/l\.js/g) ?? []).length ===
        1,
  );
  ctx.assertTrue(
    "resolveCrispConfig ≡ resolvePortalCrispConfig",
    resolveCrispConfig({
      crispWebsiteId: TEST_CRISP_WEBSITE_ID,
      enablePortalCrisp: "true",
    }).enabled ===
      resolvePortalCrispConfig({
        crispWebsiteId: TEST_CRISP_WEBSITE_ID,
        enablePortalCrisp: "true",
      }).enabled,
  );

  return finishSuite("93-portal-crisp-integration", ctx);
};

process.exitCode = await runSuite();
