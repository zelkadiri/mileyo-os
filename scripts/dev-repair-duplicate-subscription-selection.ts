#!/usr/bin/env npx tsx
/**
 * Diagnose and repair duplicate SubscriptionMealSelection rows per contract.
 *
 * Usage:
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts inspect
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts inspect --order 1008
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair-all
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair-all --execute
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --contract 25391857804
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --contract 25391857804 --execute
 *   npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --canonical-id <id> --duplicate-id <id> --execute
 */
import db from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import {
  archiveDuplicateSubscriptionSelection,
  fetchSubscriptionContractOriginOrderId,
  findDuplicateSubscriptionSelectionsByContract,
} from "../app/services/subscriptionMealSelection.server";
import { normalizeShopifyId } from "../app/utils/shopifyIds.server";

const args = process.argv.slice(2);
const command = args[0] ?? "inspect";
const execute = args.includes("--execute");
const orderArgIndex = args.indexOf("--order");
const orderFilter =
  orderArgIndex >= 0 ? args[orderArgIndex + 1]?.replace(/^#/, "") : null;
const contractArgIndex = args.indexOf("--contract");
const contractFilter =
  contractArgIndex >= 0 ? args[contractArgIndex + 1] : null;
const duplicateId =
  args[args.indexOf("--duplicate-id") + 1] ??
  args[args.indexOf("--duplicate") + 1] ??
  null;
const canonicalId =
  args[args.indexOf("--canonical-id") + 1] ??
  args[args.indexOf("--canonical") + 1] ??
  null;

type RepairPlan = {
  canonicalId: string;
  canonicalOrder: string | null;
  contractId: string;
  duplicateId: string;
  duplicateOrder: string | null;
  originOrderId: string | null;
  reason: string;
  shop: string;
};

const resolveCanonicalFromOriginOrder = async ({
  contractId,
  items,
  shop,
}: {
  contractId: string;
  items: {
    id: string;
    shopifyOrderId: string;
    shopifyOrderName: string | null;
  }[];
  shop: string;
}): Promise<
  | { canonicalId: string; originOrderId: string; reason: string }
  | { error: string; originOrderId: string | null }
> => {
  const { admin } = await unauthenticated.admin(shop);
  const originOrderId = await fetchSubscriptionContractOriginOrderId(
    admin,
    contractId,
  );

  if (!originOrderId) {
    return {
      error: `Impossible de lire originOrder pour le contrat ${contractId}.`,
      originOrderId: null,
    };
  }

  const matches = items.filter((item) =>
    normalizeShopifyId(item.shopifyOrderId) === originOrderId,
  );

  if (matches.length === 1) {
    return {
      canonicalId: matches[0].id,
      originOrderId,
      reason: "origin_order_match",
    };
  }

  if (matches.length === 0) {
    return {
      error: `Aucune sélection locale ne correspond à originOrder ${originOrderId}.`,
      originOrderId,
    };
  }

  return {
    error: `Plusieurs sélections correspondent à originOrder ${originOrderId}: ${matches.map((item) => item.id).join(", ")}.`,
    originOrderId,
  };
};

const buildRepairPlans = async () => {
  const duplicateGroups = await findDuplicateSubscriptionSelectionsByContract();
  const plans: RepairPlan[] = [];
  const errors: { contractId: string; message: string }[] = [];

  for (const group of duplicateGroups) {
    if (
      contractFilter &&
      normalizeShopifyId(contractFilter) !== group.contractId
    ) {
      continue;
    }

    if (orderFilter) {
      const matchesOrder = group.items.some(
        (item) =>
          item.shopifyOrderName === `#${orderFilter}` ||
          item.shopifyOrderName === orderFilter ||
          normalizeShopifyId(item.shopifyOrderId) === orderFilter,
      );

      if (!matchesOrder) {
        continue;
      }
    }

    const shop = group.items[0]?.shop;

    if (!shop) {
      continue;
    }

    const canonicalResolution = await resolveCanonicalFromOriginOrder({
      contractId: group.contractId,
      items: group.items,
      shop,
    });

    if ("error" in canonicalResolution) {
      errors.push({
        contractId: group.contractId,
        message: canonicalResolution.error,
      });
      continue;
    }

    for (const item of group.items) {
      if (item.id === canonicalResolution.canonicalId) {
        continue;
      }

      const canonical = group.items.find(
        (candidate) => candidate.id === canonicalResolution.canonicalId,
      );

      plans.push({
        canonicalId: canonicalResolution.canonicalId,
        canonicalOrder: canonical?.shopifyOrderName ?? null,
        contractId: group.contractId,
        duplicateId: item.id,
        duplicateOrder: item.shopifyOrderName,
        originOrderId: canonicalResolution.originOrderId,
        reason: canonicalResolution.reason,
        shop,
      });
    }
  }

  return { errors, plans };
};

const inspect = async () => {
  const { errors, plans } = await buildRepairPlans();

  if (plans.length === 0 && errors.length === 0) {
    console.log("No duplicate SubscriptionMealSelection rows by contract ID.");
    return;
  }

  for (const error of errors) {
    console.log("\n=== Contract", error.contractId, "— SKIPPED ===");
    console.log(error.message);
  }

  const groupedPlans = new Map<string, RepairPlan[]>();

  for (const plan of plans) {
    const group = groupedPlans.get(plan.contractId) ?? [];
    group.push(plan);
    groupedPlans.set(plan.contractId, group);
  }

  for (const [contractId, contractPlans] of groupedPlans) {
    console.log("\n=== Contract", contractId, "===");
    console.log({
      canonicalId: contractPlans[0]?.canonicalId,
      canonicalOrder: contractPlans[0]?.canonicalOrder,
      originOrderId: contractPlans[0]?.originOrderId,
      reason: contractPlans[0]?.reason,
    });

    for (const plan of contractPlans) {
      console.log({
        duplicateId: plan.duplicateId,
        duplicateOrder: plan.duplicateOrder,
      });
    }

    console.log("\nSuggested repair:");
    console.log(
      `  npx tsx scripts/dev-repair-duplicate-subscription-selection.ts repair --contract ${contractId} --execute`,
    );
  }
};

const repairContractGroup = async (contractId: string) => {
  const { errors, plans } = await buildRepairPlans();
  const contractPlans = plans.filter((plan) => plan.contractId === contractId);
  const contractError = errors.find((error) => error.contractId === contractId);

  if (contractError) {
    console.error("Repair blocked:", contractError.message);
    process.exit(1);
  }

  if (contractPlans.length === 0) {
    console.error("No repair plan found for contract", contractId);
    process.exit(1);
  }

  console.log("Repair plan:", contractPlans);

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to apply.");
    return;
  }

  for (const plan of contractPlans) {
    const result = await archiveDuplicateSubscriptionSelection({
      canonicalId: plan.canonicalId,
      duplicateId: plan.duplicateId,
    });

    console.log("Archived duplicate:", result);
  }

  console.log("Repair complete for contract", contractId);
};

