/**
 * Shared pre-charge gate: resolve Shopify cycleIndex → claim UNIQUE → proceed.
 * Used by cron, admin, recovery, and portal resume.
 */
import {
  BILLING_CYCLE_CLAIM_SOURCE,
  claimOrLoadBillingCycle,
  type BillingCycleClaimRow,
  type ClaimBillingCycleResult,
} from "./subscriptionBillingCycleClaim.server";
import {
  resolveBillableShopifyCycle,
  type ResolveBillableShopifyCycleResult,
  type ShopifyBillingCycleSnapshot,
} from "./shopifySubscriptionBillingCycle.server";
import type { BillingCycleClaimSource } from "../constants/subscriptionBillingCycleClaim";

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CanonicalBillingPrepareResult =
  | {
      action: "proceed";
      claim: BillingCycleClaimRow;
      claimResult: ClaimBillingCycleResult & { action: "proceed" };
      cycle: ShopifyBillingCycleSnapshot;
      shopifyCycleIndex: number;
    }
  | {
      action: "already_paid";
      cycle: ShopifyBillingCycleSnapshot;
      shopifyCycleIndex: number;
      reason: string;
      claim: BillingCycleClaimRow | null;
    }
  | {
      action: "block";
      reason: string;
      shopifyCycleIndex: number | null;
      claimAction?: ClaimBillingCycleResult["action"];
      claim?: BillingCycleClaimRow;
    };

/**
 * Fail-closed preparation before any Shopify createBillingAttempt.
 */
export const prepareCanonicalCycleBilling = async ({
  admin,
  nextBillingDate,
  selectionId,
  shop,
  source,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  nextBillingDate: Date;
  selectionId: string;
  shop: string;
  source: BillingCycleClaimSource;
  subscriptionContractId: string;
}): Promise<CanonicalBillingPrepareResult> => {
  const resolved: ResolveBillableShopifyCycleResult =
    await resolveBillableShopifyCycle({
      admin,
      nextBillingDate,
      subscriptionContractId,
    });

  if (resolved.action === "block_unresolvable") {
    return {
      action: "block",
      reason: resolved.reason,
      shopifyCycleIndex: null,
    };
  }

  if (resolved.action === "block_ambiguous") {
    return {
      action: "block",
      reason: resolved.reason,
      shopifyCycleIndex: resolved.shopifyCycleIndex,
    };
  }

  const shopifyCycleIndex = resolved.shopifyCycleIndex;
  const cycle = resolved.cycle;

  const claimResult = await claimOrLoadBillingCycle({
    selectionId,
    shop,
    shopifyCycleIndex,
    source,
    subscriptionContractId,
  });

  if (resolved.action === "already_paid") {
    // Ensure local claim converges to succeeded when Shopify already collected.
    if (claimResult.action === "proceed" || claimResult.action === "block_succeeded") {
      return {
        action: "already_paid",
        claim: claimResult.claim,
        cycle,
        reason: resolved.reason,
        shopifyCycleIndex,
      };
    }
    return {
      action: "already_paid",
      claim: claimResult.claim,
      cycle,
      reason: resolved.reason,
      shopifyCycleIndex,
    };
  }

  if (claimResult.action === "block_succeeded") {
    return {
      action: "already_paid",
      claim: claimResult.claim,
      cycle,
      reason: "Claim local succeeded pour ce cycleIndex Shopify.",
      shopifyCycleIndex,
    };
  }

  if (claimResult.action === "block_uncertain") {
    return {
      action: "block",
      claim: claimResult.claim,
      claimAction: claimResult.action,
      reason:
        "Paiement incertain pour ce cycle — réconciliation Shopify obligatoire.",
      shopifyCycleIndex,
    };
  }

  if (claimResult.action === "reconcile_in_flight") {
    return {
      action: "block",
      claim: claimResult.claim,
      claimAction: claimResult.action,
      reason:
        "Claim in-flight (claimed/submitted) — réconcilier avant nouvelle charge.",
      shopifyCycleIndex,
    };
  }

  return {
    action: "proceed",
    claim: claimResult.claim,
    claimResult,
    cycle,
    shopifyCycleIndex,
  };
};

export { BILLING_CYCLE_CLAIM_SOURCE };
