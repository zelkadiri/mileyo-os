/**
 * Preparation data layer — unit checks (no Shopify, optional DB-free).
 * Usage: npx tsx scripts/dev-preparation-data-tests.ts
 */
import {
  buildPreparationDeliveryOrdersCsvContent,
  buildPreparationProductionCsvContent,
  PREPARATION_DELIVERY_ORDERS_CSV_HEADERS,
  PREPARATION_PRODUCTION_CSV_HEADERS,
} from "../app/features/preparation/preparation-csv";
import { buildPreparationDayDataFromBoxOrders } from "../app/features/preparation/preparation-data.server";
import { normalizeSelectedMealsForPreparation } from "../app/features/preparation/preparation-formatters";
import type { PreparationBoxOrderRecord } from "../app/features/preparation/preparation-types";
import { parseDeliveryDate } from "../app/utils/deliveryDate";

type Check = { detail: string; name: string; ok: boolean };

const checks: Check[] = [];

const pass = (name: string, detail: string) => checks.push({ detail, name, ok: true });
const fail = (name: string, detail: string) => checks.push({ detail, name, ok: false });

const assertEqual = (name: string, actual: unknown, expected: unknown) => {
  if (actual === expected) {
    pass(name, `expected=${String(expected)}`);
  } else {
    fail(name, `expected=${String(expected)}, got=${String(actual)}`);
  }
};

const TARGET_DATE = parseDeliveryDate("2026-07-16")!;
const OTHER_DATE = parseDeliveryDate("2026-07-20")!;

const baseOrder = (
  overrides: Partial<PreparationBoxOrderRecord> & { id: string },
): PreparationBoxOrderRecord => ({
  boxTitle: "Box 8 repas",
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
    id: "order-3",
    deliveryRescheduleReason: "payment_too_late",
    desiredDeliveryDate: "2026-07-14",
    scheduledDeliveryDate: TARGET_DATE,
    selectedMeals: ["Salade César"],
    shopifyOrderName: "#1003",
  }),
  baseOrder({
    id: "ignored-no-date",
    scheduledDeliveryDate: null,
    selectedMeals: ["Ignored sans date"],
    shopifyOrderName: "#1999",
  }),
  baseOrder({
    id: "ignored-other-date",
    scheduledDeliveryDate: OTHER_DATE,
    selectedMeals: ["Ignored autre date"],
    shopifyOrderName: "#2000",
  }),
];

