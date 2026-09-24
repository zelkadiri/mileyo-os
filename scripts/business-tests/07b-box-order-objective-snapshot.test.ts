/**
 * Business regression — BoxOrder objective snapshot from paid box line variant_id.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUBSCRIPTION_OBJECTIVE } from "../../app/constants/subscriptionObjective";
import {
  boxOrderObjectiveSnapshotWriteData,
  extractBoxLineVariantShopifyId,
  resolveBoxOrderObjectiveSnapshotFromRawOrder,
  resolveObjectiveSnapshotFromCatalog,
  toBoxVariantShopifyGid,
} from "../../app/features/orders-webhook/box-order-objective-snapshot.server";
import { findBoxLineItem } from "../../app/features/orders-webhook/orders-create-parsers";
import type { OrdersCreateWebhookPayload } from "../../app/features/orders-webhook/orders-create-types";
import { createBusinessTestContext, finishSuite } from "./_framework";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const VARIANT_NUMERIC = "61234567890123";
const VARIANT_GID = `gid://shopify/ProductVariant/${VARIANT_NUMERIC}`;

const catalog = [
  {
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    variantId: VARIANT_GID,
  },
  {
    objective: SUBSCRIPTION_OBJECTIVE.BALANCED,
    variantId: "gid://shopify/ProductVariant/999",
  },
];

const buildOrder = (
  overrides: Partial<OrdersCreateWebhookPayload> = {},
): OrdersCreateWebhookPayload => ({
  id: 1001,
  line_items: [
    {
      name: "Box 8 repas",
      properties: [
        { name: "Type de commande", value: "Abonnement hebdomadaire" },
        { name: "Nombre de repas", value: "8" },
        { name: "Plat 1", value: "Lasagnes" },
      ],
      title: "Box 8 repas",
      variant_id: Number(VARIANT_NUMERIC),
    },
  ],
  name: "#1001",
  ...overrides,
});

const stubAdmin = {
  graphql: async () => new Response("{}"),
};

const runSuite = async () => {
  const ctx = createBusinessTestContext("07b-box-order-objective-snapshot");

  ctx.scenario("variant_id numérique → GID");
  ctx.assertEqual(
    "toBoxVariantShopifyGid numeric",
    toBoxVariantShopifyGid(VARIANT_NUMERIC),
    VARIANT_GID,
  );
  ctx.assertEqual(
    "toBoxVariantShopifyGid already gid",
    toBoxVariantShopifyGid(VARIANT_GID),
    VARIANT_GID,
  );
  ctx.assertEqual(
    "extract from box line",
    extractBoxLineVariantShopifyId({ variant_id: Number(VARIANT_NUMERIC) }),
    VARIANT_GID,
  );

  ctx.scenario("findBoxLineItem + catalog → objective snapshot");
  const order = buildOrder();
  const boxLine = findBoxLineItem(order);
  ctx.assertTrue("box line found", Boolean(boxLine));
  const snapshot = resolveObjectiveSnapshotFromCatalog(
    catalog,
    extractBoxLineVariantShopifyId(boxLine),
  );
  ctx.assertEqual(
    "snapshot objective weight_loss",
    snapshot?.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "snapshot variant gid",
    snapshot?.boxVariantShopifyId,
    VARIANT_GID,
  );

  ctx.scenario("write data never spreads null");
  ctx.assertEqual(
    "null snapshot → empty write",
    Object.keys(boxOrderObjectiveSnapshotWriteData(null)).length,
    0,
  );
  const write = boxOrderObjectiveSnapshotWriteData(snapshot);
  ctx.assertEqual(
    "resolved write has objective",
    "objective" in write ? write.objective : null,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );

  ctx.scenario("replay: failed resolution must not wipe existing");
  const existing = {
    boxVariantShopifyId: VARIANT_GID,
    objective: SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  };
  const afterReplay = {
    ...existing,
    ...boxOrderObjectiveSnapshotWriteData(null),
  };
  ctx.assertEqual(
    "replay keeps objective",
    afterReplay.objective,
    SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
  );
  ctx.assertEqual(
    "replay keeps variant",
    afterReplay.boxVariantShopifyId,
    VARIANT_GID,
  );

  ctx.scenario("rawOrder backfill resolution paths");
  const okResult = await resolveBoxOrderObjectiveSnapshotFromRawOrder({
    admin: stubAdmin,
    fetchCatalog: async () =>
      catalog.map((entry) => ({
        ...entry,
        imageAlt: "",
        imageUrl: null,
        mealCount: 8,
        price: "59.00",
        productId: "gid://shopify/Product/1",
        productTitle: "Box",
        sellingPlanId: null,
        variantTitle: "8 / Perte de poids",
      })),
    rawOrder: order,
  });
  ctx.assertEqual("rawOrder ok", okResult.ok, true);
  if (okResult.ok) {
    ctx.assertEqual(
      "rawOrder objective",
      okResult.snapshot.objective,
      SUBSCRIPTION_OBJECTIVE.WEIGHT_LOSS,
    );
  }

  const missingRaw = await resolveBoxOrderObjectiveSnapshotFromRawOrder({
    admin: stubAdmin,
    fetchCatalog: async () => [],
    rawOrder: null,
  });
  ctx.assertEqual(
    "missingRawOrder",
    missingRaw.ok ? null : missingRaw.reason,
    "missingRawOrder",
  );

  const missingVariant = await resolveBoxOrderObjectiveSnapshotFromRawOrder({
    admin: stubAdmin,
    fetchCatalog: async () => [],
    rawOrder: buildOrder({
      line_items: [
        {
          properties: [
            { name: "Type de commande", value: "Abonnement hebdomadaire" },
            { name: "Nombre de repas", value: "8" },
          ],
          title: "Box 8 repas",
          variant_id: null,
        },
      ],
    }),
  });
  ctx.assertEqual(
    "missingVariantId",
    missingVariant.ok ? null : missingVariant.reason,
    "missingVariantId",
  );

  const notFound = await resolveBoxOrderObjectiveSnapshotFromRawOrder({
    admin: stubAdmin,
    fetchCatalog: async () => [],
    rawOrder: order,
  });
  ctx.assertEqual(
    "variantNotFound",
    notFound.ok ? null : notFound.reason,
    "variantNotFound",
  );

  ctx.scenario("unknown variant → null snapshot");
  ctx.assertEqual(
    "missing variant",
    resolveObjectiveSnapshotFromCatalog(
      catalog,
      "gid://shopify/ProductVariant/0",
    ),
    null,
  );

  ctx.scenario("orchestrator wires snapshot helpers");
  const orchestrator = readRepoFile(
    "app/features/orders-webhook/orders-create-orchestrator.server.ts",
  );
  ctx.assertTrue(
    "orchestrator imports resolveBoxOrderObjectiveSnapshotFromOrder",
    orchestrator.includes("resolveBoxOrderObjectiveSnapshotFromOrder"),
  );
  ctx.assertTrue(
    "orchestrator spreads objectiveSnapshotWrite on create/update",
    orchestrator.includes("...objectiveSnapshotWrite"),
  );
  ctx.assertTrue(
    "orchestrator does not use CheckoutLead.objective as snapshot SoT",
    !orchestrator.includes("checkoutLead.objective") &&
      !orchestrator.includes("lead.objective"),
  );

  return finishSuite("07b-box-order-objective-snapshot", ctx);
};

runSuite()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
