/**
 * Business regression — portal next-box listing excludes V1 / legacy selections.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import { findBuilderBoxByVariantId } from "../../app/features/builder/builder-box-selection";
import type { BuilderBoxOption } from "../../app/features/builder/builder-types";
import { shouldIncludeInPortalNextBox } from "../../app/features/portal/portal-boxes";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const readSource = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const V2_VARIANT_ID = "gid://shopify/ProductVariant/v2-16-wl";
const V1_DUO_VARIANT_ID = "gid://shopify/ProductVariant/v1-16-duo";

const buildV2Box = (): BuilderBoxOption => ({
  mealCount: 16,
  objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  price: "158.11",
  productId: "gid://shopify/Product/box-mileyo-v2",
  productTitle: "Box Mileyo V2",
  sellingPlanId: "gid://shopify/SellingPlan/9001",
  variantId: V2_VARIANT_ID,
  variantTitle: "16 repas Perte de poids",
});

const nextBoxIds = (
  catalog: readonly BuilderBoxOption[],
  candidates: { id: string; status: string; variantId: string | null }[],
) =>
  candidates
    .filter((candidate) =>
      shouldIncludeInPortalNextBox({
        catalog,
        currentVariantId: candidate.variantId,
        status: candidate.status,
      }),
    )
    .map((candidate) => candidate.id);

const runSuite = () => {
  const ctx = createBusinessTestContext("35-portal-legacy-subscription-filter");
  const portalData = readSource("app/features/portal/portal-data.server.ts");
  const portalBoxes = readSource("app/features/portal/portal-boxes.ts");
  const catalog = [buildV2Box()];

  ctx.scenario("A. Même customer — seul V2 dans Ma prochaine box (selector)");
  const mixed = nextBoxIds(catalog, [
    {
      id: "sel-v2",
      status: "active",
      variantId: V2_VARIANT_ID,
    },
    {
      id: "sel-v1",
      status: "active",
      variantId: V1_DUO_VARIANT_ID,
    },
  ]);
  ctx.assertEqual("only V2 id kept for next-box/manageable", mixed.join("|"), "sel-v2");
  ctx.assertTrue(
    "V1 variant is not in V2 catalog",
    findBuilderBoxByVariantId(catalog, V1_DUO_VARIANT_ID) === null,
  );
  ctx.assertTrue(
    "V1 can surface as legacySubscriptions (not dropped silently)",
    portalData.includes("legacySubscriptions") &&
      portalData.includes("PortalLegacySubscription") &&
      portalData.includes("shouldIncludeInPortalNextBox({"),
  );

  ctx.scenario("B. Variant V1 Box 16 repas (Duo) exclu");
  ctx.assertFalse(
    "Duo variant excluded from next box",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: V1_DUO_VARIANT_ID,
      status: "active",
    }),
  );

  ctx.scenario("C. Variant non résolvable exclu si catalogue V2 disponible");
  ctx.assertFalse(
    "null variant excluded when catalog loaded",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: null,
      status: "active",
    }),
  );
  ctx.assertFalse(
    "empty variant excluded when catalog loaded",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: "   ",
      status: "paused",
    }),
  );

  ctx.scenario("D. Abonnement V2 toujours affiché");
  ctx.assertTrue(
    "active V2 kept",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: V2_VARIANT_ID,
      status: "active",
    }),
  );
  ctx.assertTrue(
    "paused V2 kept",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: V2_VARIANT_ID,
      status: "paused",
    }),
  );

  ctx.scenario("E. Catalogue V2 vide — pas de masquage massif");
  ctx.assertTrue(
    "V1 kept when catalog empty",
    shouldIncludeInPortalNextBox({
      catalog: [],
      currentVariantId: V1_DUO_VARIANT_ID,
      status: "active",
    }),
  );
  ctx.assertTrue(
    "unresolved variant kept when catalog empty",
    shouldIncludeInPortalNextBox({
      catalog: [],
      currentVariantId: null,
      status: "paused",
    }),
  );
  ctx.assertEqual(
    "empty catalog keeps mixed customer rows",
    nextBoxIds([], [
      { id: "sel-v2", status: "active", variantId: V2_VARIANT_ID },
      { id: "sel-v1", status: "active", variantId: V1_DUO_VARIANT_ID },
    ]).join("|"),
    "sel-v2|sel-v1",
  );

  ctx.scenario("F. Historique BoxOrder — isolé par subscription (pas drop)");
  ctx.assertTrue(
    "history scoped via selection/contract filters helper",
    portalData.includes("loadPortalHistoryOrdersForSelection") &&
      portalData.includes("buildPortalHistoryOrderFilters"),
  );
  ctx.assertTrue(
    "BoxOrder snapshots still loaded for history",
    portalData.includes("const boxOrders = await prisma.boxOrder.findMany"),
  );
  ctx.assertFalse(
    "portal data does not delete BoxOrder or selections",
    portalData.includes("prisma.boxOrder.delete") ||
      portalData.includes("prisma.subscriptionMealSelection.delete"),
  );
  ctx.assertTrue(
    "legacy V1 section rendered without V2 edit actions",
    readSource("app/features/portal/portal-render.ts").includes(
      "Autres abonnements",
    ) &&
      readSource("app/features/portal/portal-render.ts").includes(
        "ancienne formule Mileyo",
      ),
  );

  ctx.scenario("G. Statut terminal après reconcile — hors prochaine box");
  ctx.assertFalse(
    "cancelled excluded",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: V2_VARIANT_ID,
      status: "cancelled",
    }),
  );
  ctx.assertFalse(
    "expired excluded",
    shouldIncludeInPortalNextBox({
      catalog,
      currentVariantId: V2_VARIANT_ID,
      status: "expired",
    }),
  );
  ctx.assertFalse(
    "failed excluded",
    shouldIncludeInPortalNextBox({
      catalog: [],
      currentVariantId: V2_VARIANT_ID,
      status: "failed",
    }),
  );

  ctx.scenario("H. Filtre branché sur le lookup catalogue V2, pas l'objectif");
  ctx.assertTrue(
    "portal data uses shouldIncludeInPortalNextBox after currentVariantId",
    portalData.includes("shouldIncludeInPortalNextBox({") &&
      portalData.includes("findBuilderBoxByVariantId(catalog, currentVariantId)") &&
      portalData.includes("fetchSubscriptionContractCurrentVariantId"),
  );
  ctx.assertTrue(
    "helper uses catalog membership not objective absence",
    portalBoxes.includes("findBuilderBoxByVariantId(catalog, currentVariantId) !== null") &&
      portalBoxes.includes("catalog.length === 0"),
  );
  ctx.assertTrue(
    "terminal reconcile is checked before next-box include",
    portalData.includes("isTerminalPortalDisplayStatus(reconciled.status)"),
  );
  ctx.assertFalse(
    "no Prisma delete in portal data",
    portalData.includes("prisma.subscriptionMealSelection.delete") ||
      portalData.includes("prisma.boxOrder.delete"),
  );

  return finishSuite("35-portal-legacy-subscription-filter", ctx);
};

process.exitCode = runSuite();
