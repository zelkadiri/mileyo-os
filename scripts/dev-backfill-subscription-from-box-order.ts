#!/usr/bin/env npx tsx
/**
 * DEV: backfill SubscriptionMealSelection from an existing BoxOrder
 * when the first checkout was wrongly classified as orphan_renewal.
 *
 * Usage:
 *   npx tsx scripts/dev-backfill-subscription-from-box-order.ts --order 1013
 *   npx tsx scripts/dev-backfill-subscription-from-box-order.ts --order 1013 --execute
 */
import type { Prisma } from "@prisma/client";

import db from "../app/db.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";
import { fetchSubscriptionContractNextBillingDate } from "../app/services/subscriptionBillingWorker.server";
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

  const existing = await db.subscriptionMealSelection.findFirst({
    where: {
      shop: boxOrder.shop,
      OR: [
        { shopifyOrderId: boxOrder.shopifyOrderId },
        { subscriptionContractId: contractId },
        {
          subscriptionContractId: `gid://shopify/SubscriptionContract/${contractId}`,
        },
      ],
    },
  });

  if (existing) {
    console.log("SubscriptionMealSelection already exists:", existing.id);
    return;
  }

  const rawOrder = boxOrder.rawOrder as {
    customer?: { id?: number | string; email?: string | null };
  };
  const customerShopifyId = normalizeShopifyId(rawOrder.customer?.id);

  let nextBillingDate: Date | null = null;

  try {
    const { admin } = await unauthenticated.admin(boxOrder.shop);
    nextBillingDate = await fetchSubscriptionContractNextBillingDate(
      admin,
      contractId,
    );
  } catch (error) {
    console.log("nextBillingDate fetch failed (non-fatal)", error);
  }

  const payload = {
    active: true,
    boxTitle: boxOrder.boxTitle,
    customerEmail: boxOrder.customerEmail,
    customerShopifyId,
    mealsCount: boxOrder.mealsCount,
    selectedMeals: (boxOrder.selectedMeals ?? []) as Prisma.InputJsonValue,
    shop: boxOrder.shop,
    shopifyOrderId: boxOrder.shopifyOrderId,
    shopifyOrderName: boxOrder.shopifyOrderName,
    status: "active",
    subscriptionContractId: contractId,
    ...(nextBillingDate ? { nextBillingDate } : {}),
  };

  console.log("Backfill plan:", payload);

  if (!execute) {
    console.log("Dry run. Re-run with --execute to create.");
    return;
  }

  const selection = await db.subscriptionMealSelection.create({
    data: payload,
  });

  await db.boxOrder.update({
    data: { subscriptionSelectionId: selection.id },
    where: { id: boxOrder.id },
  });

  console.log("Created SubscriptionMealSelection:", selection.id);
};

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
