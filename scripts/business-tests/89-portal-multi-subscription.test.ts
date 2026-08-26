/**
 * Business regression — PORTAL-MULTISUB-2
 * Multi-subscription selector + total portal isolation (no free objective change).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { MILEYO_PORTAL_PATH } from "../../app/constants/mileyoPortal";
import {
  buildPortalActionRequestUrl,
  buildPortalHistoryOrderFilters,
  buildPortalSubscriptionHref,
  formatPortalSubscriptionSelectorLabel,
  pickDefaultPortalSubscriptionId,
  pickPortalAppOwnedSearchParams,
  PORTAL_APP_OWNED_QUERY_PARAMS,
  PORTAL_INVALID_SUBSCRIPTION_NOTICE,
  PORTAL_SUBSCRIPTION_QUERY_PARAM,
  resolveSelectedPortalSubscriptionId,
} from "../../app/features/portal/portal-multi-subscription";
import { renderPortal } from "../../app/features/portal/portal-render";
import type {
  PortalBoxProduct,
  PortalForecastCycle,
  PortalHistoryOrder,
  PortalLegacySubscription,
  PortalSelection,
} from "../../app/features/portal/portal-types";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SUPPORT = {
  href: "https://support.example/chat",
  isConfigured: true,
  label: "Contacter Mileyo",
};

const sampleBox = (): PortalBoxProduct => ({
  imageAlt: "Box 10 repas",
  imageUrl: null,
  mealCount: 10,
  objective: SUBSCRIPTION_OBJECTIVE.BULK,
  price: "96.33",
  title: "Box 10 repas",
  variantId: "gid://shopify/ProductVariant/10",
});

const forecast = (mealsCount: number): PortalForecastCycle[] => [
  {
    boxSubscriptionPrice: "96.33",
    boxTitle: `Box ${mealsCount} repas`,
    estimatedBillingDate: "2026-09-05T22:05:00.000Z",
    mealsCount,
  },
];

const baseSelection = (
  overrides: Partial<PortalSelection> & { id: string },
): PortalSelection => ({
  boxChangeAppliesNextCycle: false,
  boxChangeBlocked: false,
  boxChangeBlockedReason: null,
  boxSubscriptionPrice: "96.33",
  boxTitle: "Box 10 repas",
  createdAt: "2026-08-01T10:00:00.000Z",
  currentVariantId: "gid://shopify/ProductVariant/10",
  deliveryAddress: {
    address: null,
    blockKind: null,
    blockMessage: null,
    editable: false,
  },
  deliveryCutoff: {
    deadlineLabel: null,
    isKnown: false,
    isPassed: false,
  },
  forecastCycles: [],
  mealsCount: 10,
  modificationBlocked: false,
  modificationBlockedReason: null,
  nextBillingDate: "2026-08-29T22:05:00.000Z",
  nextScheduledDeliveryDate: "2026-09-03",
  objective: SUBSCRIPTION_OBJECTIVE.BULK,
  objectiveLabel: "Prise de masse",
  paymentUpdateAvailable: false,
  paymentUpdateUnavailableReason: "unsupported",
  pendingBoxChange: null,
  portalState: "active",
  preferredDeliveryWeekday: 4,
  recovery: null,
  resumeBlockedMessage: null,
  resumeRequiresPayment: false,
  selectedMeals: ["Poulet"],
  shopifyOrderName: "#2001",
  status: "active",
  subscriptionContractId: "gid://shopify/SubscriptionContract/2001",
  ...overrides,
});

const historyOrder = (
  overrides: Partial<PortalHistoryOrder> & { id: string },
): PortalHistoryOrder => ({
  boxTitle: "Box 10 repas",
  financialStatus: "paid",
  fulfillmentStatus: "fulfilled",
  orderDate: "2026-08-10T12:00:00.000Z",
  price: "96.33",
  selectedMeals: ["Poulet"],
  shopifyOrderName: "#H1",
  statusPageUrl: null,
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("89-portal-multi-subscription");

  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const portalActions = readSource("app/features/portal/portal-actions.server.ts");
  const portalRoute = readSource("app/routes/apps.box-builder.portal.tsx");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const multiSub = readSource(
    "app/features/portal/portal-multi-subscription.ts",
  );

  ctx.scenario("1. 1 active V2 — pas de gros selector, une carte");
  {
    const selection = baseSelection({ id: "sel-a" });
    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      portalRequestUrl:
        "https://shop.example/apps/box-builder/portal?shop=x&logged_in_customer_id=1",
      selectedSubscriptionId: "sel-a",
      selections: [selection],
      terminalSelections: [],
    }).text();

    ctx.assertFalse(
      "selector markup hidden for single sub",
      html.includes('aria-label="Mes abonnements"'),
    );
    ctx.assertEqual(
      "one selection card",
      (html.match(/class="portal-card selection-card/g) ?? []).length,
      1,
    );
    ctx.assertTrue(
      "card is sel-a",
      html.includes('data-selection-id="sel-a"'),
    );
  }

  ctx.scenario("2–3. 2 active / active+paused — selector visible");
  {
    const a = baseSelection({ id: "sel-a", mealsCount: 10 });
    const b = baseSelection({
      createdAt: "2026-08-02T10:00:00.000Z",
      id: "sel-b",
      mealsCount: 8,
      objectiveLabel: "Perte de poids",
      portalState: "paused",
      preferredDeliveryWeekday: 4,
      status: "paused",
    });
    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      portalRequestUrl:
        "https://shop.example/apps/box-builder/portal?shop=x&logged_in_customer_id=1",
      selectedSubscriptionId: "sel-a",
      selections: [a, b],
      terminalSelections: [],
    }).text();

    ctx.assertTrue("Mes abonnements title", html.includes("Mes abonnements"));
    ctx.assertTrue(
      "two selector options",
      (html.match(/subscription-selector-option/g) ?? []).length >= 2,
    );
    ctx.assertTrue(
      "paused option present",
      html.includes("En pause · 8 repas · Jeudi"),
    );
    ctx.assertTrue(
      "active selected",
      html.includes('aria-current="true"') &&
        html.includes('data-selection-id="sel-a"'),
    );
  }

  ctx.scenario("4–6. Default selection ranking");
  {
    const activeFar = {
      createdAt: "2026-08-01T10:00:00.000Z",
      id: "active-far",
      nextScheduledDeliveryDate: "2026-09-20",
      status: "active",
    };
    const activeNear = {
      createdAt: "2026-08-01T09:00:00.000Z",
      id: "active-near",
      nextScheduledDeliveryDate: "2026-09-03",
      status: "active",
    };
    const pausedNear = {
      createdAt: "2026-08-10T10:00:00.000Z",
      id: "paused-near",
      nextScheduledDeliveryDate: "2026-09-01",
      status: "paused",
    };

    ctx.assertEqual(
      "active before paused",
      pickDefaultPortalSubscriptionId([pausedNear, activeFar]),
      "active-far",
    );
    ctx.assertEqual(
      "nearest delivery wins among actives",
      pickDefaultPortalSubscriptionId([activeFar, activeNear, pausedNear]),
      "active-near",
    );

    const tieOlder = {
      createdAt: "2026-08-01T10:00:00.000Z",
      id: "older",
      nextScheduledDeliveryDate: "2026-09-03",
      status: "active",
    };
    const tieNewer = {
      createdAt: "2026-08-05T10:00:00.000Z",
      id: "newer",
      nextScheduledDeliveryDate: "2026-09-03",
      status: "active",
    };
    ctx.assertEqual(
      "createdAt desc tie-break",
      pickDefaultPortalSubscriptionId([tieOlder, tieNewer]),
      "newer",
    );

    const withNull = {
      createdAt: "2026-08-09T10:00:00.000Z",
      id: "null-date",
      nextScheduledDeliveryDate: null,
      status: "active",
    };
    ctx.assertEqual(
      "null dates after real dates",
      pickDefaultPortalSubscriptionId([withNull, activeNear]),
      "active-near",
    );
  }

  ctx.scenario("7–10. Query ownership + fallback");
  {
    const candidates = [
      {
        createdAt: "2026-08-01T10:00:00.000Z",
        id: "sel-a",
        nextScheduledDeliveryDate: "2026-09-03",
        status: "active",
      },
      {
        createdAt: "2026-08-02T10:00:00.000Z",
        id: "sel-b",
        nextScheduledDeliveryDate: "2026-09-10",
        status: "active",
      },
    ];

    ctx.assertEqual(
      "valid B selected",
      resolveSelectedPortalSubscriptionId({
        candidates,
        requestedSubscriptionId: "sel-b",
      }).selectedSubscriptionId,
      "sel-b",
    );

    const foreign = resolveSelectedPortalSubscriptionId({
      candidates,
      requestedSubscriptionId: "foreign-other-customer",
    });
    ctx.assertEqual(
      "foreign never selected",
      foreign.selectedSubscriptionId,
      "sel-a",
    );
    ctx.assertTrue("foreign uses soft fallback", foreign.usedFallback);

    const otherShop = resolveSelectedPortalSubscriptionId({
      candidates,
      requestedSubscriptionId: "sel-other-shop",
    });
    ctx.assertEqual(
      "other shop id never selected",
      otherShop.selectedSubscriptionId,
      "sel-a",
    );
    ctx.assertTrue("other shop soft fallback", otherShop.usedFallback);

    const invalid = resolveSelectedPortalSubscriptionId({
      candidates,
      requestedSubscriptionId: "not-a-real-id",
    });
    ctx.assertEqual(
      "invalid falls back to default",
      invalid.selectedSubscriptionId,
      "sel-a",
    );
    ctx.assertTrue("invalid usedFallback", invalid.usedFallback);
    ctx.assertTrue(
      "soft notice constant defined",
      PORTAL_INVALID_SUBSCRIPTION_NOTICE.includes("Abonnement introuvable"),
    );
  }

  ctx.scenario("11–14. Single main subscription + forecast isolation");
  {
    const a = baseSelection({
      forecastCycles: forecast(16),
      id: "sel-a",
      mealsCount: 10,
      pendingBoxChange: {
        boxSubscriptionPrice: "140.00",
        boxTitle: "Box 16 repas",
        effectiveBillingDate: "2026-08-29T22:05:00.000Z",
        mealsCount: 16,
        productVariantId: "gid://shopify/ProductVariant/16",
        selectedMeals: ["A"],
      },
    });
    const b = baseSelection({
      createdAt: "2026-08-02T10:00:00.000Z",
      forecastCycles: forecast(8),
      id: "sel-b",
      mealsCount: 8,
      objectiveLabel: "Perte de poids",
    });

    const htmlA = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      portalRequestUrl: "https://shop.example/apps/box-builder/portal",
      selectedSubscriptionId: "sel-a",
      selections: [a, b],
      terminalSelections: [],
    }).text();

    ctx.assertEqual(
      "only one main card when A selected",
      (htmlA.match(/class="portal-card selection-card/g) ?? []).length,
      1,
    );
    ctx.assertTrue("A card", htmlA.includes('data-selection-id="sel-a"'));
    ctx.assertFalse("B card absent", htmlA.includes('data-selection-id="sel-b"'));
    ctx.assertTrue(
      "A pending notice visible",
      htmlA.includes("data-pending-box-meals=\"16\""),
    );
    ctx.assertTrue(
      "forecast shows A pending 16",
      htmlA.includes("<strong>Nombre de repas :</strong> 16"),
    );
    ctx.assertFalse(
      "B forecast 8 does not leak",
      htmlA.includes("<strong>Nombre de repas :</strong> 8"),
    );

    const htmlB = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      portalRequestUrl: "https://shop.example/apps/box-builder/portal",
      selectedSubscriptionId: "sel-b",
      selections: [a, b],
      terminalSelections: [],
    }).text();

    ctx.assertTrue("B card", htmlB.includes('data-selection-id="sel-b"'));
    ctx.assertFalse(
      "A pending does not leak to B",
      htmlB.includes("data-pending-box-meals=\"16\""),
    );
    ctx.assertTrue(
      "forecast B only 8",
      htmlB.includes("<strong>Nombre de repas :</strong> 8"),
    );
    ctx.assertFalse(
      "forecast A 16 absent on B",
      htmlB.includes("<strong>Nombre de repas :</strong> 16"),
    );
  }

  ctx.scenario("15–16. History isolation (loader filters + render)");
  {
    const filtersA = buildPortalHistoryOrderFilters({
      allowEmailFallback: false,
      customerEmail: "a@example.com",
      selectionId: "sel-a",
      shopifyOrderId: "gid://shopify/Order/1",
      subscriptionContractId: "gid://shopify/SubscriptionContract/A",
    });
    ctx.assertTrue(
      "history prefers selection id",
      filtersA.some((f) => f.subscriptionSelectionId === "sel-a"),
    );
    ctx.assertTrue(
      "history includes contract",
      filtersA.some(
        (f) =>
          f.subscriptionContractId === "gid://shopify/SubscriptionContract/A",
      ),
    );
    ctx.assertFalse(
      "no email when multi-sub",
      filtersA.some((f) => "customerEmail" in f),
    );

    const filtersSingle = buildPortalHistoryOrderFilters({
      allowEmailFallback: true,
      customerEmail: "solo@example.com",
      selectionId: "sel-solo",
      shopifyOrderId: null,
      subscriptionContractId: null,
    });
    ctx.assertTrue(
      "email fallback for single legacy",
      filtersSingle.some((f) => f.customerEmail === "solo@example.com"),
    );

    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [
        historyOrder({ id: "h-a", shopifyOrderName: "#ONLY-A" }),
      ],
      meals: [],
      merchantSupport: SUPPORT,
      selectedSubscriptionId: "sel-a",
      selections: [
        baseSelection({ id: "sel-a" }),
        baseSelection({ id: "sel-b", createdAt: "2026-08-02T00:00:00.000Z" }),
      ],
      terminalSelections: [],
    }).text();
    ctx.assertTrue("history A rendered", html.includes("#ONLY-A"));
    ctx.assertTrue(
      "loader scopes history by selection",
      portalData.includes("loadPortalHistoryOrdersForSelection") &&
        portalData.includes("buildPortalHistoryOrderFilters"),
    );
  }

  ctx.scenario("17–19. Action forms scoped + ownership-preserving reload");
  {
    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      selectedSubscriptionId: "sel-b",
      selections: [
        baseSelection({ id: "sel-a" }),
        baseSelection({
          createdAt: "2026-08-02T00:00:00.000Z",
          id: "sel-b",
          mealsCount: 12,
        }),
      ],
      terminalSelections: [],
    }).text();

    ctx.assertTrue(
      "client payload only selected B",
      html.includes('"id":"sel-b"') && !html.includes('"id":"sel-a"'),
    );
    ctx.assertTrue(
      "actions reload with requestedSubscriptionId",
      portalActions.includes(
        "requestedSubscriptionId: selectionId",
      ),
    );
    ctx.assertTrue(
      "actions preserve portalRequestUrl",
      portalActions.includes("portalRequestUrl: requestUrl"),
    );
    ctx.assertTrue(
      "ownership still findFirst by customer+shop+id",
      portalActions.includes("customerShopifyId,") &&
        portalActions.includes("id: selectionId,") &&
        portalActions.includes("shop,"),
    );
    ctx.assertFalse(
      "never findUnique by query alone",
      portalActions.includes("findUnique({ id: selectionId") ||
        portalData.includes("findUnique({ where: { id: requested"),
    );
  }

  ctx.scenario("20–22. Paused visible; terminal / archived absent from selector");
  {
    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      selectedSubscriptionId: "sel-paused",
      selections: [
        baseSelection({ id: "sel-active" }),
        baseSelection({
          createdAt: "2026-08-02T00:00:00.000Z",
          id: "sel-paused",
          portalState: "paused",
          status: "paused",
        }),
      ],
      terminalSelections: [
        {
          boxTitle: "Box 8 repas",
          id: "sel-cancelled",
          lastOrderDate: null,
          mealsCount: 8,
          selectedMeals: [],
          shopifyOrderName: "#C1",
          status: "cancelled",
          statusLabel: "Annulé",
          subscriptionContractId: null,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    }).text();

    const selectorChunk = html.slice(
      html.indexOf('aria-label="Mes abonnements"'),
      html.indexOf('role="tablist"'),
    );
    ctx.assertTrue(
      "paused in selector",
      selectorChunk.includes("En pause"),
    );
    ctx.assertTrue(
      "resume CTA when paused selected",
      html.includes("Reprendre mon abonnement"),
    );
    ctx.assertFalse(
      "cancelled not in selector options",
      selectorChunk.includes("sel-cancelled"),
    );
    ctx.assertTrue(
      "archived_duplicate never in terminal statuses query",
      portalData.includes('status: { in: ["active", "paused"] }') &&
        !portalData.includes("archived_duplicate"),
    );
    ctx.assertTrue(
      "terminals stay in Terminés tab",
      html.includes("Abonnements terminés") && html.includes("Annulé"),
    );
    ctx.assertFalse(
      "cancelled id not a selector href target",
      /subscription-selector-option[\s\S]{0,400}sel-cancelled/.test(html),
    );
  }

  ctx.scenario("23–24. Legacy V1 secondary section, no V2 actions");
  {
    const legacy: PortalLegacySubscription = {
      id: "sel-v1",
      mealsCount: 16,
      nextScheduledDeliveryDate: "2026-09-03",
      shopifyOrderName: "#V1",
      status: "active",
      statusLabel: "Actif",
    };
    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      legacySubscriptions: [legacy],
      meals: [],
      merchantSupport: SUPPORT,
      selectedSubscriptionId: "sel-a",
      selections: [baseSelection({ id: "sel-a" })],
      terminalSelections: [],
    }).text();

    const legacyChunk = html.slice(
      html.indexOf("Autres abonnements"),
      html.indexOf('data-tab-panel="upcoming"'),
    );
    ctx.assertTrue(
      "Autres abonnements section",
      html.includes("Autres abonnements"),
    );
    ctx.assertTrue(
      "legacy copy",
      html.includes("ancienne formule Mileyo"),
    );
    ctx.assertTrue(
      "support CTA",
      html.includes("Contacter Mileyo") || html.includes(SUPPORT.href),
    );
    ctx.assertFalse(
      "legacy has no change box button in its card",
      legacyChunk.includes("Changer de box"),
    );
    ctx.assertTrue(
      "loader maps legacy when shouldInclude false",
      portalData.includes("legacy:") &&
        portalData.includes("ancienne formule") === false &&
        portalData.includes("PortalLegacySubscription"),
    );
  }

  ctx.scenario("25. Objective label only — not editable");
  {
    ctx.assertEqual(
      "selector label uses objective",
      formatPortalSubscriptionSelectorLabel({
        mealsCount: 10,
        objectiveLabel: "Prise de masse",
        preferredDeliveryWeekday: 4,
        status: "active",
      }),
      "Prise de masse · 10 repas · Jeudi",
    );
    ctx.assertTrue(
      "no objective mutation intent",
      !portalActions.includes('intent === "changeObjective"') &&
        !portalActions.includes("updateSubscriptionObjective"),
    );
    ctx.assertTrue(
      "support-only objective wording retained in render",
      portalRender.includes("nutritionniste") ||
        portalRender.includes("Changer d'objectif"),
    );
  }

  ctx.scenario("26–27. Clean portal href — strip Shopify App Proxy signed params");
  {
    const proxyIncoming =
      "https://shop.example/apps/box-builder/portal" +
      "?shop=x.myshopify.com" +
      "&logged_in_customer_id=99" +
      "&path_prefix=%2Fapps%2Fbox-builder" +
      "&timestamp=1710000000" +
      "&signature=deadbeef" +
      "&hmac=abc" +
      "&host=xx" +
      "&embedded=1" +
      "&unknown_noise=1" +
      "&subscription=sel-a" +
      "&tab=should-not-keep";

    const hrefA = buildPortalSubscriptionHref(proxyIncoming, "sel-a");
    const hrefB = buildPortalSubscriptionHref(proxyIncoming, "sel-b");

    for (const [label, href] of [
      ["href A", hrefA],
      ["href B", hrefB],
    ] as const) {
      ctx.assertFalse(`${label} strips shop`, href.includes("shop="));
      ctx.assertFalse(
        `${label} strips logged_in_customer_id`,
        href.includes("logged_in_customer_id"),
      );
      ctx.assertFalse(
        `${label} strips timestamp`,
        href.includes("timestamp="),
      );
      ctx.assertFalse(
        `${label} strips signature`,
        href.includes("signature="),
      );
      ctx.assertFalse(`${label} strips hmac`, href.includes("hmac="));
      ctx.assertFalse(
        `${label} strips path_prefix`,
        href.includes("path_prefix"),
      );
      ctx.assertFalse(`${label} strips host`, href.includes("host="));
      ctx.assertFalse(
        `${label} strips embedded`,
        href.includes("embedded="),
      );
      ctx.assertFalse(
        `${label} strips unknown noise`,
        href.includes("unknown_noise"),
      );
      ctx.assertFalse(
        `${label} does not keep non-allowlisted tab`,
        href.includes("tab="),
      );
    }

    ctx.assertEqual(
      "href A canonical",
      hrefA,
      `${MILEYO_PORTAL_PATH}?${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-a`,
    );
    ctx.assertEqual(
      "href B canonical",
      hrefB,
      `${MILEYO_PORTAL_PATH}?${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-b`,
    );

    const html = await renderPortal({
      boxes: [sampleBox()],
      historyOrders: [],
      meals: [],
      merchantSupport: SUPPORT,
      portalRequestUrl: proxyIncoming,
      selectedSubscriptionId: "sel-a",
      selections: [
        baseSelection({ id: "sel-a" }),
        baseSelection({
          createdAt: "2026-08-02T00:00:00.000Z",
          id: "sel-b",
          mealsCount: 12,
        }),
      ],
      terminalSelections: [],
    }).text();

    ctx.assertTrue(
      "selector href A in HTML",
      html.includes(
        `href="${MILEYO_PORTAL_PATH}?${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-a"`,
      ),
    );
    ctx.assertTrue(
      "selector href B in HTML",
      html.includes(
        `href="${MILEYO_PORTAL_PATH}?${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-b"`,
      ),
    );
    ctx.assertFalse(
      "HTML selector has no signature",
      /subscription-selector[\s\S]*signature=/.test(html),
    );
    ctx.assertFalse(
      "HTML selector has no shop=",
      /subscription-selector[\s\S]*shop=/.test(html),
    );

    ctx.assertTrue(
      "allowlist is positive subscription-only",
      PORTAL_APP_OWNED_QUERY_PARAMS.length === 1 &&
        PORTAL_APP_OWNED_QUERY_PARAMS[0] === PORTAL_SUBSCRIPTION_QUERY_PARAM,
    );

    const picked = pickPortalAppOwnedSearchParams(proxyIncoming);
    ctx.assertEqual(
      "pick keeps only subscription",
      picked.toString(),
      `${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-a`,
    );

    const actionUrl = buildPortalActionRequestUrl(proxyIncoming);
    ctx.assertEqual(
      "action URL drops proxy auth",
      actionUrl,
      `${MILEYO_PORTAL_PATH}?${PORTAL_SUBSCRIPTION_QUERY_PARAM}=sel-a`,
    );
    ctx.assertFalse(
      "action URL has no signature",
      actionUrl.includes("signature"),
    );

    ctx.assertTrue(
      "route reads query param",
      portalRoute.includes("getRequestedSubscriptionIdFromRequest"),
    );
    ctx.assertTrue(
      "client uses allowlisted fetch URL helper",
      portalClient.includes("getPortalFetchUrl") &&
        portalClient.includes('current.get("subscription")') &&
        !portalClient.includes(
          "window.location.pathname + window.location.search",
        ),
    );
    ctx.assertTrue(
      "post-action reload keeps selectionId as requestedSubscriptionId",
      portalActions.includes("requestedSubscriptionId: selectionId") &&
        portalActions.includes("portalRequestUrl: requestUrl"),
    );
    ctx.assertFalse(
      "render does not flatMap all forecasts",
      portalRender.includes(".flatMap((selection) => selection.forecastCycles)"),
    );
    ctx.assertTrue(
      "multi-sub helpers module present",
      multiSub.includes("pickDefaultPortalSubscriptionId") &&
        multiSub.includes("resolveSelectedPortalSubscriptionId") &&
        multiSub.includes("pickPortalAppOwnedSearchParams") &&
        multiSub.includes("PORTAL_APP_OWNED_QUERY_PARAMS"),
    );

    const foreign = resolveSelectedPortalSubscriptionId({
      candidates: [
        {
          createdAt: "2026-08-01T10:00:00.000Z",
          id: "sel-a",
          nextScheduledDeliveryDate: "2026-09-03",
          status: "active",
        },
        {
          createdAt: "2026-08-02T10:00:00.000Z",
          id: "sel-b",
          nextScheduledDeliveryDate: "2026-09-10",
          status: "active",
        },
      ],
      requestedSubscriptionId: "foreign-other-customer",
    });
    ctx.assertEqual(
      "invalid selection still soft-falls back",
      foreign.selectedSubscriptionId,
      "sel-a",
    );
    ctx.assertTrue("ownership fallback flag set", foreign.usedFallback);
  }

  return finishSuite("89-portal-multi-subscription", ctx);
};

process.exitCode = await runSuite();
