import type { SubscriptionBillingCycleClaim } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
  BILLING_CYCLE_CLAIM_SOURCE,
  BILLING_CYCLE_CLAIM_STATUS,
  type BillingCycleClaimSource,
  type BillingCycleClaimStatus,
} from "../constants/subscriptionBillingCycleClaim";
import db from "../db.server";
import {
  buildAutoBillingIdempotencyKeyFromShopifyCycle,
  buildBillingCycleKeyFromShopifyCycle,
  buildRecoveryBillingIdempotencyKey,
} from "../utils/subscriptionBillingCycleKeys";

export type BillingCycleClaimRow = SubscriptionBillingCycleClaim;

export type ClaimBillingCycleResult =
  | {
      action: "proceed";
      claim: BillingCycleClaimRow;
      isNew: boolean;
    }
  | {
      action: "block_succeeded";
      claim: BillingCycleClaimRow;
    }
  | {
      action: "block_uncertain";
      claim: BillingCycleClaimRow;
    }
  | {
      action: "reconcile_in_flight";
      claim: BillingCycleClaimRow;
    };

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

export const buildStableBillingCycleKey = (
  selectionId: string,
  shopifyCycleIndex: number,
) => buildBillingCycleKeyFromShopifyCycle(selectionId, shopifyCycleIndex);

/**
 * Insert-or-load durable reservation for Shopify cycleIndex BEFORE create.
 */
export const claimOrLoadBillingCycle = async ({
  selectionId,
  shop,
  shopifyCycleIndex,
  source,
  subscriptionContractId,
}: {
  selectionId: string;
  shop: string;
  shopifyCycleIndex: number;
  source: BillingCycleClaimSource;
  subscriptionContractId: string | null;
}): Promise<ClaimBillingCycleResult> => {
  const billingCycleKey = buildStableBillingCycleKey(
    selectionId,
    shopifyCycleIndex,
  );
  const idempotencyKey = buildAutoBillingIdempotencyKeyFromShopifyCycle(
    selectionId,
    shopifyCycleIndex,
  );

  try {
    const created = await db.subscriptionBillingCycleClaim.create({
      data: {
        billingCycleKey,
        idempotencyKey,
        shop,
        source,
        status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
        subscriptionContractId,
        subscriptionMealSelectionId: selectionId,
      },
    });

    return { action: "proceed", claim: created, isNew: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const existing = await db.subscriptionBillingCycleClaim.findUnique({
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selectionId,
      },
    },
  });

  if (!existing) {
    throw new Error(
      `Billing cycle claim unique conflict but row missing for ${billingCycleKey}`,
    );
  }

  if (existing.status === BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED) {
    return { action: "block_succeeded", claim: existing };
  }

  if (existing.status === BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN) {
    return { action: "block_uncertain", claim: existing };
  }

  if (
    existing.status === BILLING_CYCLE_CLAIM_STATUS.CLAIMED ||
    existing.status === BILLING_CYCLE_CLAIM_STATUS.SUBMITTED
  ) {
    return { action: "reconcile_in_flight", claim: existing };
  }

  return { action: "proceed", claim: existing, isNew: false };
};

export const markBillingCycleClaimSubmitted = async ({
  billingAttemptId,
  claimId,
}: {
  billingAttemptId: string | null;
  claimId: string;
}) =>
  db.subscriptionBillingCycleClaim.update({
    data: {
      billingAttemptId,
      lastReconciledAt: new Date(),
      status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
    },
    where: { id: claimId },
  });

export const markBillingCycleClaimSucceeded = async ({
  billingAttemptId,
  claimId,
  shopifyOrderId,
}: {
  billingAttemptId: string | null;
  claimId: string;
  shopifyOrderId: string | null;
}) =>
  db.subscriptionBillingCycleClaim.update({
    data: {
      billingAttemptId,
      lastReconciledAt: new Date(),
      shopifyOrderId,
      status: BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED,
      succeededAt: new Date(),
    },
    where: { id: claimId },
  });

export const markBillingCycleClaimFailed = async ({
  claimId,
  errorMessage,
}: {
  claimId: string;
  errorMessage: string | null;
}) =>
  db.subscriptionBillingCycleClaim.update({
    data: {
      lastErrorMessage: errorMessage,
      lastReconciledAt: new Date(),
      status: BILLING_CYCLE_CLAIM_STATUS.FAILED,
    },
    where: { id: claimId },
  });

