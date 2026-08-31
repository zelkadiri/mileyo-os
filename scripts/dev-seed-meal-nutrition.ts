#!/usr/bin/env npx tsx
/**
 * 14A — Meal nutrition import foundation (dev seed).
 *
 * Dry-run by default (no Shopify writes).
 * Apply only with: --apply  (or APPLY_MEAL_NUTRITION_SEED=1)
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/dev-seed-meal-nutrition.ts
 *   npx tsx --env-file=.env scripts/dev-seed-meal-nutrition.ts --apply
 *
 * Optional:
 *   CRON_SHOP / SHOP — shop domain for --apply
 *   MEAL_NUTRITION_VARIANT_IDS — comma-separated ProductVariant GIDs
 *     overriding seed row variantIds by index (required for real apply)
 */
import {
  buildMealNutritionWritePlans,
  validateMealNutritionImportRows,
  type MealNutritionImportRow,
} from "../app/utils/mealNutritionImport";

const APPLY =
  process.argv.includes("--apply") ||
  process.env.APPLY_MEAL_NUTRITION_SEED === "1";

const SHOP =
  process.env.CRON_SHOP?.trim() || process.env.SHOP?.trim() || null;

/**
 * Deterministic UX seed — same shape as future Excel rows.
 * Replace variantIds via MEAL_NUTRITION_VARIANT_IDS before --apply.
 */
const DEV_SEED_TEMPLATE_ROWS: MealNutritionImportRow[] = [
  {
    variantId: "gid://shopify/ProductVariant/SEED_REPLACE_1",
    productTitle: "Poulet riz légumes (seed)",
    objective: "weight_loss",
    calories: 420,
    proteins: 38,
    carbs: 32,
    fat: 12,
    saturatedFat: null,
    sugars: null,
    fiber: null,
    salt: null,
    portionGrams: 350,
  },
  {
    variantId: "gid://shopify/ProductVariant/SEED_REPLACE_2",
    productTitle: "Poulet riz légumes (seed)",
    objective: "balanced",
    calories: 520,
    proteins: 42,
    carbs: 45,
    fat: 16,
    saturatedFat: null,
    sugars: null,
    fiber: null,
    salt: null,
    portionGrams: 400,
  },
  {
    variantId: "gid://shopify/ProductVariant/SEED_REPLACE_3",
    productTitle: "Poulet riz légumes (seed)",
    objective: "bulk",
    calories: 680,
    proteins: 48,
    carbs: 62,
    fat: 22,
    saturatedFat: null,
    sugars: null,
    fiber: null,
    salt: null,
    portionGrams: 480,
  },
];

const isPlaceholderVariantId = (variantId: string) =>
  variantId.includes("SEED_REPLACE") ||
  !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId.trim());

const resolveSeedRows = (): MealNutritionImportRow[] => {
  const overrideRaw = process.env.MEAL_NUTRITION_VARIANT_IDS?.trim() ?? "";
  const overrides = overrideRaw
    ? overrideRaw.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  return DEV_SEED_TEMPLATE_ROWS.map((row, index) => ({
    ...row,
    variantId: overrides[index] ?? row.variantId,
  }));
};

const printDryRun = (rows: readonly MealNutritionImportRow[]) => {
  const plans = buildMealNutritionWritePlans(rows);

  console.log("[MEAL_NUTRITION_SEED] dry_run — aucune écriture Shopify");
  console.log(`[MEAL_NUTRITION_SEED] ${plans.length} variante(s)\n`);

  for (const plan of plans) {
    console.log(
      JSON.stringify(
        {
          variantId: plan.variantId,
          productTitle: plan.productTitle ?? null,
          objective: plan.objective ?? null,
          metafields: plan.metafields.map((metafield) => ({
            namespace: metafield.namespace,
            key: metafield.key,
            type: metafield.type,
            value: metafield.value,
            ownerId: metafield.ownerId,
          })),
        },
        null,
        2,
      ),
    );
  }
};

const main = async () => {
  const rows = resolveSeedRows();
  const validation = validateMealNutritionImportRows(rows);

  if (!validation.ok) {
    console.error("[MEAL_NUTRITION_SEED] validation failed:");
    for (const issue of validation.issues) {
      console.error(
        `  row ${issue.rowIndex}: [${issue.code}] ${issue.message}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    printDryRun(validation.validRows);
    console.log(
      "\n[MEAL_NUTRITION_SEED] Pour appliquer : ajouter --apply et des GIDs réels via MEAL_NUTRITION_VARIANT_IDS",
    );
    return;
  }

  const placeholders = validation.validRows.filter((row) =>
    isPlaceholderVariantId(row.variantId),
  );
  if (placeholders.length > 0) {
    console.error(
      "[MEAL_NUTRITION_SEED] --apply refusé : variantIds placeholder détectés.",
    );
    console.error(
      "Fournis des GIDs ProductVariant réels, ex. :\n" +
        '  MEAL_NUTRITION_VARIANT_IDS="gid://shopify/ProductVariant/123,gid://shopify/ProductVariant/456,gid://shopify/ProductVariant/789"',
    );
    process.exitCode = 1;
    return;
  }

  if (!SHOP) {
    console.error(
      "[MEAL_NUTRITION_SEED] --apply nécessite CRON_SHOP ou SHOP (domaine myshopify.com).",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[MEAL_NUTRITION_SEED] apply — shop=${SHOP}`);
  printDryRun(validation.validRows);

  const { applyMealNutritionMetafields } = await import(
    "../app/services/mealNutritionImport.server"
  );
  const { unauthenticated } = await import("../app/shopify.server");
  const { admin } = await unauthenticated.admin(SHOP);
  const writeResult = await applyMealNutritionMetafields(
    admin,
    validation.validRows,
  );

  if (writeResult.errors.length > 0) {
    console.error("[MEAL_NUTRITION_SEED] Shopify userErrors:");
    for (const error of writeResult.errors) {
      console.error(`  ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[MEAL_NUTRITION_SEED] OK — ${writeResult.appliedVariantCount} variante(s), 5 metafields chacune (custom.*).`,
  );
  console.log(
    "Vérifier ensuite window.__MILEYO_BOX_BUILDER__.meals (calories, proteins, carbs, fat, portionGrams).",
  );
};

main().catch((error) => {
  console.error("[MEAL_NUTRITION_SEED] fatal:", error);
  process.exitCode = 1;
});
