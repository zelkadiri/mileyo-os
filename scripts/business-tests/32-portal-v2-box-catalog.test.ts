/**
 * Business regression — portal V2 box catalog (QA portal migration).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BOX_V2_MEAL_COUNTS } from "../../app/constants/subscriptionBoxCatalogV2";
import {
  SUBSCRIPTION_OBJECTIVE,
  SUBSCRIPTION_OBJECTIVE_OPTION_LABEL,
} from "../../app/constants/subscriptionObjective";
import {
  filterBuilderBoxesByObjective,
  findBuilderBoxByVariantId,
} from "../../app/features/builder/builder-box-selection";
import type { BuilderBoxOption } from "../../app/features/builder/builder-types";
import {
  getPortalObjectiveLabel,
  getPortalPickerBoxesForObjective,
  getPortalV2BoxTitle,
  toPortalV2BoxProducts,
} from "../../app/features/portal/portal-boxes";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const PLAN_ID = "gid://shopify/SellingPlan/9001";
const PRODUCT_ID = "gid://shopify/Product/5001";

const buildBox = (
  mealCount: number,
  objective: BuilderBoxOption["objective"],
  price: string,
  variantSuffix: string,
): BuilderBoxOption => ({
  mealCount,
  objective,
  price,
  productId: PRODUCT_ID,
  productTitle: "Box Mileyo V2",
  sellingPlanId: PLAN_ID,
  variantId: `gid://shopify/ProductVariant/${variantSuffix}`,
  variantTitle: `${mealCount} ${objective}`,
});

const buildCatalog = (): BuilderBoxOption[] => [
  buildBox(8, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "76.11", "811"),
  buildBox(10, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "96.11", "1011"),
  buildBox(12, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "125.11", "1211"),
  buildBox(16, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "158.11", "1611"),
  buildBox(20, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "180.11", "2011"),
  buildBox(24, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "200.11", "2411"),
  buildBox(8, SUBSCRIPTION_OBJECTIVE.BALANCED, "76.22", "822"),
  buildBox(16, SUBSCRIPTION_OBJECTIVE.BALANCED, "158.22", "1622"),
  buildBox(6, SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS, "50.00", "611"),
  buildBox(8, SUBSCRIPTION_OBJECTIVE.BULK, "76.33", "833"),
];

const runSuite = () => {
  const ctx = createBusinessTestContext("32-portal-v2-box-catalog");
  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalActions = readSource("app/features/portal/portal-actions.server.ts");
  const portalRender = readSource("app/features/portal/portal-render.ts");
  const portalClient = readSource("app/features/portal/portal-client.ts");
  const portalBoxes = readSource("app/features/portal/portal-boxes.ts");
  const portalRoute = readSource("app/routes/apps.box-builder.portal.tsx");
  const contractBoxChange = readSource(
    "app/services/subscriptionContractBoxChange.server.ts",
  );
  const builderCatalog = readSource(
    "app/features/builder/builder-catalog.server.ts",
  );
  const catalog = buildCatalog();

  ctx.scenario("A. Portail branché sur le catalogue V2 existant");
  ctx.assertTrue(
    "portal data uses fetchBuilderBoxOptions",
    portalData.includes("fetchBuilderBoxOptions"),
  );
  ctx.assertTrue(
    "builder catalog still fetches V2 by handle",
    builderCatalog.includes("fetchTrustedBoxCatalogOptionsByHandleV2"),
  );
  ctx.assertTrue(
    "portal data uses findBuilderBoxByVariantId",
    portalData.includes("findBuilderBoxByVariantId"),
  );
  ctx.assertTrue(
    "portal boxes reuse filterBuilderBoxesByObjective",
    portalBoxes.includes("filterBuilderBoxesByObjective"),
  );
  ctx.assertFalse(
    "portal data does not fetch V1 collection catalog",
    portalData.includes("fetchBoxCatalogProducts") ||
      portalData.includes("fetchTrustedBoxCatalog") ||
      portalData.includes("toPortalBoxProducts") ||
      portalData.includes("toTrustedBoxProducts"),
  );
  ctx.assertFalse(
    "portal data does not read boxCollectionId",
    portalData.includes("boxCollectionId"),
  );
  ctx.assertFalse(
    "portal actions do not read boxCollectionId",
    portalActions.includes("boxCollectionId"),
  );
  ctx.assertFalse(
    "portal actions do not use V1 TrustedBoxProduct resolvers",
    portalActions.includes("fetchTrustedBoxCatalog") ||
      portalActions.includes("resolveTrustedBoxProduct") ||
      portalActions.includes("resolveCurrentBoxProduct"),
  );
  ctx.assertFalse(
    "portal files do not use custom.prix_abonnement",
    portalData.includes("prix_abonnement") ||
      portalActions.includes("prix_abonnement") ||
      portalBoxes.includes("prix_abonnement") ||
      portalRender.includes("prix_abonnement"),
  );

  ctx.scenario("B. Picker V2 — tailles et prix par objectif");
  const weightLossPicker = getPortalPickerBoxesForObjective(
    catalog,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual("weight_loss picker count", weightLossPicker.length, 6);
  ctx.assertEqual(
    "weight_loss meal counts",
    weightLossPicker.map((box) => box.mealCount).join(","),
    BOX_V2_MEAL_COUNTS.join(","),
  );
  ctx.assertEqual(
    "weight_loss titles",
    weightLossPicker.map((box) => box.title).join("|"),
    "Box 8 repas|Box 10 repas|Box 12 repas|Box 16 repas|Box 20 repas|Box 24 repas",
  );
  ctx.assertEqual(
    "16 weight_loss price from variant",
    weightLossPicker.find((box) => box.mealCount === 16)?.price,
    "158.11",
  );
  ctx.assertTrue(
    "legacy 6-meal excluded",
    weightLossPicker.every((box) => box.mealCount !== 6),
  );

  const balancedPicker = getPortalPickerBoxesForObjective(
    catalog,
    SUBSCRIPTION_OBJECTIVE.BALANCED,
  );
  ctx.assertEqual("balanced picker count", balancedPicker.length, 2);
  ctx.assertEqual(
    "16 balanced price differs from weight_loss",
    balancedPicker.find((box) => box.mealCount === 16)?.price,
    "158.22",
  );
  ctx.assertTrue(
    "balanced picker stays on balanced",
    balancedPicker.every(
      (box) => box.objective === SUBSCRIPTION_OBJECTIVE.BALANCED,
    ),
  );
  ctx.assertEqual(
    "no objective yields empty picker",
    getPortalPickerBoxesForObjective(catalog, null).length,
    0,
  );

  const allPortalBoxes = toPortalV2BoxProducts(catalog);
  ctx.assertTrue(
    "portal mapping drops non-V2 meal counts",
    allPortalBoxes.every((box) =>
      (BOX_V2_MEAL_COUNTS as readonly number[]).includes(box.mealCount),
    ),
  );

  ctx.scenario("C. Objectif affiché depuis le label canonique");
  ctx.assertEqual(
    "weight_loss label",
    getPortalObjectiveLabel(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    "Perte de poids",
  );
  ctx.assertEqual(
    "label helper uses shared constant",
    getPortalObjectiveLabel(SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS),
    SUBSCRIPTION_OBJECTIVE_OPTION_LABEL[SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS],
  );
  ctx.assertNull("null objective has no label", getPortalObjectiveLabel(null));
  ctx.assertEqual(
    "box title helper",
    getPortalV2BoxTitle(16),
    "Box 16 repas",
  );
  ctx.assertTrue(
    "subscription formula renders objective label",
    portalRender.includes("subscription-plan-objective") &&
      portalRender.includes("selection.objectiveLabel"),
  );
  ctx.assertFalse(
    "objectif remains read-only — no objective mutation intent",
    portalClient.includes("changeSubscriptionObjective") ||
      portalActions.includes("changeSubscriptionObjective") ||
      portalActions.includes('intent === "changeObjective"') ||
      portalActions.includes('intent === "updateObjective"'),
  );

  ctx.scenario("D. Identité picker = productVariantId");
  ctx.assertTrue(
    "render uses data-variant-id",
    portalRender.includes("data-variant-id="),
  );
  ctx.assertFalse(
    "render no longer uses data-box-id",
    portalRender.includes("data-box-id="),
  );
  ctx.assertTrue(
    "client posts productVariantId",
    portalClient.includes('body.set("productVariantId"'),
  );
  ctx.assertFalse(
    "client no longer posts boxProductId",
    portalClient.includes("boxProductId"),
  );
  ctx.assertTrue(
    "actions read productVariantId",
    portalActions.includes('formData.get("productVariantId")'),
  );
  ctx.assertFalse(
    "actions no longer read boxProductId",
    portalActions.includes("boxProductId"),
  );
  ctx.assertTrue(
    "actions resolve selected variant in current objective",
    portalActions.includes("filterBuilderBoxesByObjective") &&
      portalActions.includes("findBuilderBoxByVariantId"),
  );
  ctx.assertTrue(
    "actions keep current objective",
    portalActions.includes("selectedBox.objective !== currentBox.objective"),
  );

  const current = findBuilderBoxByVariantId(
    catalog,
    "gid://shopify/ProductVariant/1611",
  );
  const allowed = filterBuilderBoxesByObjective(
    catalog,
    current?.objective ?? null,
  );
  const otherObjective = findBuilderBoxByVariantId(
    catalog,
    "gid://shopify/ProductVariant/1622",
  );
  ctx.assertEqual(
    "current 16 weight_loss found",
    current?.price,
    "158.11",
  );
  ctx.assertEqual(
    "same-objective 16 is selectable",
    findBuilderBoxByVariantId(allowed, current?.variantId)?.mealCount,
    16,
  );
  ctx.assertNull(
    "balanced variant excluded from weight_loss picker",
    findBuilderBoxByVariantId(allowed, otherObjective?.variantId),
  );

  ctx.scenario("E. Draft/commit Shopify inchangé — seules les données V2");
  ctx.assertTrue(
    "draft still created via subscriptionContractUpdate",
    contractBoxChange.includes("subscriptionContractUpdate(") &&
      contractBoxChange.includes("mutation SubscriptionContractUpdateForBoxChange"),
  );
  ctx.assertTrue(
    "line still updated via subscriptionDraftLineUpdate",
    contractBoxChange.includes("subscriptionDraftLineUpdate(") &&
      contractBoxChange.includes("mutation SubscriptionDraftLineUpdateForBoxChange"),
  );
  ctx.assertTrue(
    "commit still via subscriptionDraftCommit",
    contractBoxChange.includes("subscriptionDraftCommit(") &&
      contractBoxChange.includes("mutation SubscriptionDraftCommitForBoxChange"),
  );
  ctx.assertTrue(
    "draft input uses variant price and variant id",
    contractBoxChange.includes("currentPrice: box.price") &&
      contractBoxChange.includes("productVariantId: box.variantId"),
  );
  ctx.assertFalse(
    "draft no longer uses V1 subscriptionPrice metafield field",
    contractBoxChange.includes("box.subscriptionPrice"),
  );
  ctx.assertTrue(
    "portal still calls updateSubscriptionContractBoxViaDraft",
    portalActions.includes("updateSubscriptionContractBoxViaDraft("),
  );
  ctx.assertTrue(
    "current variant is read-only from contract",
    portalData.includes("fetchSubscriptionContractCurrentVariantId") &&
      contractBoxChange.includes(
        "export const fetchSubscriptionContractCurrentVariantId",
      ),
  );
  ctx.assertFalse(
    "portal route does not touch orders/create",
    portalRoute.includes("orders.create") ||
      portalActions.includes("upsertSubscriptionMealSelectionFromFirstOrder"),
  );

  return finishSuite("32-portal-v2-box-catalog", ctx);
};

process.exitCode = runSuite();
