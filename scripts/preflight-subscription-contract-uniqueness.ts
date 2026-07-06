#!/usr/bin/env npx tsx
/**
 * Preflight before subscription contract uniqueness migration.
 *
 * Usage:
 *   npx tsx scripts/preflight-subscription-contract-uniqueness.ts
 *   npx tsx scripts/preflight-subscription-contract-uniqueness.ts --shop mileyo-ok1bszwz.myshopify.com
 *
 * Exit 0 = safe to migrate
 * Exit 1 = duplicates or GID leftovers detected — run repair first
 */
import db from "../app/db.server";
import { findDuplicateSubscriptionSelectionsByContract } from "../app/services/subscriptionMealSelection.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";

const args = process.argv.slice(2);
const shopIndex = args.indexOf("--shop");
const shop = shopIndex >= 0 ? args[shopIndex + 1] : undefined;

const main = async () => {
  const gidRows = await db.subscriptionMealSelection.findMany({
    select: {
      id: true,
      shopifyOrderName: true,
      subscriptionContractId: true,
    },
    where: {
      subscriptionContractId: {
        startsWith: "gid://shopify/SubscriptionContract/",
      },
      ...(shop ? { shop } : {}),
    },
  });

  const duplicateGroups = await findDuplicateSubscriptionSelectionsByContract({
    shop,
  });

  console.log("[preflight] subscription contract uniqueness");

  if (gidRows.length > 0) {
    console.log("[preflight] GID contract IDs to normalize by migration:", gidRows);
  } else {
    console.log("[preflight] no GID contract IDs found");
  }

  if (duplicateGroups.length === 0) {
    console.log("[preflight] OK — no duplicate contract selections detected");
    return;
  }

  console.error("[preflight] BLOCKED — duplicate contract selections detected:");
  for (const group of duplicateGroups) {
    console.error({
      contractId: group.contractId,
      selectionCount: group.items.length,
      selections: group.items.map((selection) => ({
        active: selection.active,
        id: selection.id,
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
        shopifyOrderName: selection.shopifyOrderName,
        status: selection.status,
        subscriptionContractId: normalizeShopifyId(
          selection.subscriptionContractId,
        ),
        updatedAt: selection.updatedAt.toISOString(),
      })),
    });
  }

  console.error(
    "\nRepair before migrating:\n  npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair-all\n  npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair-all --execute",
  );
  process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error("[preflight] failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
