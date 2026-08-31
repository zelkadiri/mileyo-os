/**
 * Business regression — order cancellation lifecycle (PROD-HARDENING).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPreparationDeliveryOrdersCsvContent,
  buildPreparationProductionCsvContent,
} from "../../app/features/preparation/preparation-csv";
import { buildPreparationDayDataFromBoxOrders } from "../../app/features/preparation/preparation-data.server";
import type { PreparationBoxOrderRecord } from "../../app/features/preparation/preparation-types";
import {
  __resetOrdersCancelledWebhookTestDb,
  __setOrdersCancelledWebhookTestDb,
  handleOrdersCancelledWebhook,
} from "../../app/features/orders-webhook/orders-cancelled-orchestrator.server";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../../app/constants/boxOrder";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const SHOP = "mileyo-dev.myshopify.com";
const TARGET_DATE = parseDeliveryDate("2026-07-16")!;
const CANCELLED_AT = new Date("2026-08-31T14:00:00.000Z");

const baseOrder = (
  overrides: Partial<PreparationBoxOrderRecord> & { id: string },
): PreparationBoxOrderRecord => ({
  boxTitle: "Box 8 repas",
  cancelledAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  customerEmail: "client@example.com",
  customerName: "Client Test",
  deliveryRescheduleReason: null,
  desiredDeliveryDate: TARGET_DATE,
  isSubscriptionRenewal: false,
  mealsCount: 3,
  orderType: "Abonnement hebdomadaire",
  scheduledDeliveryDate: TARGET_DATE,
  selectedMeals: [],
  shopifyOrderName: "#1001",
  simulated: false,
  ...overrides,
});

type MemBoxOrder = {
  id: string;
  shop: string;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  rawOrder: unknown;
  cancelledAt: Date | null;
  scheduledDeliveryDate: string | null;
  simulated: boolean;
  subscriptionSelectionId: string | null;
};

const createWebhookMemoryDb = (initial: MemBoxOrder[]) => {
  const orders = initial.map((order) => ({ ...order }));

  return {
    boxOrder: {
      findUnique: async ({
        where,
      }: {
        where: {
          shop_shopifyOrderId: { shop: string; shopifyOrderId: string };
        };
      }) => {
        const { shop, shopifyOrderId } = where.shop_shopifyOrderId;
        return (
          orders.find(
            (order) =>
              order.shop === shop && order.shopifyOrderId === shopifyOrderId,
          ) ?? null
        );
      },
      update: async ({
        data,
        where,
      }: {
        data: Partial<MemBoxOrder>;
        where: {
          shop_shopifyOrderId: { shop: string; shopifyOrderId: string };
        };
      }) => {
        const { shop, shopifyOrderId } = where.shop_shopifyOrderId;
        const index = orders.findIndex(
          (order) =>
            order.shop === shop && order.shopifyOrderId === shopifyOrderId,
        );

        if (index < 0) {
          throw new Error("BoxOrder not found");
        }

        orders[index] = { ...orders[index]!, ...data };
        return orders[index]!;
      },
    },
    snapshot: () => orders.map((order) => ({ ...order })),
  };
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("94-order-cancellation-lifecycle");

  ctx.scenario("A. Webhook orders/cancelled");
  ctx.given("BoxOrder existante pour commande Shopify");
  const memoryDb = createWebhookMemoryDb([
    {
      cancelledAt: null,
      financialStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      id: "box-1",
      rawOrder: { id: 9001 },
      scheduledDeliveryDate: TARGET_DATE,
      shop: SHOP,
      shopifyOrderId: "9001",
      shopifyOrderName: "#1021",
      simulated: false,
      subscriptionSelectionId: "sel-1",
    },
  ]);
  __setOrdersCancelledWebhookTestDb(memoryDb as never);

  const first = await handleOrdersCancelledWebhook({
    payload: {
      cancelled_at: CANCELLED_AT.toISOString(),
      financial_status: "voided",
      fulfillment_status: "unfulfilled",
      id: 9001,
    },
    shop: SHOP,
    topic: "orders/cancelled",
  });
  const afterFirst = memoryDb.snapshot()[0]!;

  ctx.assertEqual("first run updates BoxOrder", first.outcome, "updated");
  ctx.assertTrue(
    "cancelledAt set from payload",
    afterFirst.cancelledAt instanceof Date,
  );
  ctx.assertEqual(
    "financialStatus synced",
    afterFirst.financialStatus,
    "voided",
  );

  const replay = await handleOrdersCancelledWebhook({
    payload: {
      cancelled_at: "2026-09-01T10:00:00.000Z",
      financial_status: "voided",
      id: 9001,
    },
    shop: SHOP,
    topic: "orders/cancelled",
  });
  const afterReplay = memoryDb.snapshot()[0]!;

  ctx.assertEqual("replay stays updated", replay.outcome, "updated");
  ctx.assertEqual(
    "cancelledAt preserved on replay",
    afterReplay.cancelledAt?.toISOString(),
    CANCELLED_AT.toISOString(),
  );

  const noBox = await handleOrdersCancelledWebhook({
    payload: { cancelled_at: CANCELLED_AT.toISOString(), id: 9999 },
    shop: SHOP,
    topic: "orders/cancelled",
  });
  ctx.assertEqual("unknown Shopify order is no-op", noBox.outcome, "skipped");
  ctx.assertEqual(
    "unknown Shopify order reason",
    noBox.reason,
    "box_order_not_found",
  );

  __resetOrdersCancelledWebhookTestDb();

  ctx.scenario("B. Préparation — exclusion annulée");
  ctx.given("1 réelle, 1 simulée, 1 annulée");
  const mixedOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "real-order",
      selectedMeals: ["Poulet tikka", "Saumon"],
      shopifyOrderName: "#3001",
    }),
    baseOrder({
      cancelledAt: CANCELLED_AT,
      id: "cancelled-order",
      selectedMeals: ["Poulet tikka", "Poulet tikka", "Boulgour"],
      shopifyOrderName: "#3002",
    }),
    baseOrder({
      id: "simulated-order",
      selectedMeals: ["Ignored"],
      shopifyOrderName: "SIM-3003",
      simulated: true,
    }),
  ];
  const mixedData = buildPreparationDayDataFromBoxOrders(mixedOrders, TARGET_DATE);

  ctx.assertEqual("only real active order counted", mixedData.summary.totalOrders, 1);
  ctx.assertTrue(
    "cancelled order excluded",
    mixedData.orders.every((order) => order.id !== "cancelled-order"),
  );
  ctx.assertTrue(
    "simulated order excluded",
    mixedData.orders.every((order) => order.id !== "simulated-order"),
  );
  ctx.assertEqual(
    "cancelled meals not in totals",
    mixedData.mealTotals.find((meal) => meal.mealTitle === "Boulgour"),
    undefined,
  );

  const productionCsv = buildPreparationProductionCsvContent(mixedData);
  const deliveryCsv = buildPreparationDeliveryOrdersCsvContent(mixedData);
  ctx.assertTrue(
    "production CSV excludes cancelled order meals",
    productionCsv.includes("Poulet tikka") && !productionCsv.includes("Boulgour"),
  );
  ctx.assertTrue(
    "delivery CSV excludes cancelled order name",
    deliveryCsv.includes("#3001") && !deliveryCsv.includes("#3002"),
  );

  const cancelledOnly = buildPreparationDayDataFromBoxOrders(
    [
      baseOrder({
        cancelledAt: CANCELLED_AT,
        id: "only-cancelled",
        selectedMeals: ["Saumon"],
        shopifyOrderName: "#3999",
      }),
    ],
    TARGET_DATE,
  );
  ctx.assertEqual(
    "cancelled-only day has zero kitchen orders",
    cancelledOnly.summary.totalOrders,
    0,
  );

  ctx.scenario("C. Renewal collision — annulée ignorée");
  const deliveryScheduleSource = readRepoFile("app/services/deliverySchedule.server.ts");
  ctx.assertTrue(
    "collision query excludes cancelled orders via kitchen filter",
    deliveryScheduleSource.includes("KITCHEN_PREPARATION_BOX_ORDER_WHERE") &&
      deliveryScheduleSource.includes("findRenewalDeliveryCycleCollision"),
  );

  ctx.scenario("D. Commandes back-office");
  const ordersRenderSource = readRepoFile("app/features/orders/orders-render.tsx");
  const ordersDataSource = readRepoFile("app/features/orders/orders-data.server.ts");
  ctx.assertTrue(
    "orders page shows Annulée label",
    ordersRenderSource.includes("Annulée") &&
      ordersRenderSource.includes("order.cancelledAt"),
  );
  ctx.assertTrue(
    "orders loader maps cancelledAt",
    ordersDataSource.includes("cancelledAt: order.cancelledAt"),
  );

  ctx.scenario("E. Shopify config + webhook route");
  const devToml = readRepoFile("shopify.app.dev.toml");
  const prodToml = readRepoFile("shopify.app.production.toml");
  ctx.assertTrue(
    "dev TOML registers orders/cancelled",
    devToml.includes('topics = [ "orders/cancelled" ]') &&
      devToml.includes('uri = "/webhooks/orders/cancelled"'),
  );
  ctx.assertTrue(
    "production TOML registers orders/cancelled",
    prodToml.includes('topics = [ "orders/cancelled" ]') &&
      prodToml.includes('uri = "/webhooks/orders/cancelled"'),
  );
  ctx.assertTrue(
    "kitchen filter constant exported",
    KITCHEN_PREPARATION_BOX_ORDER_WHERE.cancelledAt === null &&
      KITCHEN_PREPARATION_BOX_ORDER_WHERE.simulated === false,
  );

  return finishSuite("94-order-cancellation-lifecycle", ctx);
};

runSuite().then((code) => {
  process.exitCode = code;
});
