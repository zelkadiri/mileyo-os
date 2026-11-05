/**
 * Shared pre-charge gate: first-checkout NBD guard → resolve Shopify cycleIndex
 * (identify + charge window) → claim UNIQUE → proceed.
 * Used by cron, admin, recovery, and portal resume.
 */
import db from "../db.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { evaluateFirstCheckoutDeliveryBillingGuard } from "../utils/subscriptionBillingSchedule";
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

export type CanonicalBillingBlockCode =
  | "first_checkout_delivery_unaligned"
  | "missing_first_checkout_delivery_proof"
  | "shopify_charge_window_closed"
  | "cycle_unresolvable"
  | "cycle_ambiguous"
  | "claim_uncertain"
  | "claim_in_flight";

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
      blockCode?: CanonicalBillingBlockCode;
      claimAction?: ClaimBillingCycleResult["action"];
      claim?: BillingCycleClaimRow;
    };

const loadFirstCheckoutDeliveryDate = async ({
  checkoutShopifyOrderId,
  shop,
}: {
  checkoutShopifyOrderId: string;
  shop: string;
}): Promise<string | null> => {
  const normalized =
    normalizeShopifyId(checkoutShopifyOrderId) ?? checkoutShopifyOrderId;
  const orderIdCandidates = Array.from(
    new Set([
      checkoutShopifyOrderId,
      normalized,
      `gid://shopify/Order/${normalized}`,
    ]),
  );

  const firstCheckoutBox = await db.boxOrder.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      scheduledDeliveryDate: true,
      shopifyOrderId: true,
    },
    where: {
      cancelledAt: null,
      isSubscriptionRenewal: false,
      shop,
      shopifyOrderId: { in: orderIdCandidates },
      simulated: false,
    },
  });

  return firstCheckoutBox?.scheduledDeliveryDate ?? null;
};

/**
 * Fail-closed preparation before any Shopify createBillingAttempt.
 * P0-1 and P0-2 run before claimOrLoadBillingCycle (no claim write on block).
 */
export const prepareCanonicalCycleBilling = async ({
  admin,
  checkoutShopifyOrderId,
  nextBillingDate,
  now = new Date(),
  selectionId,
  shop,
  source,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  /** selection.shopifyOrderId — paid first checkout order (not a renewal). */
  checkoutShopifyOrderId: string | null | undefined;
  nextBillingDate: Date;
  now?: Date;
  selectionId: string;
  shop: string;
  source: BillingCycleClaimSource;
  subscriptionContractId: string;
}): Promise<CanonicalBillingPrepareResult> => {
  if (!checkoutShopifyOrderId) {
    return {
      action: "block",
      blockCode: "missing_first_checkout_delivery_proof",
      reason:
        "shopifyOrderId de sélection manquant — preuve 1er checkout indisponible, facturation bloquée.",
      shopifyCycleIndex: null,
    };
  }

  const firstCheckoutDeliveryDate = await loadFirstCheckoutDeliveryDate({
    checkoutShopifyOrderId,
    shop,
  });

  if (!firstCheckoutDeliveryDate) {
    return {
      action: "block",
      blockCode: "missing_first_checkout_delivery_proof",
      reason:
        "BoxOrder 1er checkout (isSubscriptionRenewal=false, non simulé) introuvable ou sans scheduledDeliveryDate — réconciliation requise.",
      shopifyCycleIndex: null,
    };
  }

  const firstDeliveryGuard = evaluateFirstCheckoutDeliveryBillingGuard({
    firstCheckoutScheduledDeliveryDate: firstCheckoutDeliveryDate,
    nextBillingDate,
  });

  if (!firstDeliveryGuard.ok) {
    return {
      action: "block",
      blockCode: "first_checkout_delivery_unaligned",
      reason: firstDeliveryGuard.reason,
      shopifyCycleIndex: null,
    };
  }

  const resolved: ResolveBillableShopifyCycleResult =
    await resolveBillableShopifyCycle({
      admin,
      nextBillingDate,
      now,
      subscriptionContractId,
    });

  if (resolved.action === "block_unresolvable") {
    return {
      action: "block",
      blockCode: "cycle_unresolvable",
      reason: resolved.reason,
      shopifyCycleIndex: null,
    };
  }

  if (resolved.action === "block_ambiguous") {
    return {
      action: "block",
      blockCode: "cycle_ambiguous",
      reason: resolved.reason,
      shopifyCycleIndex: resolved.shopifyCycleIndex,
    };
  }

  if (resolved.action === "block_too_early") {
    return {
      action: "block",
      blockCode: "shopify_charge_window_closed",
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
      blockCode: "claim_uncertain",
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
      blockCode: "claim_in_flight",
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
