/**
 * Business regression — preparation backoffice aggregation and exports.
 */
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  buildBulkPortionGramsByMealTitle,
  enrichMealTotalsWithBulkPortionGrams,
} from "../../app/features/preparation/preparation-bulk-portion";
import {
  buildPreparationDeliveryOrdersCsvContent,
  buildPreparationProductionCsvContent,
  PREPARATION_DELIVERY_ORDERS_CSV_HEADERS,
  PREPARATION_PRODUCTION_CSV_HEADERS,
  PREPARATION_UNKNOWN_OBJECTIVE_LABEL,
} from "../../app/features/preparation/preparation-csv";
import {
  buildPreparationDayDataFromBoxOrders,
  loadBulkPortionGramsByMealTitleFailSoft,
} from "../../app/features/preparation/preparation-data.server";
import { normalizeSelectedMealsForPreparation } from "../../app/features/preparation/preparation-formatters";
import type { PreparationBoxOrderRecord } from "../../app/features/preparation/preparation-types";
import type { ShopifyMealCatalogProductNode } from "../../app/services/subscriptionMealCatalog.server";
import { toMealCatalogProducts } from "../../app/services/subscriptionMealCatalog.server";
import { parseDeliveryDate } from "../../app/utils/deliveryDate";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const TARGET_DATE = parseDeliveryDate("2026-07-16")!;

const sumObjectiveQuantities = (quantities: {
  balanced: number;
  bulk: number;
  unknown: number;
  weight_loss: number;
}) =>
  quantities.weight_loss +
  quantities.balanced +
  quantities.bulk +
  quantities.unknown;

const mealProductNode = (
  overrides: Partial<ShopifyMealCatalogProductNode> & {
    id: string;
    title: string;
  },
): ShopifyMealCatalogProductNode => ({
  variants: { nodes: [] },
  ...overrides,
});

const bulkVariantNode = (portionGrams: string | null) => ({
  id: "gid://shopify/ProductVariant/bulk-1",
  title: "Prise de masse",
  objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
  portionGramsMetafield:
    portionGrams == null ? null : { value: portionGrams },
});

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
  objective: null,
  orderType: "Abonnement hebdomadaire",
  scheduledDeliveryDate: TARGET_DATE,
  selectedMeals: [],
  shopifyOrderName: "#1001",
  simulated: false,
  ...overrides,
});

