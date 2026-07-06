#!/usr/bin/env npx tsx
/**
 * DEV: backfill SubscriptionMealSelection from an existing BoxOrder
 * when the first checkout was wrongly classified as orphan_renewal.
 *
 * Usage:
 *   npx tsx scripts/dev-backfill-subscription-from-box-order.ts --order 1013
 *   npx tsx scripts/dev-backfill-subscription-from-box-order.ts --order 1013 --execute
 */
import db from "../app/db.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";
import {
  findCanonicalSubscriptionMealSelectionByContractId,
  recoverSelectionFromOriginBoxOrder,
  reconcileSubscriptionSelectionWithContract,
} from "../app/services/subscriptionMealSelection.server";
import { unauthenticated } from "../app/shopify.server";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const orderIndex = args.indexOf("--order");
const orderName =
  orderIndex >= 0 ? `#${args[orderIndex + 1]?.replace(/^#/, "")}` : null;

if (!orderName) {
  console.error("Usage: --order 1013 [--execute]");
  process.exit(1);
}

const main = async () => {
  const boxOrder = await db.boxOrder.findFirst({
    where: {
      OR: [{ shopifyOrderName: orderName }, { shopifyOrderId: orderName.slice(1) }],
    },
  });

  if (!boxOrder) {
    console.error("BoxOrder not found for", orderName);
    process.exit(1);
  }

  const contractId = normalizeShopifyId(boxOrder.subscriptionContractId);

  if (!contractId) {
    console.error("BoxOrder has no subscriptionContractId");
    process.exit(1);
  }

  const existing = await findCanonicalSubscriptionMealSelectionByContractId({
    shop: boxOrder.shop,
    subscriptionContractId: contractId,
  }) ?? await db.subscriptionMealSelection.findFirst({
    where: {
      shop: boxOrder.shop,
      shopifyOrderId: boxOrder.shopifyOrderId,
    },
  });

  if (existing) {
    console.log("SubscriptionMealSelection already exists:", existing.id);
    return;
  }

  const { admin } = await unauthenticated.admin(boxOrder.shop);

  const plan = await reconcileSubscriptionSelectionWithContract({
    admin,
    currentShopifyOrderId: boxOrder.shopifyOrderId,
    shop: boxOrder.shop,
    subscriptionContractId: contractId,
  });

  if (!plan.selection) {
    const fallback = await recoverSelectionFromOriginBoxOrder({
      admin,
      originShopifyOrderId: boxOrder.shopifyOrderId,
      shop: boxOrder.shop,
      subscriptionContractId: contractId,
    });

    console.log("Reconciliation plan:", fallback);

    if (!execute) {
      console.log("Dry run. Re-run with --execute to apply.");
      return;
    }

    if (!fallback.selection) {
      console.error("Could not recover selection:", fallback.reason);
      process.exit(1);
    }

    await db.boxOrder.update({
      data: { subscriptionSelectionId: fallback.selection.id },
      where: { id: boxOrder.id },
    });

    console.log("Created/recovered SubscriptionMealSelection:", fallback.selection.id);
    return;
  }

  console.log("Reconciliation plan:", {
    reason: plan.reason,
    selectionId: plan.selection.id,
    source: plan.source,
  });

  if (!execute) {
    console.log("Dry run. Re-run with --execute to link BoxOrder.");
    return;
  }

  await db.boxOrder.update({
    data: { subscriptionSelectionId: plan.selection.id },
    where: { id: boxOrder.id },
  });

  console.log("Linked SubscriptionMealSelection:", plan.selection.id);
};

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
