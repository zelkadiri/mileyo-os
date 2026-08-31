/**
 * Business regression — preparation backoffice aggregation and exports.
 */
import {
  buildPreparationDeliveryOrdersCsvContent,
  buildPreparationProductionCsvContent,
  PREPARATION_DELIVERY_ORDERS_CSV_HEADERS,
  PREPARATION_PRODUCTION_CSV_HEADERS,
} from "../../app/features/preparation/preparation-csv";
import { buildPreparationDayDataFromBoxOrders } from "../../app/features/preparation/preparation-data.server";
import { normalizeSelectedMealsForPreparation } from "../../app/features/preparation/preparation-formatters";
import type { PreparationBoxOrderRecord } from "../../app/features/preparation/preparation-types";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const TARGET_DATE = parseDeliveryDate("2026-07-16")!;

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

const runSuite = () => {
  const ctx = createBusinessTestContext("07-preparation-backoffice");

  const fixtureOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "order-1",
      selectedMeals: ["Poulet tikka", "Poulet tikka", "Saumon"],
      shopifyOrderName: "#1001",
    }),
    baseOrder({
      id: "order-2",
      orderType: "Commande unique",
      selectedMeals: ["Poulet tikka", "Boulgour"],
      shopifyOrderName: "#1002",
    }),
    baseOrder({
      id: "ignored-no-date",
      scheduledDeliveryDate: null,
      selectedMeals: ["Ignored sans date"],
      shopifyOrderName: "#1999",
    }),
  ];

  ctx.scenario("Préparation — agrégation par BoxOrder.scheduledDeliveryDate");
  ctx.given("3 commandes dont 1 sans date livraison");
  const data = buildPreparationDayDataFromBoxOrders(fixtureOrders, TARGET_DATE);
  ctx.when("on agrège pour jeudi 16 juillet");
  ctx.assertEqual("preparation includes 2 orders for target date", data.orders.length, 2);
  ctx.assertEqual(
    "preparation meal total Poulet tikka",
    data.mealTotals.find((meal) => meal.mealTitle === "Poulet tikka")?.totalQuantity,
    3,
  );

  ctx.scenario("Export production CSV correct");
  ctx.given("totaux plats calculés");
  const productionCsv = buildPreparationProductionCsvContent(data);
  ctx.assertTrue(
    "production CSV has headers",
    productionCsv.startsWith(
      PREPARATION_PRODUCTION_CSV_HEADERS.map((header) => `"${header}"`).join(","),
    ),
  );
  ctx.assertTrue("production CSV includes Poulet tikka", productionCsv.includes("Poulet tikka"));

  ctx.scenario("Export commandes CSV correct");
  ctx.given("commandes du jour");
  const deliveryCsv = buildPreparationDeliveryOrdersCsvContent(data);
  ctx.assertTrue(
    "delivery CSV has headers",
    deliveryCsv.startsWith(
      PREPARATION_DELIVERY_ORDERS_CSV_HEADERS.map((header) => `"${header}"`).join(","),
    ),
  );
  ctx.assertTrue("delivery CSV includes order name", deliveryCsv.includes("#1001"));

  ctx.scenario("Projection portail n'altère pas l'historique préparation");
  ctx.given("une commande historique avec date jeudi 16");
  ctx.assertEqual(
    "historical BoxOrder date unchanged",
    data.orders.every((order) => order.scheduledDeliveryDate === TARGET_DATE),
    true,
  );

  ctx.scenario("Commandes sans date livraison ne crashent pas");
  ctx.given("selectedMeals null ou legacy");
  ctx.assertEqual(
    "normalize selected meals fail-safe",
    normalizeSelectedMealsForPreparation(null).length,
    0,
  );
  ctx.assertEqual(
    "orders without delivery date excluded",
    data.orders.some((order) => order.id === "ignored-no-date"),
    false,
  );

  ctx.scenario("Commandes simulées exclues de la préparation cuisine");
  ctx.given("1 commande réelle et 1 commande simulée le même jour");
  const mixedOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "real-order",
      selectedMeals: ["Poulet tikka", "Saumon"],
      shopifyOrderName: "#3001",
    }),
    baseOrder({
      id: "simulated-order",
      selectedMeals: ["Poulet tikka", "Poulet tikka", "Boulgour"],
      shopifyOrderName: "SIM-3002",
      simulated: true,
    }),
  ];
  const mixedData = buildPreparationDayDataFromBoxOrders(mixedOrders, TARGET_DATE);
  ctx.when("on agrège pour la cuisine");
  ctx.assertEqual(
    "real BoxOrder appears in preparation",
    mixedData.orders.some((order) => order.id === "real-order"),
    true,
  );
  ctx.assertEqual(
    "simulated BoxOrder excluded from preparation",
    mixedData.orders.some((order) => order.id === "simulated-order"),
    false,
  );
  ctx.assertEqual(
    "kitchen quantities ignore simulated order",
    mixedData.mealTotals.find((meal) => meal.mealTitle === "Poulet tikka")
      ?.totalQuantity,
    1,
  );
  ctx.assertEqual(
    "simulated-only meals not counted",
    mixedData.mealTotals.some((meal) => meal.mealTitle === "Boulgour"),
    false,
  );
  ctx.assertEqual("only real order counted", mixedData.summary.totalOrders, 1);

  return finishSuite("07-preparation-backoffice", ctx);
};

process.exitCode = runSuite();
