/**
 * Patch 1 — dev tests for subscription contract lifecycle sync.
 * Usage: npx tsx scripts/dev-patch1-contract-sync-tests.ts [contractId]
 *
 * Never touches REFERENCE_CONTRACT_ID (25688637580).
 */
import { unauthenticated } from "../app/shopify.server";
import db from "../app/db.server";
import {
  assertSubscriptionContractActionAllowed,
  syncSubscriptionContractState,
} from "../app/services/subscriptionContractSync.server";
import { processDueSubscriptionBillings } from "../app/services/subscriptionBillingWorker.server";
import {
  activateSubscriptionContractWithVerification,
  fetchSubscriptionContractStatus,
  pauseSubscriptionContractOnShopify,
} from "../app/services/subscriptionBillingWorker.server";
import { findSubscriptionMealSelectionByContractId } from "../app/services/subscriptionMealSelection.server";

const SHOP = "mileyo-ok1bszwz.myshopify.com";
const REFERENCE_CONTRACT_ID = "25688637580";

const subscriptionContractCancelMutation = `#graphql
  mutation SubscriptionContractCancel($subscriptionContractId: ID!) {
    subscriptionContractCancel(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const snapshotSelection = async (contractId: string) => {
  const selection = await findSubscriptionMealSelectionByContractId({
    shop: SHOP,
    subscriptionContractId: contractId,
  });

  const count = await db.subscriptionMealSelection.count({
    where: { shop: SHOP, subscriptionContractId: contractId },
  });

  return {
    count,
    selection: selection
      ? {
          active: selection.active,
          id: selection.id,
          mealsCount: selection.mealsCount,
          nextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
          selectedMealsLength: Array.isArray(selection.selectedMeals)
            ? selection.selectedMeals.length
            : null,
          status: selection.status,
          subscriptionContractId: selection.subscriptionContractId,
        }
      : null,
  };
};

const cancelOnShopify = async (
  admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"],
  contractId: string,
) => {
  const response = await admin.graphql(subscriptionContractCancelMutation, {
    variables: {
      subscriptionContractId: `gid://shopify/SubscriptionContract/${contractId}`,
    },
  });
  const json = (await response.json()) as {
    data?: {
      subscriptionContractCancel?: {
        contract?: { status?: string | null } | null;
        userErrors?: { message?: string | null }[];
      } | null;
    };
    errors?: { message?: string | null }[];
  };

  return {
    errors: json.errors?.map((e) => e.message).filter(Boolean) ?? [],
    status: json.data?.subscriptionContractCancel?.contract?.status ?? null,
    userErrors:
      json.data?.subscriptionContractCancel?.userErrors
        ?.map((e) => e.message)
        .filter(Boolean) ?? [],
  };
};

const pickTestContractId = async (explicit?: string) => {
  if (explicit) {
    if (explicit === REFERENCE_CONTRACT_ID) {
      throw new Error(`Refusing to test reference contract ${REFERENCE_CONTRACT_ID}`);
    }
    return explicit;
  }

  const candidate = await db.subscriptionMealSelection.findFirst({
    orderBy: { createdAt: "desc" },
    where: {
      shop: SHOP,
      subscriptionContractId: { not: REFERENCE_CONTRACT_ID },
      status: { in: ["active", "paused"] },
    },
  });

  if (!candidate?.subscriptionContractId) {
    throw new Error(
      "No disposable test contract found. Create a new subscription checkout first.",
    );
  }

  return candidate.subscriptionContractId;
};

const logStep = (title: string, data: unknown) => {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
};