const runSuite = async () => {
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
  ctx.assertEqual(
    "legacy null objective counts as unknown",
    data.mealTotals.find((meal) => meal.mealTitle === "Poulet tikka")
      ?.objectiveQuantities.unknown,
    3,
  );

  ctx.scenario("A. Ventilation multi-objectifs même plat");
  const multiObjectiveOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "wl-1",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      selectedMeals: ["Lasagnes", "Lasagnes"],
      shopifyOrderName: "#4101",
    }),
    baseOrder({
      id: "bal-1",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      selectedMeals: ["Lasagnes"],
      shopifyOrderName: "#4102",
    }),
    baseOrder({
      id: "bulk-1",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      selectedMeals: ["Lasagnes", "Lasagnes", "Lasagnes"],
      shopifyOrderName: "#4103",
    }),
  ];
  const multiData = buildPreparationDayDataFromBoxOrders(
    multiObjectiveOrders,
    TARGET_DATE,
  );
  const lasagnes = multiData.mealTotals.find(
    (meal) => meal.mealTitle === "Lasagnes",
  );
  ctx.assertEqual("A totalQuantity", lasagnes?.totalQuantity, 6);
  ctx.assertEqual(
    "A weight_loss",
    lasagnes?.objectiveQuantities.weight_loss,
    2,
  );
  ctx.assertEqual("A balanced", lasagnes?.objectiveQuantities.balanced, 1);
  ctx.assertEqual("A bulk", lasagnes?.objectiveQuantities.bulk, 3);
  ctx.assertEqual(
    "A sum === total",
    lasagnes ? sumObjectiveQuantities(lasagnes.objectiveQuantities) : -1,
    lasagnes?.totalQuantity ?? 0,
  );

  ctx.scenario("B. BoxOrder objective=null → unknown");
  const unknownOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "known",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      selectedMeals: ["Saumon"],
      shopifyOrderName: "#4201",
    }),
    baseOrder({
      id: "legacy",
      objective: null,
      selectedMeals: ["Saumon", "Saumon"],
      shopifyOrderName: "#4202",
    }),
  ];
  const unknownData = buildPreparationDayDataFromBoxOrders(
    unknownOrders,
    TARGET_DATE,
  );
  const saumon = unknownData.mealTotals.find(
    (meal) => meal.mealTitle === "Saumon",
  );
  ctx.assertEqual("B total", saumon?.totalQuantity, 3);
  ctx.assertEqual("B balanced", saumon?.objectiveQuantities.balanced, 1);
  ctx.assertEqual("B unknown", saumon?.objectiveQuantities.unknown, 2);
  ctx.assertEqual(
    "B sum === total",
    saumon ? sumObjectiveQuantities(saumon.objectiveQuantities) : -1,
    saumon?.totalQuantity ?? 0,
  );

  ctx.scenario("C. Doublons dans la même box comptés dans l'objectif de la box");
  const duplicateInBox = buildPreparationDayDataFromBoxOrders(
    [
      baseOrder({
        id: "dup",
        objective: SUBSCRIPTION_OBJECTIVE.BULK,
        selectedMeals: ["Poulet tikka", "Poulet tikka"],
        shopifyOrderName: "#4301",
      }),
    ],
    TARGET_DATE,
  );
  const poulet = duplicateInBox.mealTotals.find(
    (meal) => meal.mealTitle === "Poulet tikka",
  );
  ctx.assertEqual("C total", poulet?.totalQuantity, 2);
  ctx.assertEqual("C bulk", poulet?.objectiveQuantities.bulk, 2);

  ctx.scenario("D. Cancelled/simulated exclus");
  const mixedOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "real-order",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      selectedMeals: ["Poulet tikka", "Saumon"],
      shopifyOrderName: "#3001",
    }),
    baseOrder({
      id: "simulated-order",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      selectedMeals: ["Poulet tikka", "Poulet tikka", "Boulgour"],
      shopifyOrderName: "SIM-3002",
      simulated: true,
    }),
    baseOrder({
      id: "cancelled-order",
      cancelledAt: new Date("2026-07-15T12:00:00.000Z"),
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      selectedMeals: ["Poulet tikka"],
      shopifyOrderName: "#3003",
    }),
  ];
  const mixedData = buildPreparationDayDataFromBoxOrders(mixedOrders, TARGET_DATE);
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
    "cancelled BoxOrder excluded from preparation",
    mixedData.orders.some((order) => order.id === "cancelled-order"),
    false,
  );
  ctx.assertEqual(
    "kitchen quantities ignore simulated/cancelled",
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

  ctx.scenario("E/F. Export production CSV — 1 ligne par plat");
  const kitchenCsvOrders: PreparationBoxOrderRecord[] = [
    baseOrder({
      id: "csv-wl",
      objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
      selectedMeals: ["Lasagnes", "Lasagnes", "Lasagnes", "Lasagnes"],
      shopifyOrderName: "#5101",
    }),
    baseOrder({
      id: "csv-bal",
      objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
      selectedMeals: ["Lasagnes", "Lasagnes", "Lasagnes"],
      shopifyOrderName: "#5102",
    }),
    baseOrder({
      id: "csv-bulk",
      objective: SUBSCRIPTION_OBJECTIVE.BULK,
      selectedMeals: ["Lasagnes", "Lasagnes", "Lasagnes"],
      shopifyOrderName: "#5103",
    }),
  ];
  const kitchenCsvData = buildPreparationDayDataFromBoxOrders(
    kitchenCsvOrders,
    TARGET_DATE,
  );
  const kitchenMeal = kitchenCsvData.mealTotals.find(
    (meal) => meal.mealTitle === "Lasagnes",
  );
  ctx.assertEqual("A CSV totalQuantity", kitchenMeal?.totalQuantity, 10);
  ctx.assertEqual(
    "A CSV weight_loss",
    kitchenMeal?.objectiveQuantities.weight_loss,
    4,
  );
  ctx.assertEqual(
    "A CSV balanced",
    kitchenMeal?.objectiveQuantities.balanced,
    3,
  );
  ctx.assertEqual("A CSV bulk", kitchenMeal?.objectiveQuantities.bulk, 3);
  ctx.assertEqual(
    "A CSV unknown",
    kitchenMeal?.objectiveQuantities.unknown,
    0,
  );

  const productionCsv = buildPreparationProductionCsvContent(kitchenCsvData);
  const productionLines = productionCsv.split("\n");
  const expectedHeader = PREPARATION_PRODUCTION_CSV_HEADERS.map(
    (header) => `"${header}"`,
  ).join(",");
  const expectedLasagnesRow =
    `"2026-07-16","Lasagnes","4","3","3","","0","10"`;
  ctx.assertEqual("production CSV header", productionLines[0], expectedHeader);
  ctx.assertEqual(
    "A one CSV row per meal",
    productionLines.filter((line) => line.includes('"Lasagnes"')).length,
    1,
  );
  ctx.assertEqual(
    "A kitchen CSV meal row (empty grammage without catalog)",
    productionLines[1],
    expectedLasagnesRow,
  );
  ctx.assertEqual(
    "C objective cols sum to Total",
    kitchenMeal
      ? sumObjectiveQuantities(kitchenMeal.objectiveQuantities)
      : -1,
    kitchenMeal?.totalQuantity ?? 0,
  );
  const dataRows = productionLines.slice(1).join("\n");
  ctx.assertTrue(
    "D no technical weight_loss code",
    !dataRows.includes("weight_loss"),
  );
  ctx.assertTrue(
    "D no technical balanced code",
    !dataRows.includes("balanced"),
  );
  ctx.assertTrue("D no technical bulk code", !dataRows.includes("bulk"));

  const unknownCsv = buildPreparationProductionCsvContent(unknownData);
  const unknownLines = unknownCsv.split("\n");
  ctx.assertEqual(
    "B unknown CSV row",
    unknownLines.find((line) => line.includes('"Saumon"')),
    `"2026-07-16","Saumon","0","1","0","","2","3"`,
  );
  ctx.assertTrue(
    "B Objectif inconnu column = 2",
    unknownCsv.includes(`"Saumon","0","1","0","","2","3"`),
  );
  ctx.assertTrue(
    "F unknown header uses label",
    unknownCsv.startsWith(expectedHeader) &&
      expectedHeader.includes(`"${PREPARATION_UNKNOWN_OBJECTIVE_LABEL}"`),
  );

  ctx.scenario("G. Grammage prise de masse — lookup + CSV + fail-soft");
  const lasagnesCatalog = toMealCatalogProducts([
    mealProductNode({
      id: "gid://shopify/Product/lasagnes",
      title: "Lasagnes",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/wl",
            title: "Perte de poids",
            objectiveMetafield: {
              value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
            },
            portionGramsMetafield: { value: "350" },
          },
          {
            id: "gid://shopify/ProductVariant/bal",
            title: "Équilibré",
            objectiveMetafield: {
              value: SUBSCRIPTION_OBJECTIVE.BALANCED,
            },
            portionGramsMetafield: { value: "450" },
          },
          bulkVariantNode("550"),
        ],
      },
    }),
  ]);
  const bulkLookup = buildBulkPortionGramsByMealTitle(lasagnesCatalog);
  ctx.assertEqual("A lookup Lasagnes bulk grams", bulkLookup.get("Lasagnes"), 550);

  const enrichedKitchen = {
    ...kitchenCsvData,
    mealTotals: enrichMealTotalsWithBulkPortionGrams(
      kitchenCsvData.mealTotals,
      bulkLookup,
    ),
  };
  const enrichedLasagnes = enrichedKitchen.mealTotals.find(
    (meal) => meal.mealTitle === "Lasagnes",
  );
  ctx.assertEqual("A bulk quantity", enrichedLasagnes?.objectiveQuantities.bulk, 3);
  ctx.assertEqual("A bulkPortionGrams", enrichedLasagnes?.bulkPortionGrams, 550);
  ctx.assertEqual(
    "H sum objectives === total after enrich",
    enrichedLasagnes
      ? sumObjectiveQuantities(enrichedLasagnes.objectiveQuantities)
      : -1,
    enrichedLasagnes?.totalQuantity ?? 0,
  );

  const enrichedCsv = buildPreparationProductionCsvContent(enrichedKitchen);
  ctx.assertTrue(
    "A CSV grammage 550",
    enrichedCsv.includes(`"Lasagnes","4","3","3","550","0","10"`),
  );

  const nullGramsLookup = buildBulkPortionGramsByMealTitle(
    toMealCatalogProducts([
      mealProductNode({
        id: "gid://shopify/Product/lasagnes-null",
        title: "Lasagnes",
        variants: { nodes: [bulkVariantNode(null)] },
      }),
    ]),
  );
  const nullEnriched = enrichMealTotalsWithBulkPortionGrams(
    kitchenCsvData.mealTotals,
    nullGramsLookup,
  );
  ctx.assertEqual(
    "B/F null portionGrams → null",
    nullEnriched.find((meal) => meal.mealTitle === "Lasagnes")?.bulkPortionGrams,
    null,
  );
  ctx.assertTrue(
    "B CSV empty grammage when unresolved",
    buildPreparationProductionCsvContent({
      ...kitchenCsvData,
      mealTotals: nullEnriched,
    }).includes(`"Lasagnes","4","3","3","","0","10"`),
  );

  const noBulkData = buildPreparationDayDataFromBoxOrders(
    [
      baseOrder({
        id: "wl-only",
        objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
        selectedMeals: ["Poulet tikka", "Poulet tikka"],
        shopifyOrderName: "#5201",
      }),
    ],
    TARGET_DATE,
  );
  const noBulkEnriched = enrichMealTotalsWithBulkPortionGrams(
    noBulkData.mealTotals,
    new Map([["Poulet tikka", 400]]),
  );
  const pouletNoBulk = noBulkEnriched.find(
    (meal) => meal.mealTitle === "Poulet tikka",
  );
  ctx.assertEqual("C bulk = 0", pouletNoBulk?.objectiveQuantities.bulk, 0);
  ctx.assertEqual(
    "C bulkPortionGrams stays null when bulk=0",
    pouletNoBulk?.bulkPortionGrams,
    null,
  );
  ctx.assertTrue(
    "C CSV grammage empty when bulk=0",
    buildPreparationProductionCsvContent({
      ...noBulkData,
      mealTotals: noBulkEnriched,
    }).includes(`"Poulet tikka","2","0","0","","0","2"`),
  );

  const duplicateCatalog = toMealCatalogProducts([
    mealProductNode({
      id: "gid://shopify/Product/dup-1",
      title: "Lasagnes",
      variants: { nodes: [bulkVariantNode("500")] },
    }),
    mealProductNode({
      id: "gid://shopify/Product/dup-2",
      title: "Lasagnes",
      variants: { nodes: [bulkVariantNode("600")] },
    }),
  ]);
  ctx.assertEqual(
    "D duplicate title → null",
    buildBulkPortionGramsByMealTitle(duplicateCatalog).get("Lasagnes"),
    null,
  );

  const noBulkVariantCatalog = toMealCatalogProducts([
    mealProductNode({
      id: "gid://shopify/Product/no-bulk",
      title: "Lasagnes",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/wl-only",
            title: "Perte de poids",
            objectiveMetafield: {
              value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
            },
            portionGramsMetafield: { value: "350" },
          },
        ],
      },
    }),
  ]);
  ctx.assertEqual(
    "E missing bulk variant → null",
    buildBulkPortionGramsByMealTitle(noBulkVariantCatalog).get("Lasagnes"),
    null,
  );

  const invalidGramsCatalog = toMealCatalogProducts([
    mealProductNode({
      id: "gid://shopify/Product/invalid",
      title: "Lasagnes",
      variants: { nodes: [bulkVariantNode("not-a-number")] },
    }),
  ]);
  ctx.assertEqual(
    "F invalid portionGrams → null",
    buildBulkPortionGramsByMealTitle(invalidGramsCatalog).get("Lasagnes"),
    null,
  );

  const failingAdmin = {
    graphql: async () => {
      throw new Error("Shopify down");
    },
  };
  let failSoftThrew = false;
  let failSoftLookup: Map<string, number | null> = new Map([["sentinel", 1]]);
  try {
    failSoftLookup = await loadBulkPortionGramsByMealTitleFailSoft(
      failingAdmin,
      "shop-that-may-not-exist.myshopify.com",
    );
  } catch {
    failSoftThrew = true;
  }
  ctx.assertEqual("G catalog error does not throw", failSoftThrew, false);
  ctx.assertEqual("G fail-soft returns empty map", failSoftLookup.size, 0);

  const afterFailSoft = enrichMealTotalsWithBulkPortionGrams(
    kitchenCsvData.mealTotals,
    failSoftLookup,
  );
  ctx.assertEqual(
    "G quantities unchanged after fail-soft",
    afterFailSoft.find((meal) => meal.mealTitle === "Lasagnes")?.totalQuantity,
    10,
  );
  ctx.assertEqual(
    "G bulkPortionGrams null after fail-soft",
    afterFailSoft.find((meal) => meal.mealTitle === "Lasagnes")
      ?.bulkPortionGrams,
    null,
  );

  ctx.scenario("Export commandes CSV correct");
  const deliveryCsv = buildPreparationDeliveryOrdersCsvContent(data);
  ctx.assertTrue(
    "delivery CSV has headers",
    deliveryCsv.startsWith(
      PREPARATION_DELIVERY_ORDERS_CSV_HEADERS.map((header) => `"${header}"`).join(","),
    ),
  );
  ctx.assertTrue("delivery CSV includes order name", deliveryCsv.includes("#1001"));

  ctx.scenario("Projection portail n'altère pas l'historique préparation");
  ctx.assertEqual(
    "historical BoxOrder date unchanged",
    data.orders.every((order) => order.scheduledDeliveryDate === TARGET_DATE),
    true,
  );

  ctx.scenario("Commandes sans date livraison ne crashent pas");
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

  return finishSuite("07-preparation-backoffice", ctx);
};

try {
  process.exitCode = await runSuite();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
