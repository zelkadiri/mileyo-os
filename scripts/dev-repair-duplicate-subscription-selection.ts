#!/usr/bin/env npx tsx
/**
 * DEV-only helper: diagnose and optionally repair duplicate SubscriptionMealSelection
 * rows that share the same Shopify subscription contract.
 *
 * Usage:
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts inspect
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts inspect --order 1012
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --duplicate-id <id> --canonical-id <id> --execute
 */
import db from "../app/db.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";

const args = process.argv.slice(2);
const command = args[0] ?? "inspect";
const execute = args.includes("--execute");
const orderArgIndex = args.indexOf("--order");
const orderFilter =
  orderArgIndex >= 0 ? args[orderArgIndex + 1]?.replace(/^#/, "") : null;
const duplicateId =
  args[args.indexOf("--duplicate-id") + 1] ??
  args[args.indexOf("--duplicate") + 1] ??
  null;
const canonicalId =
  args[args.indexOf("--canonical-id") + 1] ??
  args[args.indexOf("--canonical") + 1] ??
  null;

const groupByContract = async () => {
  const selections = await db.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "asc" },
    where: {
      subscriptionContractId: { not: null },
      ...(orderFilter
        ? {
            OR: [
              { shopifyOrderName: `#${orderFilter}` },
              { shopifyOrderName: orderFilter },
              { shopifyOrderId: orderFilter },
            ],
          }
        : {}),
    },
  });

  const groups = new Map<string, typeof selections>();

  for (const selection of selections) {
    const contractId = normalizeShopifyId(selection.subscriptionContractId);

    if (!contractId) {
      continue;
    }

    const group = groups.get(contractId) ?? [];
    group.push(selection);
    groups.set(contractId, group);
  }

  return groups;
};

const inspect = async () => {
  const groups = await groupByContract();
  const duplicates = [...groups.entries()].filter(([, items]) => items.length > 1);

  if (duplicates.length === 0) {
    console.log("No duplicate SubscriptionMealSelection rows by contract ID.");
    return;
  }

  for (const [contractId, items] of duplicates) {
    console.log("\n=== Contract", contractId, "===");
    for (const item of items) {
      console.log({
        active: item.active,
        createdAt: item.createdAt.toISOString(),
        id: item.id,
        shopifyOrderId: item.shopifyOrderId,
        shopifyOrderName: item.shopifyOrderName,
        status: item.status,
        subscriptionContractId: item.subscriptionContractId,
      });
    }

    const canonical = items[0];
    const duplicate = items[items.length - 1];

    console.log("\nSuggested repair (review before running):");
    console.log(
      `  npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --canonical-id ${canonical.id} --duplicate-id ${duplicate.id} --execute`,
    );
    console.log("Manual SQL preview:");
    console.log(
      `  UPDATE "BoxOrder" SET "subscriptionSelectionId" = '${canonical.id}' WHERE "subscriptionSelectionId" = '${duplicate.id}';`,
    );
    console.log(
      `  UPDATE "SubscriptionMealSelection" SET status = 'archived_duplicate', active = false WHERE id = '${duplicate.id}';`,
    );
  }
};

const repair = async () => {
  if (!duplicateId || !canonicalId) {
    console.error("repair requires --canonical-id and --duplicate-id");
    process.exit(1);
  }

  const [canonical, duplicate] = await Promise.all([
    db.subscriptionMealSelection.findUnique({ where: { id: canonicalId } }),
    db.subscriptionMealSelection.findUnique({ where: { id: duplicateId } }),
  ]);

  if (!canonical || !duplicate) {
    console.error("Canonical or duplicate selection not found.");
    process.exit(1);
  }

  const canonicalContract = normalizeShopifyId(canonical.subscriptionContractId);
  const duplicateContract = normalizeShopifyId(duplicate.subscriptionContractId);

  if (!canonicalContract || canonicalContract !== duplicateContract) {
    console.error("Contract IDs do not match — aborting.", {
      canonicalContract,
      duplicateContract,
    });
    process.exit(1);
  }

  const boxOrders = await db.boxOrder.findMany({
    where: { subscriptionSelectionId: duplicateId },
  });

  console.log("Repair plan:", {
    boxOrdersToRepoint: boxOrders.map((order) => ({
      shopifyOrderId: order.shopifyOrderId,
      shopifyOrderName: order.shopifyOrderName,
    })),
    canonicalId,
    duplicateId,
    subscriptionContractId: canonicalContract,
  });

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to apply.");
    return;
  }

  await db.$transaction([
    db.boxOrder.updateMany({
      data: { subscriptionSelectionId: canonicalId },
      where: { subscriptionSelectionId: duplicateId },
    }),
    db.subscriptionMealSelection.update({
      data: {
        active: false,
        status: "archived_duplicate",
        subscriptionContractId: null,
      },
      where: { id: duplicateId },
    }),
  ]);

  console.log("Repair complete. BoxOrder history preserved; duplicate archived.");
};

if (command === "repair") {
  await repair();
} else {
  await inspect();
}

await db.$disconnect();
