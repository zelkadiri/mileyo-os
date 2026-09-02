/**
 * Business regression — box builder cart payload and meal filters.
 */
import {
  DELIVERY_DATE_PROPERTY_TECHNICAL,
  DELIVERY_DATE_PROPERTY_VISIBLE,
  getDeliveryDateFromLineItemProperties,
  getSelectedMealsFromLineItemProperties,
} from "../../app/utils/orderLineItemProperties";
import {
  buildBuilderDeliveryWindowOptionsFromReferenceDate,
  getAvailableDeliveryDates,
  getDefaultDeliveryDate,
  isSunday,
  parseDeliveryDate,
  referenceDateFromInstant,
} from "../../app/utils/deliveryDate";
import {
  mealExcludedByAllergenFilters,
  mealMatchesAllergenFilter,
} from "../../app/utils/mealAllergenFilters";
import { mealMatchesBadgeFilters } from "../../app/utils/mealBadgeFilters";
import { validateMealSelection } from "../../app/features/portal/portal-formatters";
import {
  createBusinessTestContext,
  finishSuite,
  samplePortalMeals,
} from "./_framework";

const buildCartProperties = ({
  deliveryDate,
  deliveryLabel,
  mealTitles,
  mealsCount,
  orderType,
}: {
  deliveryDate: string;
  deliveryLabel: string;
  mealTitles: string[];
  mealsCount: number;
  orderType: "one_time" | "subscription";
}) => [
  {
    name: "Type de commande",
    value:
      orderType === "subscription"
        ? "Abonnement hebdomadaire"
        : "Commande unique",
  },
  { name: "Nombre de repas", value: String(mealsCount) },
  { name: DELIVERY_DATE_PROPERTY_TECHNICAL, value: deliveryDate },
  {
    name: DELIVERY_DATE_PROPERTY_VISIBLE,
    value: `${deliveryLabel} (${deliveryDate})`,
  },
  ...mealTitles.map((title, index) => ({
    name: `Plat ${index + 1}`,
    value: title,
  })),
];

const sampleMeals = samplePortalMeals;