export const markBillingCycleClaimUncertain = async ({
  billingAttemptId,
  claimId,
  errorMessage,
}: {
  billingAttemptId?: string | null;
  claimId: string;
  errorMessage: string | null;
}) =>
  db.subscriptionBillingCycleClaim.update({
    data: {
      ...(billingAttemptId ? { billingAttemptId } : {}),
      lastErrorMessage: errorMessage,
      lastReconciledAt: new Date(),
      status: BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
    },
    where: { id: claimId },
  });

export const rotateClaimIdempotencyKeyAfterConfirmedFailure = async ({
  attemptNumber,
  claimId,
  selectionId,
}: {
  attemptNumber: number;
  claimId: string;
  selectionId: string;
}): Promise<BillingCycleClaimRow> => {
  const existing = await db.subscriptionBillingCycleClaim.findUniqueOrThrow({
    where: { id: claimId },
  });

  if (existing.status !== BILLING_CYCLE_CLAIM_STATUS.FAILED) {
    throw new Error(
      `Cannot rotate billing claim idempotency key from status=${existing.status}`,
    );
  }

  if (existing.subscriptionMealSelectionId !== selectionId) {
    throw new Error("Claim selection mismatch during idempotency rotation.");
  }

  const nextKey = buildRecoveryBillingIdempotencyKey(
    selectionId,
    existing.billingCycleKey,
    attemptNumber,
  );

  return db.subscriptionBillingCycleClaim.update({
    data: {
      idempotencyKey: nextKey,
      lastErrorMessage: null,
      lastReconciledAt: new Date(),
      source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
      status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
    },
    where: { id: claimId },
  });
};

export const findBillingCycleClaimByShopifyCycle = async (
  selectionId: string,
  shopifyCycleIndex: number,
) => {
  const billingCycleKey = buildStableBillingCycleKey(
    selectionId,
    shopifyCycleIndex,
  );

  return db.subscriptionBillingCycleClaim.findUnique({
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selectionId,
      },
    },
  });
};

/** @deprecated use findBillingCycleClaimByShopifyCycle */
export const findBillingCycleClaim = async (
  selectionId: string,
  dueBillingDate: Date,
) => {
  void dueBillingDate;
  return null;
};

export const findBillingCycleClaimByIdempotencyKey = async (
  idempotencyKey: string,
) =>
  db.subscriptionBillingCycleClaim.findUnique({
    where: { idempotencyKey },
  });

export const reconcileBillingCycleClaimOnWebhookSuccess = async ({
  billingAttemptId,
  idempotencyKey,
  selectionId,
  shopifyCycleIndex = null,
  shopifyOrderId,
}: {
  billingAttemptId: string | null;
  idempotencyKey: string | null;
  selectionId: string;
  shopifyCycleIndex?: number | null;
  shopifyOrderId: string | null;
}): Promise<BillingCycleClaimRow | null> => {
  let claim =
    (idempotencyKey
      ? await findBillingCycleClaimByIdempotencyKey(idempotencyKey)
      : null) ?? null;

  if (!claim && shopifyCycleIndex != null) {
    claim = await findBillingCycleClaimByShopifyCycle(
      selectionId,
      shopifyCycleIndex,
    );
  }

  if (!claim) {
    return null;
  }

  if (claim.status === BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED) {
    return claim;
  }

  return markBillingCycleClaimSucceeded({
    billingAttemptId: billingAttemptId ?? claim.billingAttemptId,
    claimId: claim.id,
    shopifyOrderId: shopifyOrderId ?? claim.shopifyOrderId,
  });
};

export const isBlockingBillingCycleClaimStatus = (
  status: string,
): status is BillingCycleClaimStatus =>
  status === BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED ||
  status === BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN ||
  status === BILLING_CYCLE_CLAIM_STATUS.CLAIMED ||
  status === BILLING_CYCLE_CLAIM_STATUS.SUBMITTED;

export { BILLING_CYCLE_CLAIM_SOURCE, BILLING_CYCLE_CLAIM_STATUS };
