/**
 * Delivery date line item property parsing — unit checks (no DB, no Shopify).
 * Usage: npx tsx scripts/dev-delivery-property-parsing-tests.ts
 */
import {
  DELIVERY_DATE_PROPERTY_TECHNICAL,
  DELIVERY_DATE_PROPERTY_VISIBLE,
  getDeliveryDateFromLineItemProperties,
  getSelectedMealsFromLineItemProperties,
  type LineItemProperty,
} from "../app/utils/orderLineItemProperties";

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

const sampleMealProperties: LineItemProperty[] = [
  { name: "Type de commande", value: "Abonnement hebdomadaire" },
  { name: "Nombre de repas", value: "12" },
  { name: "Plat 1", value: "Poulet tikka" },
  { name: "Plat 2", value: "Bœuf bourguignon" },
];

function main() {
  assertEqual(
    "Technical property valid",
    getDeliveryDateFromLineItemProperties([
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
    ]),
    "2026-07-16",
  );

  assertEqual(
    "Technical valid beats different visible value",
    getDeliveryDateFromLineItemProperties([
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
      { name: DELIVERY_DATE_PROPERTY_VISIBLE, value: "2026-07-20" },
    ]),
    "2026-07-16",
  );

  assertEqual(
    "Invalid technical falls back to visible ISO",
    getDeliveryDateFromLineItemProperties([
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "not-a-date" },
      { name: DELIVERY_DATE_PROPERTY_VISIBLE, value: "2026-07-18" },
    ]),
    "2026-07-18",
  );

  assertEqual(
    "Missing technical uses visible ISO",
    getDeliveryDateFromLineItemProperties([
      { name: DELIVERY_DATE_PROPERTY_VISIBLE, value: "2026-07-17" },
    ]),
    "2026-07-17",
  );

  assertEqual(
    "Visible label with ISO in parentheses",
    getDeliveryDateFromLineItemProperties([
      {
        name: DELIVERY_DATE_PROPERTY_VISIBLE,
        value: "jeudi 16 juillet 2026 (2026-07-16)",
      },
    ]),
    "2026-07-16",
  );

  assertEqual(
    "No delivery properties returns null",
    getDeliveryDateFromLineItemProperties(sampleMealProperties),
    null,
  );

  assertEqual(
    "Invalid date returns null",
    getDeliveryDateFromLineItemProperties([
      { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-02-30" },
      { name: DELIVERY_DATE_PROPERTY_VISIBLE, value: "pas une date" },
    ]),
    null,
  );

  const withDeliveryAndMeals = [
    ...sampleMealProperties,
    { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: "2026-07-16" },
  ];

  assertEqual(
    "Delivery parsing ignores meal properties",
    getDeliveryDateFromLineItemProperties(withDeliveryAndMeals),
    "2026-07-16",
  );

  assertEqual(
    "Meal parsing unchanged with delivery properties present",
    getSelectedMealsFromLineItemProperties(withDeliveryAndMeals).join(" | "),
    "Poulet tikka | Bœuf bourguignon",
  );

  assertEqual(
    "Undefined properties returns null",
    getDeliveryDateFromLineItemProperties(undefined),
    null,
  );

  assertEqual(
    "Null properties returns null",
    getDeliveryDateFromLineItemProperties(null as unknown as LineItemProperty[]),
    null,
  );

  assertEqual(
    "Empty properties returns null",
    getDeliveryDateFromLineItemProperties([]),
    null,
  );

  assertEqual(
    "Empty meal properties unchanged",
    getSelectedMealsFromLineItemProperties([]).length,
    0,
  );

  const failed = checks.filter((check) => !check.ok);

  console.log("\nDelivery property parsing — unit tests\n");
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