const runSuite = () => {
  const ctx = createBusinessTestContext("01-builder-cart-payload");
  const referenceFriday = referenceDateFromInstant(
    new Date("2026-07-10T12:00:00.000Z"),
  );

  ctx.scenario("Commande unique — payload panier correct");
  ctx.given("un client choisit une box 8 repas en commande unique");
  const oneTimeProps = buildCartProperties({
    deliveryDate: "2026-07-16",
    deliveryLabel: "jeudi 16 juillet 2026",
    mealTitles: ["Poulet tikka", "Saumon", "Riz", "Salade", "Soupe", "Tofu", "Pâtes", "Curry"],
    mealsCount: 8,
    orderType: "one_time",
  });
  ctx.when("le payload est analysé côté serveur");
  ctx.assertEqual(
    "one-time order type property",
    oneTimeProps.find((property) => property.name === "Type de commande")?.value,
    "Commande unique",
  );
  ctx.assertEqual(
    "one-time meals count property",
    oneTimeProps.find((property) => property.name === "Nombre de repas")?.value,
    "8",
  );
  ctx.assertEqual(
    "one-time delivery technical property",
    getDeliveryDateFromLineItemProperties(oneTimeProps),
    "2026-07-16",
  );
  ctx.assertEqual(
    "one-time selected meals count",
    getSelectedMealsFromLineItemProperties(oneTimeProps).length,
    8,
  );

  ctx.scenario("Abonnement — payload panier correct");
  ctx.given("un client choisit un abonnement hebdomadaire");
  const subscriptionProps = buildCartProperties({
    deliveryDate: "2026-07-16",
    deliveryLabel: "jeudi 16 juillet 2026",
    mealTitles: ["Poulet tikka", "Saumon"],
    mealsCount: 12,
    orderType: "subscription",
  });
  ctx.when("le payload est analysé");
  ctx.assertEqual(
    "subscription order type property",
    subscriptionProps.find((property) => property.name === "Type de commande")?.value,
    "Abonnement hebdomadaire",
  );
  ctx.assertEqual(
    "subscription delivery date present",
    getDeliveryDateFromLineItemProperties(subscriptionProps),
    "2026-07-16",
  );

  for (const mealsCount of [8, 10, 12, 16, 20, 24] as const) {
    ctx.scenario(`Box ${mealsCount} repas — validation exacte`);
    ctx.given(`exactement ${mealsCount} plats sélectionnés`);
    const meals = sampleMeals(mealsCount);
    const quantities = Object.fromEntries(
      meals.map((meal) => [meal.id, 1]),
    );
    const valid = validateMealSelection({ meals, mealsCount, quantities });
    ctx.then(`la sélection ${mealsCount} repas est acceptée`);
    ctx.assertEqual(`box ${mealsCount} valid selection`, "titles" in valid, true);

    ctx.when(`un plat manque pour box ${mealsCount}`);
    const invalid = validateMealSelection({
      meals,
      mealsCount,
      quantities: { [meals[0].id]: mealsCount - 1 },
    });
    ctx.assertEqual(`box ${mealsCount} rejects wrong total`, "error" in invalid, true);
  }

  ctx.scenario("Date livraison builder — deux fenêtres hebdomadaires jeudi/samedi");
  ctx.given("une date de référence jeudi 13 août 2026");
  const weeklyReference = parseDeliveryDate("2026-08-13");
  ctx.assertTrue("weekly reference parses", weeklyReference !== null);
  const weeklyOptions = buildBuilderDeliveryWindowOptionsFromReferenceDate(
    weeklyReference!,
  );
  ctx.when("on liste les fenêtres disponibles");
  ctx.assertEqual("weekly options count", weeklyOptions.length, 2);
  ctx.assertEqual(
    "first weekly thursday canonical",
    weeklyOptions[0]?.scheduledDeliveryDate,
    "2026-08-20",
  );
  ctx.assertEqual(
    "first weekly saturday display end",
    weeklyOptions[0]?.deliveryWindowEndDate,
    "2026-08-22",
  );
  ctx.assertEqual(
    "second weekly thursday",
    weeklyOptions[1]?.scheduledDeliveryDate,
    "2026-08-27",
  );
  ctx.assertTrue(
    "weekly range label mentions jeudi and samedi",
    weeklyOptions[0]?.rangeLabel.includes("jeudi") === true &&
      weeklyOptions[0]?.rangeLabel.includes("samedi") === true &&
      weeklyOptions[0]?.rangeLabel.includes("vendredi") === false,
  );
  ctx.assertEqual(
    "deliveryRangeLabel keeps Livraison prefix for checkout",
    weeklyOptions[0]?.rangeLabel,
    "Livraison entre jeudi 20 août et samedi 22 août",
  );

  ctx.scenario("Legacy delivery window helpers — fenêtre J+3 à J+10 sans dimanche");
  ctx.given("une date de référence vendredi 10 juillet");
  const availableDates = getAvailableDeliveryDates(referenceFriday);
  ctx.when("on liste les dates disponibles");
  ctx.assertTrue("available dates not empty", availableDates.length > 0);
  ctx.assertTrue(
    "no Sunday in available dates",
    availableDates.every((date) => !isSunday(date)),
  );
  ctx.assertEqual(
    "default date is first available date",
    getDefaultDeliveryDate(referenceFriday),
    availableDates[0],
  );
  for (const date of availableDates) {
    ctx.assertEqual(
      `delivery date ${date} uses ISO format`,
      parseDeliveryDate(date) !== null,
      true,
    );
  }

  ctx.scenario("Filtres plats — allergènes et badges");
  ctx.given("un plat contenant gluten et badge végétarien");
  const meal = {
    allergenes: ["gluten (blé)"],
    badges: ["Végétarien"],
  };
  ctx.when("le client exclut gluten");
  ctx.assertTrue(
    "gluten meal excluded by allergen filter",
    mealExcludedByAllergenFilters(meal.allergenes, ["gluten"]),
  );
  ctx.when("le client filtre badge végétarien");
  ctx.assertTrue(
    "vegetarian badge matches OR filter",
    mealMatchesBadgeFilters(meal.badges, ["vegetarien"]),
  );
  ctx.when("les métadonnées allergènes sont incomplètes");
  let incompleteMetadataSafe = true;
  try {
    mealMatchesAllergenFilter(undefined, "gluten");
    mealMatchesAllergenFilter([], "gluten");
  } catch {
    incompleteMetadataSafe = false;
  }
  ctx.assertTrue(
    "incomplete allergen metadata does not crash",
    incompleteMetadataSafe,
  );

  return finishSuite("01-builder-cart-payload", ctx);
};

process.exitCode = runSuite();