const repairAll = async () => {
  const { errors, plans } = await buildRepairPlans();

  if (errors.length > 0) {
    console.error("Repair blocked for ambiguous contracts:");
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }

  if (plans.length === 0) {
    console.log("No duplicate contracts to repair.");
    return;
  }

  console.log("Repair plans:", plans);

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to apply.");
    return;
  }

  for (const plan of plans) {
    const result = await archiveDuplicateSubscriptionSelection({
      canonicalId: plan.canonicalId,
      duplicateId: plan.duplicateId,
    });

    console.log("Archived duplicate:", result);
  }

  console.log("Repair complete.");
};

const repairManual = async () => {
  if (!duplicateId || !canonicalId) {
    console.error("repair requires --canonical-id and --duplicate-id");
    process.exit(1);
  }

  const boxOrders = await db.boxOrder.findMany({
    where: { subscriptionSelectionId: duplicateId },
  });

  console.log("Manual repair plan:", {
    boxOrdersToRepoint: boxOrders.map((order) => ({
      shopifyOrderId: order.shopifyOrderId,
      shopifyOrderName: order.shopifyOrderName,
    })),
    canonicalId,
    duplicateId,
  });

  if (!execute) {
    console.log("Dry run only. Re-run with --execute to apply.");
    return;
  }

  const result = await archiveDuplicateSubscriptionSelection({
    canonicalId,
    duplicateId,
  });

  console.log("Repair complete:", result);
};

if (command === "repair-all") {
  await repairAll();
} else if (command === "repair") {
  if (contractFilter) {
    await repairContractGroup(normalizeShopifyId(contractFilter) ?? contractFilter);
  } else {
    await repairManual();
  }
} else {
  await inspect();
}

await db.$disconnect();