const main = async () => {
  const explicitContract = process.argv[2];
  const contractId = await pickTestContractId(explicitContract);

  console.log(`Using disposable test contract: ${contractId}`);
  console.log(`Reference contract ${REFERENCE_CONTRACT_ID} will NOT be touched.`);

  const { admin } = await unauthenticated.admin(SHOP);

  logStep("BASELINE local", await snapshotSelection(contractId));
  logStep("BASELINE Shopify", {
    status: await fetchSubscriptionContractStatus(admin, contractId),
  });

  // Test 1 — ensure active
  let shopifyStatus = await fetchSubscriptionContractStatus(admin, contractId);
  if (shopifyStatus === "PAUSED") {
    const activate = await activateSubscriptionContractWithVerification(admin, contractId, {
      selectionId: "dev-test",
    });
    logStep("Test 1 — reactivated for baseline", activate);
    shopifyStatus = await fetchSubscriptionContractStatus(admin, contractId);
  }

  const syncActive = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "cron",
    subscriptionContractId: contractId,
  });
  logStep("Test 1 — sync active", {
    action: syncActive.action,
    localStatusAfter: syncActive.localStatusAfter,
    shopifyStatus: syncActive.shopifyStatus,
  });

  const cronActive = await processDueSubscriptionBillings(SHOP);
  logStep("Test 1 — cron summary", cronActive);

  // Test 2 — pause
  const pauseResult = await pauseSubscriptionContractOnShopify(admin, contractId);
  logStep("Test 2 — Shopify pause mutation", pauseResult);

  await new Promise((r) => setTimeout(r, 2000));

  const syncPaused = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "webhook",
    subscriptionContractId: contractId,
    webhookTopic: "subscription_contracts/pause",
  });
  logStep("Test 2 — sync after pause", syncPaused);

  const cronPaused = await processDueSubscriptionBillings(SHOP);
  logStep("Test 2 — cron after pause", cronPaused);
  logStep("Test 2 — local after pause", await snapshotSelection(contractId));

  // Test 3 — resume
  const activate = await activateSubscriptionContractWithVerification(admin, contractId, {
    selectionId: "dev-test",
  });
  logStep("Test 3 — Shopify activate", activate);

  const syncResumed = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "webhook",
    subscriptionContractId: contractId,
    webhookTopic: "subscription_contracts/activate",
  });
  logStep("Test 3 — sync after activate", syncResumed);
  logStep("Test 3 — local after resume", await snapshotSelection(contractId));

  // Test 4 — cancel
  const cancelResult = await cancelOnShopify(admin, contractId);
  logStep("Test 4 — Shopify cancel", cancelResult);

  const syncCancelled = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "webhook",
    subscriptionContractId: contractId,
    webhookTopic: "subscription_contracts/cancel",
  });
  logStep("Test 4 — sync after cancel", syncCancelled);

  const cronCancelled = await processDueSubscriptionBillings(SHOP);
  logStep("Test 4 — cron after cancel", cronCancelled);

  const afterCancel = await snapshotSelection(contractId);
  logStep("Test 4 — local after cancel", afterCancel);

  const selection = await findSubscriptionMealSelectionByContractId({
    shop: SHOP,
    subscriptionContractId: contractId,
  });

  if (selection) {
    logStep("Test 4 — backend action guards", {
      changeBox: assertSubscriptionContractActionAllowed(selection),
      meals: assertSubscriptionContractActionAllowed(selection),
      pause: assertSubscriptionContractActionAllowed(selection),
      resume: assertSubscriptionContractActionAllowed(selection),
    });
  }

  // Test 5 — stale activate webhook should NOT reactivate
  const staleActivateSync = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "webhook",
    subscriptionContractId: contractId,
    webhookTopic: "subscription_contracts/activate",
  });
  logStep("Test 5 — stale activate after cancel", staleActivateSync);
  logStep("Test 5 — local unchanged check", await snapshotSelection(contractId));

  // Test 5b — idempotent repeat
  const repeatSync = await syncSubscriptionContractState({
    admin,
    shop: SHOP,
    source: "webhook",
    subscriptionContractId: contractId,
    webhookTopic: "subscription_contracts/cancel",
  });
  logStep("Test 5 — repeated cancel sync", repeatSync);

  // Reference contract untouched
  const reference = await snapshotSelection(REFERENCE_CONTRACT_ID);
  logStep("REFERENCE contract untouched", reference);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
