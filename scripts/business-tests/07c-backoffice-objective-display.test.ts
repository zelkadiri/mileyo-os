/**
 * Business regression — backoffice objective display
 * (Préparation detail / Commandes historical / Abonnements current).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { buildOrdersCsvContent } from "../../app/features/orders/orders-csv";
import type { AdminOrderDto } from "../../app/features/orders/orders-types";
import { getPreparationObjectiveLabel } from "../../app/features/preparation/preparation-csv";
import {
  resolveCurrentSubscriptionObjective,
  resolveSubscriptionObjectiveFromVariantId,
} from "../../app/services/subscriptionObjectiveResolution.server";
import {
  formatSubscriptionObjectiveLabel,
  parseSubscriptionObjective,
  UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
} from "../../app/utils/subscriptionObjective";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const VARIANT_WL = "gid://shopify/ProductVariant/wl";
const VARIANT_BALANCED = "gid://shopify/ProductVariant/bal";
const VARIANT_BULK = "gid://shopify/ProductVariant/bulk";

const catalog = [
  {
    mealCount: 8,
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    price: "59.00",
    productId: "gid://shopify/Product/1",
    productTitle: "Box",
    sellingPlanId: "gid://shopify/SellingPlan/1",
    variantId: VARIANT_WL,
    variantTitle: "8 repas / Perte de poids",
  },
  {
    mealCount: 8,
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    price: "59.00",
    productId: "gid://shopify/Product/1",
    productTitle: "Box",
    sellingPlanId: "gid://shopify/SellingPlan/1",
    variantId: VARIANT_BALANCED,
    variantTitle: "8 repas / Équilibré",
  },
  {
    mealCount: 8,
    objective: SUBSCRIPTION_OBJECTIVE.BULK,
    price: "59.00",
    productId: "gid://shopify/Product/1",
    productTitle: "Box",
    sellingPlanId: "gid://shopify/SellingPlan/1",
    variantId: VARIANT_BULK,
    variantTitle: "8 repas / Prise de masse",
  },
];

const baseAdminOrder = (
  overrides: Partial<AdminOrderDto> = {},
): AdminOrderDto => ({
  boxTitle: "Box 8 repas",
  cancelledAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  customerEmail: "client@example.com",
  customerName: "Client",
  financialStatus: "paid",
  fulfillmentStatus: "unfulfilled",
  futureBoxTitle: null,
  futureMealsCount: null,
  futureSelectedMeals: null,
  futureSubscriptionPrice: null,
  futureUpdatedAt: null,
  id: "order-1",
  isSubscriptionRenewal: false,
  mealsCount: 8,
  objective: null,
  orderType: "Abonnement hebdomadaire",
  selectedMeals: ["Lasagnes"],
  selectedMealsSource: "order_properties",
  shopifyOrderId: "1000",
  shopifyOrderName: "#1000",
  simulated: false,
  ...overrides,
});

const runSuite = async () => {
  const ctx = createBusinessTestContext("07c-backoffice-objective-display");

  ctx.scenario("A/B. Labels Préparation / format partagé");
  ctx.assertEqual(
    "A balanced label",
    getPreparationObjectiveLabel(SUBSCRIPTION_OBJECTIVE.BALANCED),
    "Équilibré",
  );
  ctx.assertEqual(
    "B unknown via preparation helper",
    getPreparationObjectiveLabel("unknown"),
    UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
  );
  ctx.assertEqual(
    "shared null label",
    formatSubscriptionObjectiveLabel(null),
    UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
  );
  ctx.assertEqual(
    "shared weight_loss label",
    formatSubscriptionObjectiveLabel(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "Perte de poids",
  );

  ctx.scenario("C/D. Commandes DTO snapshot + CSV");
  const weightLossOrder = baseAdminOrder({
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  });
  ctx.assertEqual(
    "C parse weight_loss",
    parseSubscriptionObjective("weight_loss"),
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "C UI label",
    formatSubscriptionObjectiveLabel(weightLossOrder.objective),
    "Perte de poids",
  );
  const nullOrder = baseAdminOrder({ objective: null });
  ctx.assertEqual(
    "D unknown label",
    formatSubscriptionObjectiveLabel(nullOrder.objective),
    UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
  );
  const csv = buildOrdersCsvContent([weightLossOrder, nullOrder]);
  ctx.assertTrue(
    "CSV has Objective headers",
    csv.includes('"Objective"') && csv.includes('"Objective label"'),
  );
  ctx.assertTrue(
    "CSV weight_loss row",
    csv.includes('"weight_loss","Perte de poids"'),
  );
  ctx.assertTrue(
    "CSV null objective empty code + unknown label",
    csv.includes(`"","${UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL}"`),
  );

  ctx.scenario("E. Abonnements — live bulk overrides historical weight_loss BoxOrder");
  const objectiveFromLive = await resolveCurrentSubscriptionObjective({
    admin: { graphql: async () => new Response("{}") },
    boxVariantShopifyId: VARIANT_WL,
    catalog,
    fetchContractVariantId: async () => VARIANT_BULK,
    subscriptionContractId: "gid://shopify/SubscriptionContract/1",
  });
  ctx.assertEqual(
    "E live bulk wins over selection WL fallback",
    objectiveFromLive,
    SUBSCRIPTION_OBJECTIVE.BULK,
  );
  ctx.assertEqual(
    "E display Prise de masse",
    formatSubscriptionObjectiveLabel(objectiveFromLive),
    "Prise de masse",
  );
  // Historical BoxOrder stays independent:
  ctx.assertEqual(
    "E historical BoxOrder still weight_loss",
    formatSubscriptionObjectiveLabel(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "Perte de poids",
  );

  ctx.scenario("F. Fallback selection.boxVariantShopifyId when no live variant");
  const fromSelection = await resolveCurrentSubscriptionObjective({
    admin: { graphql: async () => new Response("{}") },
    boxVariantShopifyId: VARIANT_BALANCED,
    catalog,
    fetchContractVariantId: async () => null,
    subscriptionContractId: "gid://shopify/SubscriptionContract/2",
  });
  ctx.assertEqual(
    "F balanced from selection variant",
    fromSelection,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );

  ctx.scenario("G. Résolution impossible → null, pas de throw");
  const unresolved = await resolveCurrentSubscriptionObjective({
    admin: { graphql: async () => new Response("{}") },
    boxVariantShopifyId: "gid://shopify/ProductVariant/missing",
    catalog,
    fetchContractVariantId: async () => {
      throw new Error("shopify down");
    },
    subscriptionContractId: "gid://shopify/SubscriptionContract/3",
  });
  ctx.assertEqual("G objective null", unresolved, null);
  ctx.assertEqual(
    "G label unknown",
    formatSubscriptionObjectiveLabel(unresolved),
    UNKNOWN_SUBSCRIPTION_OBJECTIVE_LABEL,
  );
  ctx.assertEqual(
    "pure catalog miss",
    resolveSubscriptionObjectiveFromVariantId(catalog, "gid://shopify/ProductVariant/x"),
    null,
  );

  ctx.scenario("Source wiring UI");
  const prepRender = readRepoFile(
    "app/features/preparation/preparation-render.tsx",
  );
  const ordersRender = readRepoFile("app/features/orders/orders-render.tsx");
  const ordersData = readRepoFile("app/features/orders/orders-data.server.ts");
  const subsRender = readRepoFile(
    "app/features/subscriptions/subscriptions-render.tsx",
  );
  const subsData = readRepoFile(
    "app/features/subscriptions/subscriptions-data.server.ts",
  );

  ctx.assertTrue(
    "prep detail shows Objectif via getPreparationObjectiveLabel",
    prepRender.includes("Objectif :") &&
      prepRender.includes("getPreparationObjectiveLabel") &&
      prepRender.includes('order.objective ?? "unknown"'),
  );
  ctx.assertTrue(
    "orders maps BoxOrder.objective only",
    ordersData.includes("parseSubscriptionObjective(order.objective)") &&
      !ordersData.includes("resolveCurrentSubscriptionObjective"),
  );
  ctx.assertTrue(
    "orders UI formatSubscriptionObjectiveLabel",
    ordersRender.includes("formatSubscriptionObjectiveLabel(order.objective)"),
  );
  ctx.assertTrue(
    "subscriptions uses resolveCurrentSubscriptionObjective",
    subsData.includes("resolveCurrentSubscriptionObjective") &&
      subsData.includes("fetchBuilderBoxOptions"),
  );
  ctx.assertTrue(
    "subscriptions does not use BoxOrder.objective for display",
    !subsData.includes("order.objective") &&
      subsRender.includes("Objectif actuel :") &&
      subsRender.includes("formatSubscriptionObjectiveLabel(selection.objective)"),
  );
  ctx.assertTrue(
    "subscriptions loads catalog once per page",
    subsData.includes("catalog = await fetchBuilderBoxOptions(admin)"),
  );

  return finishSuite("07c-backoffice-objective-display", ctx);
};

runSuite()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
