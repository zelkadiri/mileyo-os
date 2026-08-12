/**
 * Business regression — subscription objective and multi-variant meal catalog (13B).
 */
import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  toMealCatalogProducts,
  type ShopifyMealCatalogProductNode,
} from "../../app/services/subscriptionMealCatalog.server";
import { parseSubscriptionObjective } from "../../app/utils/subscriptionObjective";
import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const buildThreeVariantMealFixture = (): ShopifyMealCatalogProductNode => ({
  id: "gid://shopify/Product/1001",
  title: "Poulet curry",
  featuredImage: {
    altText: "Poulet curry",
    url: "https://cdn.shopify.com/poulet-curry.jpg",
  },
  allergenesMetafield: { value: "gluten, lait" },
  ingredientsMetafield: { value: "poulet, curry, riz" },
  badge1Metafield: { value: "Bio" },
  badge2Metafield: null,
  badge3Metafield: null,
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/2001",
        title: "Perte de poids",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS },
        caloriesMetafield: { value: "400" },
        proteinsMetafield: { value: "35" },
        carbsMetafield: { value: "30" },
        fatMetafield: { value: "12" },
        portionGramsMetafield: { value: "350" },
      },
      {
        id: "gid://shopify/ProductVariant/2002",
        title: "Équilibre",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BALANCED },
        caloriesMetafield: { value: "550" },
        proteinsMetafield: { value: "40" },
        carbsMetafield: { value: "45" },
        fatMetafield: { value: "18" },
        portionGramsMetafield: { value: "400" },
      },
      {
        id: "gid://shopify/ProductVariant/2003",
        title: "Prise de masse",
        objectiveMetafield: { value: SUBSCRIPTION_OBJECTIVE.BULK },
        caloriesMetafield: { value: "700" },
        proteinsMetafield: { value: "50" },
        carbsMetafield: { value: "60" },
        fatMetafield: { value: "25" },
        portionGramsMetafield: { value: "450" },
      },
    ],
  },
});

const runSuite = () => {
  const ctx = createBusinessTestContext("11-subscription-objective-meal-catalog");

  ctx.scenario("A. Objective parser — valeurs valides");
  ctx.assertEqual(
    "weight_loss parses",
    parseSubscriptionObjective("weight_loss"),
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "balanced parses",
    parseSubscriptionObjective("balanced"),
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertEqual(
    "bulk parses",
    parseSubscriptionObjective("bulk"),
    SUBSCRIPTION_OBJECTIVE.BULK,
  );

  ctx.scenario("A. Objective parser — valeurs invalides ou absentes");
  ctx.assertNull(
    "invalid objective returns null",
    parseSubscriptionObjective("lose_weight"),
  );
  ctx.assertNull("null returns null", parseSubscriptionObjective(null));
  ctx.assertNull("undefined returns null", parseSubscriptionObjective(undefined));
  ctx.assertNull("empty string returns null", parseSubscriptionObjective(""));

  ctx.scenario("B. Meal avec 3 variants");
  const threeVariantMeals = toMealCatalogProducts([buildThreeVariantMealFixture()]);
  const curry = threeVariantMeals[0];

  ctx.assertEqual("product title preserved", curry.title, "Poulet curry");
  ctx.assertEqual("variants length is 3", curry.variants.length, 3);
  ctx.assertEqual(
    "first objective is weight_loss",
    curry.variants[0]?.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "second objective is balanced",
    curry.variants[1]?.objective,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertEqual(
    "third objective is bulk",
    curry.variants[2]?.objective,
    SUBSCRIPTION_OBJECTIVE.BULK,
  );

  ctx.scenario("C. Macros variant-level");
  const [weightLoss, balanced, bulk] = curry.variants;

  ctx.assertEqual("weight_loss calories", weightLoss.calories, 400);
  ctx.assertEqual("weight_loss proteins", weightLoss.proteins, 35);
  ctx.assertEqual("weight_loss carbs", weightLoss.carbs, 30);
  ctx.assertEqual("weight_loss fat", weightLoss.fat, 12);
  ctx.assertEqual("weight_loss portionGrams", weightLoss.portionGrams, 350);

  ctx.assertEqual("balanced calories", balanced.calories, 550);
  ctx.assertEqual("balanced proteins", balanced.proteins, 40);
  ctx.assertEqual("bulk calories", bulk.calories, 700);
  ctx.assertEqual("bulk portionGrams", bulk.portionGrams, 450);

  ctx.scenario("D. Données manquantes");
  const missingDataMeals = toMealCatalogProducts([
    {
      id: "gid://shopify/Product/1002",
      title: "Salade incomplete",
      featuredImage: null,
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/3001",
            title: "Sans objectif",
          },
        ],
      },
    },
    {
      id: "gid://shopify/Product/1003",
      title: "Produit sans variant",
      featuredImage: null,
      variants: { nodes: [] },
    },
  ]);

  const incompleteMeal = missingDataMeals[0];
  const emptyVariantsMeal = missingDataMeals[1];

  ctx.assertNull(
    "missing objective is null",
    incompleteMeal.variants[0]?.objective ?? null,
  );
  ctx.assertNull(
    "missing calories is null",
    incompleteMeal.variants[0]?.calories ?? null,
  );
  ctx.assertNull("missing imageUrl is null", incompleteMeal.imageUrl);
  ctx.assertEqual(
    "product with zero variants returns empty array",
    emptyVariantsMeal.variants.length,
    0,
  );

  ctx.scenario("E. Valeurs invalides");
  const invalidValueMeals = toMealCatalogProducts([
    {
      id: "gid://shopify/Product/1004",
      title: "Plat invalide",
      variants: {
        nodes: [
          {
            id: "gid://shopify/ProductVariant/4001",
            title: "Invalid objective",
            objectiveMetafield: { value: "lose_weight" },
            caloriesMetafield: { value: "abc" },
            proteinsMetafield: { value: "32.5" },
          },
        ],
      },
    },
  ]);

  const invalidVariant = invalidValueMeals[0].variants[0];

  ctx.assertNull("invalid objective becomes null", invalidVariant.objective);
  ctx.assertNull("invalid macro becomes null", invalidVariant.calories);
  ctx.assertEqual(
    "valid decimal macro parses",
    invalidVariant.proteins,
    32.5,
  );
  ctx.assertFalse(
    "calories is not NaN",
    Number.isNaN(invalidVariant.calories),
  );

  ctx.scenario("Recipe metadata preserved at product level");
  ctx.assertEqual(
    "allergenes parsed",
    curry.allergenes.includes("gluten") && curry.allergenes.includes("lait"),
    true,
  );
  ctx.assertEqual("badges length is 1", curry.badges.length, 1);
  ctx.assertEqual("first badge parsed", curry.badges[0], "Bio");
  ctx.assertEqual("ingredients length is 3", curry.ingredients.length, 3);
  ctx.assertEqual("first ingredient parsed", curry.ingredients[0], "poulet");
  ctx.assertEqual("second ingredient parsed", curry.ingredients[1], "curry");
  ctx.assertEqual("third ingredient parsed", curry.ingredients[2], "riz");

  return finishSuite("11-subscription-objective-meal-catalog", ctx);
};

process.exitCode = runSuite();