function main() {
  const data = buildPreparationDayDataFromBoxOrders(fixtureOrders, TARGET_DATE);

  assertEqual(
    "1. Meal totals Poulet tikka",
    data.mealTotals.find((meal) => meal.mealTitle === "Poulet tikka")?.totalQuantity,
    3,
  );
  assertEqual(
    "1. Meal totals Saumon",
    data.mealTotals.find((meal) => meal.mealTitle === "Saumon")?.totalQuantity,
    1,
  );
  assertEqual(
    "1. Meal totals Boulgour",
    data.mealTotals.find((meal) => meal.mealTitle === "Boulgour")?.totalQuantity,
    1,
  );

  assertEqual(
    "2. Duplicate meals in one order counted",
    data.orders.find((order) => order.id === "order-1")?.selectedMeals.length,
    3,
  );

  assertEqual(
    "3. Meal totals sorted by quantity desc",
    data.mealTotals.map((meal) => meal.mealTitle).join(","),
    "Poulet tikka,Boulgour,Salade César,Saumon",
  );

  assertEqual(
    "4. Only target scheduledDeliveryDate included",
    data.orders.every((order) => order.scheduledDeliveryDate === TARGET_DATE),
    true,
  );

  assertEqual(
    "5. Orders without scheduledDeliveryDate ignored",
    data.orders.some((order) => order.id === "ignored-no-date"),
    false,
  );

  assertEqual(
    "6. Orders on other date ignored",
    data.orders.some((order) => order.id === "ignored-other-date"),
    false,
  );

  assertEqual("7. totalOrders", data.summary.totalOrders, 3);
  assertEqual("8. totalMeals", data.summary.totalMeals, 6);
  assertEqual("9. subscriptionOrders", data.summary.subscriptionOrders, 2);
  assertEqual("9. oneTimeOrders", data.summary.oneTimeOrders, 1);
  assertEqual("10. rescheduledOrders", data.summary.rescheduledOrders, 1);

  const productionCsv = buildPreparationProductionCsvContent(data);
  const productionLines = productionCsv.split("\n");

  assertEqual(
    "11. Production CSV header",
    productionLines[0],
    PREPARATION_PRODUCTION_CSV_HEADERS.map((header) => `"${header}"`).join(","),
  );
  assertEqual(
    "11. Production CSV first meal row",
    productionLines[1],
    `"2026-07-16","Poulet tikka","3"`,
  );

  const deliveryCsv = buildPreparationDeliveryOrdersCsvContent(data);
  const deliveryLines = deliveryCsv.split("\n");

  assertEqual(
    "12. Delivery orders CSV header",
    deliveryLines[0],
    PREPARATION_DELIVERY_ORDERS_CSV_HEADERS.map((header) => `"${header}"`).join(","),
  );
  assertEqual(
    "12. Delivery orders CSV includes rescheduled reason",
    deliveryLines.some((line) => line.includes("payment_too_late")),
    true,
  );

  let nullMealsThrew = false;

  try {
    assertEqual(
      "13. selectedMeals null does not throw",
      normalizeSelectedMealsForPreparation(null).length,
      0,
    );
    buildPreparationDayDataFromBoxOrders(
      [
        baseOrder({
          id: "null-meals",
          selectedMeals: null,
        }),
      ],
      TARGET_DATE,
    );
  } catch {
    nullMealsThrew = true;
  }

  assertEqual("13. selectedMeals null safe", nullMealsThrew, false);

  const legacyMeals = normalizeSelectedMealsForPreparation([
    { title: "Poulet tikka" },
    { name: "Riz basmati" },
    "Saumon",
  ]);

  assertEqual(
    "14. Legacy object selectedMeals normalized",
    legacyMeals.join(" | "),
    "Poulet tikka | Riz basmati | Saumon",
  );

  let legacyThrew = false;

  try {
    buildPreparationDayDataFromBoxOrders(
      [
        baseOrder({
          id: "legacy-meals",
          selectedMeals: [{ mealTitle: "Curry vert" }, 42, ""],
        }),
      ],
      TARGET_DATE,
    );
  } catch {
    legacyThrew = true;
  }

  assertEqual("14. Legacy selectedMeals does not throw", legacyThrew, false);

  const simulatedMix = buildPreparationDayDataFromBoxOrders(
    [
      baseOrder({
        id: "real-order",
        selectedMeals: ["Poulet tikka"],
        shopifyOrderName: "#4001",
      }),
      baseOrder({
        id: "simulated-order",
        selectedMeals: ["Poulet tikka", "Boulgour"],
        shopifyOrderName: "SIM-4002",
        simulated: true,
      }),
    ],
    TARGET_DATE,
  );

  assertEqual(
    "15. Simulated BoxOrder excluded",
    simulatedMix.orders.some((order) => order.id === "simulated-order"),
    false,
  );
  assertEqual(
    "15. Real BoxOrder kept",
    simulatedMix.orders.some((order) => order.id === "real-order"),
    true,
  );
  assertEqual(
    "15. Kitchen quantities ignore simulated meals",
    simulatedMix.mealTotals.find((meal) => meal.mealTitle === "Poulet tikka")
      ?.totalQuantity,
    1,
  );
  assertEqual(
    "15. Simulated-only meal not counted",
    simulatedMix.mealTotals.some((meal) => meal.mealTitle === "Boulgour"),
    false,
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nPreparation data — unit tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
