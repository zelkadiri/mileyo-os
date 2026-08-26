/**
 * Business regression — PROD-HARDENING-1 fail-closed billing on contract sync.
 *
 * Source-based guards for cron + admin: sync error / unsupported Shopify status
 * must never reach BOX-CHANGE apply or subscriptionBillingAttemptCreate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBusinessTestContext,
  finishSuite,
} from "./_framework";

const readRepoFile = (relativePath: string) =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../..", relativePath),
    "utf8",
  );

const runSuite = () => {
  const ctx = createBusinessTestContext("90-billing-contract-sync-fail-closed");

  const workerSource = readRepoFile(
    "app/services/subscriptionBillingWorker.server.ts",
  );
  const adminSource = readRepoFile(
    "app/features/subscriptions/subscriptions-actions.server.ts",
  );
  const processDueSource = workerSource.slice(
    workerSource.indexOf("export const processDueSubscriptionBillings"),
  );
  const adminBillingSource = adminSource.slice(
    adminSource.indexOf('intent === "triggerShopifyBillingAttempt"'),
  );

  const syncCallIndex = processDueSource.indexOf(
    "syncSubscriptionContractState({",
  );
  const errorGateIndex = processDueSource.indexOf(
    'syncResult.action === "error"',
  );
  const unsupportedGateIndex = processDueSource.indexOf(
    'unsupported_shopify_status',
  );
  const contractSyncFailedContinueIndex = processDueSource.indexOf(
    "if (contractSyncFailed)",
  );
  const skipReasonIncrementIndex = processDueSource.indexOf(
    "summary.skipReasons.contract_sync_error += 1",
  );
  const applyIndex = processDueSource.indexOf(
    "applyPendingSubscriptionBoxChangeForBilling({",
  );
  const billingAttemptIndex = processDueSource.indexOf(
    "triggerSubscriptionBillingAttempt({",
  );

  ctx.scenario("A. Cron — sync error fail-closed before BOX-CHANGE / billing");
  ctx.assertTrue(
    "processDueSubscriptionBillings calls syncSubscriptionContractState",
    syncCallIndex >= 0,
  );
  ctx.assertTrue(
    "cron gates on syncResult.action === error",
    errorGateIndex >= 0,
  );
  ctx.assertTrue(
    "cron increments contract_sync_error skip reason",
    skipReasonIncrementIndex >= 0 &&
      processDueSource.includes("contract_sync_error"),
  );
  ctx.assertTrue(
    "contractSyncFailed continue sits after sync call",
    syncCallIndex < contractSyncFailedContinueIndex,
  );
  ctx.assertTrue(
    "error gate sits before contractSyncFailed continue",
    errorGateIndex < contractSyncFailedContinueIndex,
  );
  ctx.assertTrue(
    "contract_sync_error increment sits inside / with fail-closed continue",
    contractSyncFailedContinueIndex >= 0 &&
      skipReasonIncrementIndex > contractSyncFailedContinueIndex &&
      skipReasonIncrementIndex < applyIndex,
  );
  ctx.assertTrue(
    "BOX-CHANGE apply sits after sync fail-closed continue",
    contractSyncFailedContinueIndex < applyIndex,
  );
  ctx.assertTrue(
    "billing attempt sits after BOX-CHANGE apply",
    applyIndex < billingAttemptIndex,
  );
  ctx.assertTrue(
    "billing attempt sits after sync fail-closed continue",
    contractSyncFailedContinueIndex < billingAttemptIndex,
  );
  ctx.assertTrue(
    "skip path uses continue after contract_sync_error",
    processDueSource
      .slice(contractSyncFailedContinueIndex, applyIndex)
      .includes("continue"),
  );

  ctx.scenario(
    "B. Cron — unsupported Shopify status treated as unreliable sync",
  );
  ctx.assertTrue(
    "cron gates unsupported_shopify_status",
    unsupportedGateIndex >= 0,
  );
  ctx.assertTrue(
    "unsupported status gate is near error gate (same fail-closed block)",
    Math.abs(unsupportedGateIndex - errorGateIndex) < 400,
  );
  ctx.assertTrue(
    "unsupported status still maps to contract_sync_error (no new skip reason)",
    !workerSource.includes("unsupported_shopify_status_skip") &&
      processDueSource.includes("contract_sync_error"),
  );
  ctx.assertTrue(
    "cron does not treat every skipped action as fail-closed blindly",
    processDueSource.includes('reason === "unsupported_shopify_status"') &&
      !/syncResult\.action === ["']skipped["']\s*\)/.test(
        processDueSource.slice(errorGateIndex, contractSyncFailedContinueIndex),
      ),
  );

  ctx.scenario("C. Admin manual billing — same sync fail-closed principle");
  ctx.assertTrue(
    "admin billing syncs contract before attempt",
    adminBillingSource.includes("syncSubscriptionContractState({"),
  );
  ctx.assertTrue(
    "admin blocks unreliable sync via shared helper",
    adminSource.includes("isUnreliableContractSyncResult") &&
      adminBillingSource.includes("isUnreliableContractSyncResult(syncResult)"),
  );
  ctx.assertTrue(
    "admin helper treats error and unsupported_shopify_status as unreliable",
    adminSource.includes('syncResult.action === "error"') &&
      adminSource.includes('reason === "unsupported_shopify_status"'),
  );
  ctx.assertTrue(
    "admin sync is wrapped so throw refuses billing",
    adminBillingSource.includes("try {") &&
      adminBillingSource.includes("syncSubscriptionContractState({") &&
      adminBillingSource.includes("ADMIN_BILLING_CONTRACT_SYNC_FAILED_MESSAGE"),
  );
  const adminSyncIndex = adminBillingSource.indexOf(
    "syncSubscriptionContractState({",
  );
  const adminFailClosedIndex = Math.min(
    ...[
      adminBillingSource.indexOf("isUnreliableContractSyncResult"),
      adminBillingSource.indexOf("ADMIN_BILLING_CONTRACT_SYNC_FAILED_MESSAGE"),
    ].filter((index) => index >= 0),
  );
  const adminBillingAttemptIndex = adminBillingSource.indexOf(
    "triggerSubscriptionBillingAttempt({",
  );
  ctx.assertTrue(
    "admin fail-closed sits after sync and before billing attempt",
    adminSyncIndex >= 0 &&
      adminFailClosedIndex > adminSyncIndex &&
      adminBillingAttemptIndex > adminFailClosedIndex,
  );

  return finishSuite("90-billing-contract-sync-fail-closed", ctx);
};

process.exitCode = runSuite();
