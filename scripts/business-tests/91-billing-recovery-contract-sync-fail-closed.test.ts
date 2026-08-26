/**
 * Business regression — PROD-HARDENING-2A fail-closed recovery retries.
 *
 * Source-based guards: processDueRecoveryRetries must sync Shopify before
 * triggerSubscriptionBillingAttempt, block terminals / unreliable sync, and
 * still allow legitimate PAUSED dunning (no getSelectionSkipReason reuse).
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
  const ctx = createBusinessTestContext(
    "91-billing-recovery-contract-sync-fail-closed",
  );

  const recoverySource = readRepoFile(
    "app/services/subscriptionPaymentRecovery.server.ts",
  );
  const processDueSource = recoverySource.slice(
    recoverySource.indexOf("export const processDueRecoveryRetries"),
  );
  const syncCallIndex = processDueSource.indexOf(
    "syncSubscriptionContractState({",
  );
  const billingAttemptIndex = processDueSource.indexOf(
    "triggerSubscriptionBillingAttempt({",
  );
  const retryStartingIndex = processDueSource.indexOf(
    "[paymentRecovery] retry starting",
  );
  const syncErrorGateIndex = processDueSource.indexOf(
    'syncResult.action === "error"',
  );
  const unsupportedGateIndex = processDueSource.indexOf(
    'unsupported_shopify_status',
  );
  const postSyncTerminalIndex = processDueSource.indexOf(
    'source: "post_sync"',
  );
  const contractSyncErrorSkipIndex = processDueSource.indexOf(
    "summary.skipReasons.contract_sync_error += 1",
  );
  const boxChangeIndex = processDueSource.indexOf(
    "applyPendingSubscriptionBoxChangeForBilling",
  );
  const syncToBilling = processDueSource.slice(
    syncCallIndex,
    billingAttemptIndex,
  );
  const mealSelectionConstants = readRepoFile(
    "app/constants/subscriptionMealSelection.ts",
  );

  ctx.scenario("A. Recovery due + sync before billing (ACTIVE path reachable)");
  ctx.assertTrue(
    "processDueRecoveryRetries imports / calls syncSubscriptionContractState",
    recoverySource.includes('from "./subscriptionContractSync.server"') &&
      syncCallIndex >= 0,
  );
  ctx.assertTrue(
    "sync sits before retry starting log and billing attempt",
    syncCallIndex >= 0 &&
      syncCallIndex < retryStartingIndex &&
      syncCallIndex < billingAttemptIndex,
  );
  ctx.assertTrue(
    "billing attempt remains reachable after successful sync path",
    billingAttemptIndex > syncCallIndex &&
      syncToBilling.includes("billableSelection"),
  );

  ctx.scenario("B–D. Terminal Shopify statuses block new recovery charges");
  ctx.assertTrue(
    "post-sync terminal gate uses isTerminalSubscriptionSelectionStatus",
    postSyncTerminalIndex > syncCallIndex &&
      processDueSource.includes(
        "isTerminalSubscriptionSelectionStatus(billableSelection.status)",
      ),
  );
  ctx.assertTrue(
    "post-sync terminal increments terminal_contract and continues",
    postSyncTerminalIndex < billingAttemptIndex &&
      syncToBilling.includes("summary.skipReasons.terminal_contract += 1") &&
      syncToBilling.includes("continue"),
  );
  ctx.assertTrue(
    "CANCELLED/EXPIRED/FAILED are terminal selection statuses",
    recoverySource.includes("isTerminalSubscriptionSelectionStatus") &&
      mealSelectionConstants.includes("EXPIRED") &&
      mealSelectionConstants.includes("FAILED") &&
      mealSelectionConstants.includes("CANCELLED"),
  );

  ctx.scenario("E. Sync error — fail-closed, no billing, no failureCount bump");
  ctx.assertTrue(
    "recovery gates on syncResult.action === error",
    syncErrorGateIndex >= 0 && syncErrorGateIndex < billingAttemptIndex,
  );
  ctx.assertTrue(
    "contract_sync_error skip reason is counted",
    contractSyncErrorSkipIndex > syncErrorGateIndex &&
      contractSyncErrorSkipIndex < billingAttemptIndex,
  );
  ctx.assertTrue(
    "sync-error path continues before retry starting / billing",
    syncToBilling.includes("continue") &&
      processDueSource.includes(
        "recovery retry blocked — contract sync failed",
      ),
  );
  ctx.assertTrue(
    "RecoverySkipReason includes contract_sync_error",
    recoverySource.includes('"contract_sync_error"') &&
      recoverySource.includes("RecoverySkipReason"),
  );

  ctx.scenario("F. Unsupported Shopify status — same fail-closed");
  ctx.assertTrue(
    "unsupported_shopify_status treated as unreliable sync",
    unsupportedGateIndex >= 0 &&
      Math.abs(unsupportedGateIndex - syncErrorGateIndex) < 400,
  );
  ctx.assertTrue(
    "unsupported status maps to contract_sync_error (not a separate skip key)",
    !recoverySource.includes("unsupported_shopify_status_skip") &&
      processDueSource.includes("contract_sync_error"),
  );

  ctx.scenario("G. PAUSED dunning preserved — no getSelectionSkipReason");
  ctx.assertTrue(
    "recovery path does not invoke getSelectionSkipReason(",
    !processDueSource.includes("getSelectionSkipReason("),
  );
  ctx.assertTrue(
    "post-sync→billing slice does not require status === active",
    !syncToBilling.includes('status !== "active"') &&
      !syncToBilling.includes('status === "active"'),
  );
  ctx.assertTrue(
    "comment documents PAUSED must still allow dunning retries",
    processDueSource.includes("PAUSED must still allow dunning retries"),
  );

  ctx.scenario("H. BOX-CHANGE remains isolated from recovery retries");
  ctx.assertTrue(
    "processDueRecoveryRetries never applies pending BOX-CHANGE",
    boxChangeIndex < 0,
  );
  ctx.assertTrue(
    "recovery file does not import subscriptionBoxChange apply helper",
    !recoverySource.includes("applyPendingSubscriptionBoxChangeForBilling"),
  );

  return finishSuite("91-billing-recovery-contract-sync-fail-closed", ctx);
};

process.exitCode = runSuite();
