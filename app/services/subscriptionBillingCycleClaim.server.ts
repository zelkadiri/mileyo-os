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

type BillingCycleClaimDelegate = {
  create: typeof db.subscriptionBillingCycleClaim.create;
  findUnique: typeof db.subscriptionBillingCycleClaim.findUnique;
  findUniqueOrThrow: typeof db.subscriptionBillingCycleClaim.findUniqueOrThrow;
  update: typeof db.subscriptionBillingCycleClaim.update;
  updateMany: typeof db.subscriptionBillingCycleClaim.updateMany;
};

let claimDelegateOverride: BillingCycleClaimDelegate | null = null;

const billingCycleClaims = () =>
  claimDelegateOverride ?? db.subscriptionBillingCycleClaim;

/** Test-only seam. Production uses the Prisma delegate. */
export const __setBillingCycleClaimDelegateForTests = (
  delegate: BillingCycleClaimDelegate | null,
) => {
  claimDelegateOverride = delegate;
};

const attemptIdsConflict = (
  storedAttemptId: string | null,
  incomingAttemptId: string | null,
) =>
  Boolean(storedAttemptId) &&
  Boolean(incomingAttemptId) &&
  storedAttemptId !== incomingAttemptId;

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
    const created = await billingCycleClaims().create({
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

  const existing = await billingCycleClaims().findUnique({
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
  billingCycleClaims().update({
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
  billingCycleClaims().update({
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
  billingAttemptId,
  claimId,
  errorMessage,
  expectedBillingAttemptId,
  expectedStatus,
  matchExpectedBillingAttemptId = false,
}: {
  billingAttemptId?: string | null;
  claimId: string;
  errorMessage: string | null;
  /**
   * CAS: stored attempt id that must still be on the row.
   * `null` matches a claim that has not recorded an attempt yet.
   */
  expectedBillingAttemptId?: string | null;
  /** CAS: status observed before this write. */
  expectedStatus?: BillingCycleClaimStatus;
  /** Apply expectedBillingAttemptId even when it is null. */
  matchExpectedBillingAttemptId?: boolean;
}): Promise<BillingCycleClaimRow> => {
  const where: Prisma.SubscriptionBillingCycleClaimWhereInput = {
    id: claimId,
  };

  if (expectedStatus) {
    where.status = expectedStatus;
  } else if (billingAttemptId) {
    // A newer SUBMITTED attempt id must not be overwritten by an older failure.
    // SUCCEEDED is absent — a paid claim cannot be reopened.
    where.OR = [
      { status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED },
      { status: BILLING_CYCLE_CLAIM_STATUS.FAILED },
      {
        status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        OR: [{ billingAttemptId }, { billingAttemptId: null }],
      },
      {
        status: BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN,
        billingAttemptId,
      },
    ];
  } else {
    where.OR = [
      { status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED },
      { status: BILLING_CYCLE_CLAIM_STATUS.FAILED },
      {
        status: BILLING_CYCLE_CLAIM_STATUS.SUBMITTED,
        billingAttemptId: null,
      },
    ];
  }

  if (matchExpectedBillingAttemptId) {
    where.billingAttemptId = expectedBillingAttemptId ?? null;
  }

  const updated = await billingCycleClaims().updateMany({
    data: {
      ...(billingAttemptId ? { billingAttemptId } : {}),
      lastErrorMessage: errorMessage,
      lastReconciledAt: new Date(),
      status: BILLING_CYCLE_CLAIM_STATUS.FAILED,
    },
    where,
  });

  const current = await billingCycleClaims().findUnique({
    where: { id: claimId },
  });

  if (!current) {
    throw new Error(
      `Billing cycle claim missing after failure transition (${claimId})`,
    );
  }

  if (updated.count === 0) {
    console.log("[BILLING] claim failure transition skipped", {
      billingAttemptId: billingAttemptId ?? null,
      claimId,
      status: current.status,
      storedAttemptId: current.billingAttemptId,
    });
  }

  return current;
};

/**
 * Idempotent: after a Shopify billing attempt is confirmed FAILED (error present,
 * no paid order), converge the cycle claim to failed so recovery can rotate keys.
 * Never downgrades succeeded. Never marks failed while claim is uncertain unless
 * the same billingAttemptId is confirmed failed.
 * A failure for an older attempt never unlocks a newer SUBMITTED / CLAIMED attempt.
 */
export const reconcileBillingCycleClaimOnConfirmedFailure = async ({
  billingAttemptId,
  billingCycleKey,
  errorMessage,
  selectionId,
}: {
  billingAttemptId: string | null;
  billingCycleKey: string;
  errorMessage: string | null;
  selectionId: string;
}): Promise<BillingCycleClaimRow | null> => {
  const claim = await billingCycleClaims().findUnique({
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selectionId,
      },
    },
  });

  if (!claim) {
    return null;
  }

  if (claim.status === BILLING_CYCLE_CLAIM_STATUS.SUCCEEDED) {
    return claim;
  }

  if (claim.status === BILLING_CYCLE_CLAIM_STATUS.UNCERTAIN) {
    const sameAttempt =
      Boolean(billingAttemptId) &&
      claim.billingAttemptId === billingAttemptId;
    if (!sameAttempt) {
      return claim;
    }
  }

  // Rotation leaves the previous attempt id on a CLAIMED row. A replay of that
  // older failure must not move the claim back to FAILED while the new attempt
  // is still pending or unknown.
  if (
    claim.status === BILLING_CYCLE_CLAIM_STATUS.CLAIMED &&
    claim.billingAttemptId
  ) {
    return claim;
  }

  if (
    (claim.status === BILLING_CYCLE_CLAIM_STATUS.SUBMITTED ||
      claim.status === BILLING_CYCLE_CLAIM_STATUS.CLAIMED) &&
    attemptIdsConflict(claim.billingAttemptId, billingAttemptId)
  ) {
    return claim;
  }

  if (claim.status === BILLING_CYCLE_CLAIM_STATUS.FAILED) {
    if (attemptIdsConflict(claim.billingAttemptId, billingAttemptId)) {
      return claim;
    }

    const needsAttemptStamp =
      Boolean(billingAttemptId) &&
      claim.billingAttemptId !== billingAttemptId;
    const needsErrorStamp =
      errorMessage != null && claim.lastErrorMessage !== errorMessage;

    if (!needsAttemptStamp && !needsErrorStamp) {
      return claim;
    }

    return markBillingCycleClaimFailed({
      billingAttemptId,
      claimId: claim.id,
      errorMessage: errorMessage ?? claim.lastErrorMessage,
      expectedBillingAttemptId: claim.billingAttemptId,
      expectedStatus: claim.status as BillingCycleClaimStatus,
      matchExpectedBillingAttemptId: true,
    });
  }

  if (
    claim.status !== BILLING_CYCLE_CLAIM_STATUS.CLAIMED &&
    claim.status !== BILLING_CYCLE_CLAIM_STATUS.SUBMITTED
  ) {
    return claim;
  }

  return markBillingCycleClaimFailed({
    billingAttemptId: billingAttemptId ?? claim.billingAttemptId,
    claimId: claim.id,
    errorMessage,
    expectedBillingAttemptId: claim.billingAttemptId,
    expectedStatus: claim.status as BillingCycleClaimStatus,
    matchExpectedBillingAttemptId: true,
  });
};

export const markBillingCycleClaimUncertain = async ({
  billingAttemptId,
  claimId,
  errorMessage,
}: {
  billingAttemptId?: string | null;
  claimId: string;
  errorMessage: string | null;
}) =>
  billingCycleClaims().update({
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
  const existing = await billingCycleClaims().findUniqueOrThrow({
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

  const rotated = await billingCycleClaims().updateMany({
    data: {
      idempotencyKey: nextKey,
      lastErrorMessage: null,
      lastReconciledAt: new Date(),
      source: BILLING_CYCLE_CLAIM_SOURCE.RECOVERY,
      status: BILLING_CYCLE_CLAIM_STATUS.CLAIMED,
    },
    where: {
      id: claimId,
      status: BILLING_CYCLE_CLAIM_STATUS.FAILED,
      subscriptionMealSelectionId: selectionId,
    },
  });

  if (rotated.count !== 1) {
    throw new Error(
      `Cannot rotate billing claim idempotency key from status=${existing.status}`,
    );
  }

  return billingCycleClaims().findUniqueOrThrow({
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

  return billingCycleClaims().findUnique({
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
  billingCycleClaims().findUnique({
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
