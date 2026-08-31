/**
 * SubscriptionBoxChange (BOX-CHANGE-2 / 2B / 3B / 4 / 5).
 *
 * Pending intent CRUD + current-delivery coverage + apply-before-billing.
 *
 * BOX-CHANGE-3B: pending stores future-cycle meals (`toSelectedMeals`) separately from
 * SubscriptionMealSelection (current delivery). Same Json string[] shape as selection.
 *
 * BOX-CHANGE-4: before normal billing attempt, claim pending → Shopify runtime price →
 * contract draft → selection (incl. toSelectedMeals) → mark applied. Never on recovery.
 *
 * BOX-CHANGE-5: fail-closed billing gate — stale/failed/applying/claim-lost/unexpected
 * contract never silently bill the old box. Applying rows stay visible for reconcile.
 *
 * Financial SoT at apply time: Shopify variant.price (re-fetched). No billed price stored.
 *
 * Concurrency (BOX-CHANGE-2B):
 * - request: cancel+create in a DB transaction; P2002 → re-read / retry (last write wins)
 * - status: conditional updateMany (id + expected status) — CAS, no distributed lock
 * - partial unique index on pending remains the ultimate PostgreSQL guard
 */

import type { SubscriptionBoxChange, SubscriptionMealSelection } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

import {
  APPLY_PENDING_BOX_CHANGE_OUTCOME,
  type ApplyPendingBoxChangeOutcome,
  CURRENT_DELIVERY_COVERAGE,
  type CurrentDeliveryCoverage,
  isBillingAllowedBoxChangeOutcome,
  PENDING_BILLING_DATE_MATCH,
  type PendingBillingDateMatch,
  SUBSCRIPTION_BOX_CHANGE_STATUS,
} from "../constants/subscriptionBoxChange";
import {
  ACTIVE_RECOVERY_STATUSES,
  isOpenRecoveryStatus,
} from "../constants/subscriptionPaymentRecovery";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../constants/boxOrder";
import db from "../db.server";
import { findBuilderBoxByVariantId } from "../features/builder/builder-box-selection";
import { fetchBuilderBoxOptions } from "../features/builder/builder-catalog.server";
import type { BuilderBoxOption } from "../features/builder/builder-types";
import { getPortalV2BoxTitle } from "../features/portal/portal-boxes";
import { projectActiveScheduledDeliveryDate } from "../utils/deliveryDate";
import {
  fetchSubscriptionContractCurrentVariantId,
  updateSubscriptionContractBoxViaDraft,
} from "./subscriptionContractBoxChange.server";
import {
  isInFlightBillingAttemptStatus,
} from "./subscriptionModificationBlock.server";

/** Must match `RECENT_BILLING_ATTEMPT_WINDOW_MS` in subscriptionBillingWorker.server. */
const RECENT_BILLING_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};
export type SubscriptionBoxChangeRecord = SubscriptionBoxChange;

export type RequestSubscriptionBoxChangeInput = {
  effectiveBillingDate: Date;
  fromProductVariantId: string;
  shop: string;
  subscriptionContractId: string;
  subscriptionMealSelectionId: string;
  toMealsCount: number;
  /** Future-cycle meal titles — exact count must match toMealsCount (caller validates). */
  toSelectedMeals: string[];
  toProductVariantId: string;
  toSellingPlanId?: string | null;
};

export type RequestSubscriptionBoxChangeResult = {
  change: SubscriptionBoxChangeRecord;
  /** True when an identical pending already existed (replay). */
  replayed: boolean;
  /** True when a different pending was cancelled and replaced. */
  replaced: boolean;
};

/** Result of a conditional status transition (CAS via updateMany). */
export type SubscriptionBoxChangeTransitionResult = {
  change: SubscriptionBoxChangeRecord | null;
  transitioned: boolean;
};

/** Narrow Prisma-shaped delegates (injectable for business tests). */
export type SubscriptionBoxChangeDb = {
  $transaction?: <T>(
    fn: (tx: SubscriptionBoxChangeDb) => Promise<T>,
  ) => Promise<T>;
  boxOrder: {
    findFirst: (args: {
      select?: Record<string, boolean>;
      where: Record<string, unknown>;
    }) => Promise<{
      id: string;
      scheduledDeliveryDate: string | null;
      subscriptionSelectionId: string | null;
    } | null>;
  };
    subscriptionBoxChange: {
    create: (args: {
      data: {
        effectiveBillingDate: Date;
        fromProductVariantId: string;
        shop: string;
        status: string;
        subscriptionContractId: string;
        subscriptionMealSelectionId: string;
        toMealsCount: number;
        toProductVariantId: string;
        toSelectedMeals: string[];
        toSellingPlanId?: string | null;
        requestedAt?: Date;
      };
    }) => Promise<SubscriptionBoxChangeRecord>;
    findFirst: (args: {
      orderBy?: { requestedAt: "asc" | "desc" } | { createdAt: "asc" | "desc" };
      where: Record<string, unknown>;
    }) => Promise<SubscriptionBoxChangeRecord | null>;
    findUnique: (args: {
      where: { id: string };
    }) => Promise<SubscriptionBoxChangeRecord | null>;
    update: (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => Promise<SubscriptionBoxChangeRecord>;
    updateMany: (args: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  subscriptionMealSelection?: {
    findUnique: (args: {
      where: { id: string };
    }) => Promise<SubscriptionMealSelection | null>;
    update: (args: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => Promise<SubscriptionMealSelection>;
  };
};

const REQUEST_CONFLICT_MAX_ATTEMPTS = 3;

const resolveDb = (override?: SubscriptionBoxChangeDb): SubscriptionBoxChangeDb =>
  override ?? (db as unknown as SubscriptionBoxChangeDb);

const isPrismaUniqueConstraintError = (error: unknown) =>
  error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
  error.code === "P2002";

const sameInstant = (left: Date, right: Date) =>
  left.getTime() === right.getTime();

/** Compare persisted Json meal titles with request titles (order-sensitive). */
export const sameSelectedMeals = (left: unknown, right: unknown) => {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (item, index) => String(item) === String(right[index]),
  );
};

const isSamePendingTarget = (
  existing: SubscriptionBoxChangeRecord,
  input: RequestSubscriptionBoxChangeInput,
) =>
  existing.toProductVariantId === input.toProductVariantId &&
  existing.toMealsCount === input.toMealsCount &&
  sameSelectedMeals(existing.toSelectedMeals, input.toSelectedMeals) &&
  (existing.toSellingPlanId ?? null) === (input.toSellingPlanId ?? null) &&
  sameInstant(existing.effectiveBillingDate, input.effectiveBillingDate) &&
  existing.subscriptionContractId === input.subscriptionContractId &&
  existing.fromProductVariantId === input.fromProductVariantId;

/**
 * Run cancel+create (or any multi-step write) in a real Prisma transaction when
 * available. Injectables without `$transaction` fall back to sequential calls
 * (memory tests); production always uses `db.$transaction`.
 */
const runAtomic = async <T>(
  client: SubscriptionBoxChangeDb,
  fn: (tx: SubscriptionBoxChangeDb) => Promise<T>,
): Promise<T> => {
  if (typeof client.$transaction === "function") {
    return client.$transaction(fn);
  }

  return fn(client);
};

const loadAfterConditionalUpdate = async ({
  client,
  id,
  transitioned,
}: {
  client: SubscriptionBoxChangeDb;
  id: string;
  transitioned: boolean;
}): Promise<SubscriptionBoxChangeTransitionResult> => {
  if (!transitioned) {
    return { change: null, transitioned: false };
  }

  const change = await client.subscriptionBoxChange.findUnique({ where: { id } });
  return { change, transitioned: Boolean(change) };
};

/**
 * Recovery statuses that must block box-change request / apply (BOX-CHANGE-3+).
 * Mirrors ACTIVE_RECOVERY_STATUSES — portal changeSubscriptionBox uses this SoT.
 */
export const BOX_CHANGE_BLOCKING_RECOVERY_STATUSES = ACTIVE_RECOVERY_STATUSES;

export const isRecoveryBlockingBoxChange = (status: string | null | undefined) =>
  typeof status === "string" && isOpenRecoveryStatus(status);

/**
 * Pure classifier for the portal's currently exposed delivery cycle.
 *
 * Signal priority:
 * 1. BoxOrder on effective delivery → ordered (strongest paid proof)
 * 2. Recent in-flight billing attempt → billing_in_flight
 * 3. Recent billing success without BoxOrder → ambiguous (orders/create lag)
 * 4. Unknown effective delivery → ambiguous (fail-safe)
 * 5. Else → unpaid
 */
export const classifyCurrentDeliveryCoverage = ({
  effectiveDeliveryDate,
  lastBillingAttemptAt,
  lastBillingAttemptStatus,
  matchingBoxOrder,
  now = new Date(),
}: {
  effectiveDeliveryDate: string | null;
  lastBillingAttemptAt: Date | null;
  lastBillingAttemptStatus: string | null;
  matchingBoxOrder: { id: string } | null;
  now?: Date;
}): CurrentDeliveryCoverage => {
  if (matchingBoxOrder) {
    return CURRENT_DELIVERY_COVERAGE.ORDERED;
  }

  if (!effectiveDeliveryDate) {
    return CURRENT_DELIVERY_COVERAGE.AMBIGUOUS;
  }

  const recent =
    lastBillingAttemptAt !== null &&
    now.getTime() - lastBillingAttemptAt.getTime() <
      RECENT_BILLING_ATTEMPT_WINDOW_MS;

  if (recent && lastBillingAttemptStatus) {
    if (isInFlightBillingAttemptStatus(lastBillingAttemptStatus)) {
      return CURRENT_DELIVERY_COVERAGE.BILLING_IN_FLIGHT;
    }

    if (lastBillingAttemptStatus === "success") {
      // Billing succeeded but orders/create may not have written BoxOrder yet.
      return CURRENT_DELIVERY_COVERAGE.AMBIGUOUS;
    }
  }

  return CURRENT_DELIVERY_COVERAGE.UNPAID;
};

/** True when immediate box mutation must not run (paid / in-flight / ambiguous). */
export const isCurrentDeliveryLockedForBoxChange = (
  coverage: CurrentDeliveryCoverage,
) => coverage !== CURRENT_DELIVERY_COVERAGE.UNPAID;

export const findBoxOrderForEffectiveDelivery = async ({
  db: dbOverride,
  effectiveDeliveryDate,
  selectionId,
  shop,
}: {
  db?: SubscriptionBoxChangeDb;
  effectiveDeliveryDate: string;
  selectionId: string;
  shop: string;
}) => {
  const client = resolveDb(dbOverride);

  return client.boxOrder.findFirst({
    select: {
      id: true,
      scheduledDeliveryDate: true,
      subscriptionSelectionId: true,
    },
    where: {
      scheduledDeliveryDate: effectiveDeliveryDate,
      shop,
      subscriptionSelectionId: selectionId,
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
    },
  });
};

export type ResolveCurrentDeliveryCoverageInput = {
  db?: SubscriptionBoxChangeDb;
  now?: Date;
  selection: {
    id: string;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    nextScheduledDeliveryDate?: string | null;
    preferredDeliveryWeekday?: number | null;
    shop: string;
  };
};

export type ResolveCurrentDeliveryCoverageResult = {
  coverage: CurrentDeliveryCoverage;
  effectiveDeliveryDate: string | null;
  locked: boolean;
  matchingBoxOrderId: string | null;
};

/**
 * Resolve whether the portal's current delivery is already covered by a BoxOrder
 * (or must be treated as locked during billing → orders/create lag).
 */
export const resolveCurrentDeliveryCoverage = async ({
  db: dbOverride,
  now = new Date(),
  selection,
}: ResolveCurrentDeliveryCoverageInput): Promise<ResolveCurrentDeliveryCoverageResult> => {
  const { effectiveDeliveryDate } = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate ?? null,
    now,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
  });

  let matchingBoxOrder: { id: string } | null = null;

  if (effectiveDeliveryDate) {
    matchingBoxOrder = await findBoxOrderForEffectiveDelivery({
      db: dbOverride,
      effectiveDeliveryDate,
      selectionId: selection.id,
      shop: selection.shop,
    });
  }

  const coverage = classifyCurrentDeliveryCoverage({
    effectiveDeliveryDate,
    lastBillingAttemptAt: selection.lastBillingAttemptAt,
    lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
    matchingBoxOrder,
    now,
  });

  return {
    coverage,
    effectiveDeliveryDate,
    locked: isCurrentDeliveryLockedForBoxChange(coverage),
    matchingBoxOrderId: matchingBoxOrder?.id ?? null,
  };
};

export const getPendingSubscriptionBoxChange = async ({
  db: dbOverride,
  shop,
  subscriptionMealSelectionId,
}: {
  db?: SubscriptionBoxChangeDb;
  shop?: string;
  subscriptionMealSelectionId: string;
}) => {
  const client = resolveDb(dbOverride);

  return client.subscriptionBoxChange.findFirst({
    orderBy: { requestedAt: "desc" },
    where: {
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
      subscriptionMealSelectionId,
      ...(shop ? { shop } : {}),
    },
  });
};

const cancelPendingForSelection = async ({
  client,
  now,
  subscriptionMealSelectionId,
}: {
  client: SubscriptionBoxChangeDb;
  now: Date;
  subscriptionMealSelectionId: string;
}) =>
  client.subscriptionBoxChange.updateMany({
    data: {
      cancelledAt: now,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
    },
    where: {
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
      subscriptionMealSelectionId,
    },
  });

const createPendingChange = (
  client: SubscriptionBoxChangeDb,
  input: RequestSubscriptionBoxChangeInput,
  now: Date,
) =>
  client.subscriptionBoxChange.create({
    data: {
      effectiveBillingDate: input.effectiveBillingDate,
      fromProductVariantId: input.fromProductVariantId,
      requestedAt: now,
      shop: input.shop,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
      subscriptionContractId: input.subscriptionContractId,
      subscriptionMealSelectionId: input.subscriptionMealSelectionId,
      toMealsCount: input.toMealsCount,
      toProductVariantId: input.toProductVariantId,
      toSelectedMeals: input.toSelectedMeals,
      toSellingPlanId: input.toSellingPlanId ?? null,
    },
  });

/**
 * Create or replace the single active pending box-change intent for a selection.
 *
 * Idempotence: identical toVariant + mealsCount + toSelectedMeals + sellingPlan +
 * effectiveBillingDate against an existing pending → return existing (replayed).
 * Different target (including different future meals) → cancel + create (replaced).
 *
 * Concurrent different targets (A: 8→12, B: 8→16): partial unique + P2002 retry
 * ensures one pending; last successful writer becomes the active intent.
 */
export const requestSubscriptionBoxChange = async (
  input: RequestSubscriptionBoxChangeInput,
  options?: { db?: SubscriptionBoxChangeDb; now?: Date },
): Promise<RequestSubscriptionBoxChangeResult> => {
  const client = resolveDb(options?.db);
  const now = options?.now ?? new Date();

  for (let attempt = 0; attempt < REQUEST_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
    const existing = await getPendingSubscriptionBoxChange({
      db: client,
      shop: input.shop,
      subscriptionMealSelectionId: input.subscriptionMealSelectionId,
    });

    if (existing && isSamePendingTarget(existing, input)) {
      return { change: existing, replayed: true, replaced: false };
    }

    const hadDifferentPending = Boolean(existing);

    try {
      const change = await runAtomic(client, async (tx) => {
        await cancelPendingForSelection({
          client: tx,
          now,
          subscriptionMealSelectionId: input.subscriptionMealSelectionId,
        });

        return createPendingChange(tx, input, now);
      });

      return {
        change,
        replayed: false,
        replaced: hadDifferentPending,
      };
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }

      // Race: another request holds the partial unique. Re-read — identical →
      // replay; different → loop (cancel+create again = last-writer-wins).
      const raced = await getPendingSubscriptionBoxChange({
        db: client,
        shop: input.shop,
        subscriptionMealSelectionId: input.subscriptionMealSelectionId,
      });

      if (raced && isSamePendingTarget(raced, input)) {
        return { change: raced, replayed: true, replaced: false };
      }
    }
  }

  throw new Error(
    "requestSubscriptionBoxChange: could not resolve concurrent pending conflict",
  );
};

/**
 * pending → cancelled (CAS). applying/applied/failed cannot be cancelled here.
 */
export const cancelSubscriptionBoxChange = async ({
  db: dbOverride,
  id,
  now = new Date(),
}: {
  db?: SubscriptionBoxChangeDb;
  id: string;
  now?: Date;
}): Promise<SubscriptionBoxChangeTransitionResult> => {
  const client = resolveDb(dbOverride);
  const result = await client.subscriptionBoxChange.updateMany({
    data: {
      cancelledAt: now,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.CANCELLED,
    },
    where: {
      id,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
    },
  });

  return loadAfterConditionalUpdate({
    client,
    id,
    transitioned: result.count === 1,
  });
};

/** BOX-CHANGE-4: claim pending → applying (CAS — only one winner). */
export const markSubscriptionBoxChangeApplying = async ({
  db: dbOverride,
  id,
}: {
  db?: SubscriptionBoxChangeDb;
  id: string;
}): Promise<SubscriptionBoxChangeTransitionResult> => {
  const client = resolveDb(dbOverride);
  const result = await client.subscriptionBoxChange.updateMany({
    data: { status: SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING },
    where: {
      id,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING,
    },
  });

  return loadAfterConditionalUpdate({
    client,
    id,
    transitioned: result.count === 1,
  });
};

/** BOX-CHANGE-4: applying → applied (CAS). */
export const markSubscriptionBoxChangeApplied = async ({
  db: dbOverride,
  id,
  now = new Date(),
}: {
  db?: SubscriptionBoxChangeDb;
  id: string;
  now?: Date;
}): Promise<SubscriptionBoxChangeTransitionResult> => {
  const client = resolveDb(dbOverride);
  const result = await client.subscriptionBoxChange.updateMany({
    data: {
      appliedAt: now,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.APPLIED,
    },
    where: {
      id,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    },
  });

  return loadAfterConditionalUpdate({
    client,
    id,
    transitioned: result.count === 1,
  });
};

/** BOX-CHANGE-4: applying → failed (CAS). pending→failed not allowed in this phase. */
export const markSubscriptionBoxChangeFailed = async ({
  db: dbOverride,
  failureReason,
  id,
  now = new Date(),
}: {
  db?: SubscriptionBoxChangeDb;
  failureReason?: string | null;
  id: string;
  now?: Date;
}): Promise<SubscriptionBoxChangeTransitionResult> => {
  const client = resolveDb(dbOverride);
  const result = await client.subscriptionBoxChange.updateMany({
    data: {
      failedAt: now,
      failureReason: failureReason ?? null,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
    },
    where: {
      id,
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
    },
  });

  return loadAfterConditionalUpdate({
    client,
    id,
    transitioned: result.count === 1,
  });
};

/** Normalize pending.toSelectedMeals Json → string[] titles, or null if unusable. */
export const normalizePendingSelectedMeals = (
  value: unknown,
): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((item) => typeof item === "string")) {
    return null;
  }

  return value.map((item) => String(item));
};

/** True when pending carries exactly toMealsCount meal titles ready for selection/order. */
export const arePendingMealsReadyForApply = (pending: {
  toMealsCount: number;
  toSelectedMeals: unknown;
}): boolean => {
  const meals = normalizePendingSelectedMeals(pending.toSelectedMeals);
  return meals !== null && meals.length === pending.toMealsCount;
};

/**
 * Strict instant match between pending target cycle and the billing worker's due cycle.
 * Uses Date.getTime() — never string equality.
 */
export const classifyPendingBillingDateMatch = ({
  pendingEffectiveBillingDate,
  selectionNextBillingDate,
}: {
  pendingEffectiveBillingDate: Date;
  selectionNextBillingDate: Date | null | undefined;
}): PendingBillingDateMatch => {
  if (
    !(selectionNextBillingDate instanceof Date) ||
    Number.isNaN(selectionNextBillingDate.getTime())
  ) {
    return PENDING_BILLING_DATE_MATCH.MISSING;
  }

  const pendingMs = pendingEffectiveBillingDate.getTime();
  const dueMs = selectionNextBillingDate.getTime();

  if (pendingMs === dueMs) {
    return PENDING_BILLING_DATE_MATCH.MATCH;
  }

  if (pendingMs > dueMs) {
    return PENDING_BILLING_DATE_MATCH.FUTURE;
  }

  return PENDING_BILLING_DATE_MATCH.STALE;
};

export const getApplyingSubscriptionBoxChange = async ({
  db: dbOverride,
  shop,
  subscriptionMealSelectionId,
}: {
  db?: SubscriptionBoxChangeDb;
  shop?: string;
  subscriptionMealSelectionId: string;
}) => {
  const client = resolveDb(dbOverride);

  return client.subscriptionBoxChange.findFirst({
    orderBy: { requestedAt: "desc" },
    where: {
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING,
      subscriptionMealSelectionId,
      ...(shop ? { shop } : {}),
    },
  });
};

/** Most recent failed change for a selection (ops / fail-closed billing gate). */
export const getFailedSubscriptionBoxChange = async ({
  db: dbOverride,
  shop,
  subscriptionMealSelectionId,
}: {
  db?: SubscriptionBoxChangeDb;
  shop?: string;
  subscriptionMealSelectionId: string;
}) => {
  const client = resolveDb(dbOverride);

  return client.subscriptionBoxChange.findFirst({
    orderBy: { requestedAt: "desc" },
    where: {
      status: SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED,
      subscriptionMealSelectionId,
      ...(shop ? { shop } : {}),
    },
  });
};

/**
 * BOX-CHANGE-5: resolve the change that can still gate billing.
 * Priority: applying (reconcile) → pending → failed.
 * Applying must never become invisible once claimed.
 */
export const getRelevantSubscriptionBoxChangeForBilling = async ({
  db: dbOverride,
  shop,
  subscriptionMealSelectionId,
}: {
  db?: SubscriptionBoxChangeDb;
  shop?: string;
  subscriptionMealSelectionId: string;
}) => {
  const applying = await getApplyingSubscriptionBoxChange({
    db: dbOverride,
    shop,
    subscriptionMealSelectionId,
  });
  if (applying) {
    return applying;
  }

  const pending = await getPendingSubscriptionBoxChange({
    db: dbOverride,
    shop,
    subscriptionMealSelectionId,
  });
  if (pending) {
    return pending;
  }

  return getFailedSubscriptionBoxChange({
    db: dbOverride,
    shop,
    subscriptionMealSelectionId,
  });
};

export type ApplyPendingBoxChangeForBillingResult = {
  /** Derived from outcome allowlist — prefer isBillingAllowedAfterBoxChangeApply. */
  blockBilling: boolean;
  outcome: ApplyPendingBoxChangeOutcome;
  pendingId: string | null;
  reason?: string;
  runtimePrice?: string;
  selection?: SubscriptionMealSelection | null;
};

/** Fail-closed: bill only when outcome is explicitly in the allowlist. */
export const isBillingAllowedAfterBoxChangeApply = (
  result: Pick<ApplyPendingBoxChangeForBillingResult, "outcome">,
) => isBillingAllowedBoxChangeOutcome(result.outcome);

const billingGateResult = ({
  outcome,
  pendingId,
  reason,
  runtimePrice,
  selection,
}: {
  outcome: ApplyPendingBoxChangeOutcome;
  pendingId: string | null;
  reason?: string;
  runtimePrice?: string;
  selection?: SubscriptionMealSelection | null;
}): ApplyPendingBoxChangeForBillingResult => ({
  blockBilling: !isBillingAllowedBoxChangeOutcome(outcome),
  outcome,
  pendingId,
  ...(reason !== undefined ? { reason } : {}),
  ...(runtimePrice !== undefined ? { runtimePrice } : {}),
  ...(selection !== undefined ? { selection } : {}),
});

export type ApplyPendingBoxChangeForBillingDeps = {
  admin: ShopifyAdminGraphql;
  db?: SubscriptionBoxChangeDb;
  fetchBoxCatalog?: (admin: ShopifyAdminGraphql) => Promise<BuilderBoxOption[]>;
  fetchContractVariantId?: (
    admin: ShopifyAdminGraphql,
    subscriptionContractId: string,
  ) => Promise<string | null>;
  markMealSelectionExplicit?: (selectionId: string) => Promise<void>;
  now?: Date;
  selection: Pick<
    SubscriptionMealSelection,
    | "id"
    | "shop"
    | "subscriptionContractId"
    | "nextBillingDate"
    | "boxVariantShopifyId"
    | "mealsCount"
    | "selectedMeals"
  >;
  updateContractBox?: typeof updateSubscriptionContractBoxViaDraft;
  updateSelection?: (args: {
    data: Record<string, unknown>;
    id: string;
  }) => Promise<SubscriptionMealSelection>;
};

const isTransientApplyError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("429")
  );
};

const resolveTargetBoxOrFail = ({
  catalog,
  pending,
}: {
  catalog: BuilderBoxOption[];
  pending: SubscriptionBoxChangeRecord;
}): { box: BuilderBoxOption } | { terminalReason: string } => {
  const box = findBuilderBoxByVariantId(catalog, pending.toProductVariantId);

  if (!box) {
    return {
      terminalReason: `Target variant unavailable in Shopify catalog: ${pending.toProductVariantId}`,
    };
  }

  if (box.mealCount !== pending.toMealsCount) {
    return {
      terminalReason: `Target mealCount mismatch: catalog=${box.mealCount} pending=${pending.toMealsCount}`,
    };
  }

  if (!box.price?.trim()) {
    return { terminalReason: "Target variant has no runtime price" };
  }

  const sellingPlanId = box.sellingPlanId || pending.toSellingPlanId;

  if (!sellingPlanId) {
    return { terminalReason: "Target selling plan missing" };
  }

  return {
    box: {
      ...box,
      sellingPlanId,
    },
  };
};

const writeSelectionFromPending = async ({
  box,
  client,
  pending,
  selectionId,
  updateSelection,
}: {
  box: BuilderBoxOption;
  client: SubscriptionBoxChangeDb;
  pending: SubscriptionBoxChangeRecord;
  selectionId: string;
  updateSelection?: ApplyPendingBoxChangeForBillingDeps["updateSelection"];
}): Promise<SubscriptionMealSelection> => {
  const meals = normalizePendingSelectedMeals(pending.toSelectedMeals);

  if (!meals || meals.length !== pending.toMealsCount) {
    throw new Error("Pending selected meals are not ready for apply");
  }

  const data = {
    boxProductShopifyId: box.productId,
    boxSellingPlanShopifyId: box.sellingPlanId,
    boxSubscriptionPrice: box.price,
    boxTitle: getPortalV2BoxTitle(box.mealCount),
    boxVariantShopifyId: box.variantId,
    mealsCount: box.mealCount,
    selectedMeals: meals,
  };

  if (updateSelection) {
    return updateSelection({ data, id: selectionId });
  }

  if (!client.subscriptionMealSelection) {
    return (db as unknown as {
      subscriptionMealSelection: {
        update: (args: {
          data: Record<string, unknown>;
          where: { id: string };
        }) => Promise<SubscriptionMealSelection>;
      };
    }).subscriptionMealSelection.update({
      data,
      where: { id: selectionId },
    });
  }

  return client.subscriptionMealSelection.update({
    data,
    where: { id: selectionId },
  });
};

const selectionAlreadyMatchesTarget = (
  selection: ApplyPendingBoxChangeForBillingDeps["selection"],
  pending: SubscriptionBoxChangeRecord,
  box: BuilderBoxOption,
) =>
  selection.boxVariantShopifyId === box.variantId &&
  selection.mealsCount === box.mealCount &&
  sameSelectedMeals(selection.selectedMeals, pending.toSelectedMeals);

/**
 * Apply a matching pending box change immediately before a normal billing attempt.
 *
 * Recovery path must never call this.
 *
 * BOX-CHANGE-5 fail-closed rules:
 * - stale / missing cycle → block billing (never charge old box)
 * - failed change for due/past cycle → block billing
 * - applying → reconcile (Shopify re-fetch); bill only after applied coherence
 * - claim loser → block billing
 * - unexpected contract variant → block billing
 */
export const applyPendingSubscriptionBoxChangeForBilling = async (
  deps: ApplyPendingBoxChangeForBillingDeps,
): Promise<ApplyPendingBoxChangeForBillingResult> => {
  const {
    admin,
    now = new Date(),
    selection,
  } = deps;
  const client = resolveDb(deps.db);
  const fetchBoxCatalog = deps.fetchBoxCatalog ?? fetchBuilderBoxOptions;
  const fetchContractVariantId =
    deps.fetchContractVariantId ?? fetchSubscriptionContractCurrentVariantId;
  const updateContractBox =
    deps.updateContractBox ?? updateSubscriptionContractBoxViaDraft;

  const log = (event: string, extra?: Record<string, unknown>) => {
    console.log(`[BOX_CHANGE_APPLY] ${event}`, {
      selectionId: selection.id,
      shop: selection.shop,
      ...extra,
    });
  };

  if (!selection.subscriptionContractId) {
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.NO_PENDING,
      pendingId: null,
    });
  }

  const candidate = await getRelevantSubscriptionBoxChangeForBilling({
    db: client,
    shop: selection.shop,
    subscriptionMealSelectionId: selection.id,
  });

  if (!candidate) {
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.NO_PENDING,
      pendingId: null,
    });
  }

  log("pending detected", {
    effectiveBillingDate: candidate.effectiveBillingDate.toISOString(),
    pendingId: candidate.id,
    status: candidate.status,
    toMealsCount: candidate.toMealsCount,
    toProductVariantId: candidate.toProductVariantId,
  });

  const dateMatch = classifyPendingBillingDateMatch({
    pendingEffectiveBillingDate: candidate.effectiveBillingDate,
    selectionNextBillingDate: selection.nextBillingDate,
  });

  if (dateMatch === PENDING_BILLING_DATE_MATCH.FUTURE) {
    log("apply skipped due future cycle", {
      pendingId: candidate.id,
      selectionNextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
      status: candidate.status,
    });
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.SKIPPED_FUTURE,
      pendingId: candidate.id,
      reason: "effectiveBillingDate is after due nextBillingDate",
    });
  }

  if (dateMatch === PENDING_BILLING_DATE_MATCH.MISSING) {
    log("blocked_missing_billing_date", {
      pendingId: candidate.id,
      status: candidate.status,
    });
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_MISSING_BILLING_DATE,
      pendingId: candidate.id,
      reason: "selection.nextBillingDate missing",
    });
  }

  if (dateMatch === PENDING_BILLING_DATE_MATCH.STALE) {
    log("stale_pending_blocks_billing", {
      pendingId: candidate.id,
      selectionNextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
      status: candidate.status,
    });
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_STALE,
      pendingId: candidate.id,
      reason: "effectiveBillingDate is before due nextBillingDate",
    });
  }

  // Existing failed for the due cycle — never silently bill the old box.
  if (candidate.status === SUBSCRIPTION_BOX_CHANGE_STATUS.FAILED) {
    log("failed_change_blocks_billing", {
      failureReason: candidate.failureReason,
      pendingId: candidate.id,
    });
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_FAILED_CHANGE,
      pendingId: candidate.id,
      reason: candidate.failureReason ?? "failed box change for due cycle",
    });
  }

  if (candidate.status === SUBSCRIPTION_BOX_CHANGE_STATUS.APPLYING) {
    log("applying_reconciliation_started", { pendingId: candidate.id });
  }

  // Date matches the due cycle — apply must succeed before billing.
  if (!arePendingMealsReadyForApply(candidate)) {
    log("apply failed", {
      pendingId: candidate.id,
      reason: "toSelectedMeals not ready for toMealsCount",
    });

    if (candidate.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING) {
      const claimed = await markSubscriptionBoxChangeApplying({
        db: client,
        id: candidate.id,
      });
      if (claimed.transitioned && claimed.change) {
        await markSubscriptionBoxChangeFailed({
          db: client,
          failureReason: "toSelectedMeals length does not match toMealsCount",
          id: claimed.change.id,
          now,
        });
      }
    } else {
      await markSubscriptionBoxChangeFailed({
        db: client,
        failureReason: "toSelectedMeals length does not match toMealsCount",
        id: candidate.id,
        now,
      });
    }

    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.FAILED_TERMINAL,
      pendingId: candidate.id,
      reason: "toSelectedMeals length does not match toMealsCount",
    });
  }

  let active = candidate;

  if (candidate.status === SUBSCRIPTION_BOX_CHANGE_STATUS.PENDING) {
    const claimed = await markSubscriptionBoxChangeApplying({
      db: client,
      id: candidate.id,
    });

    if (!claimed.transitioned || !claimed.change) {
      log("claim_lost_blocks_billing", { pendingId: candidate.id });
      return billingGateResult({
        outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_CLAIM_LOST,
        pendingId: candidate.id,
        reason: "another worker claimed pending→applying",
      });
    }

    active = claimed.change;
    log("pending claimed", { pendingId: active.id });
  }

  try {
    const catalog = await fetchBoxCatalog(admin);
    const resolved = resolveTargetBoxOrFail({ catalog, pending: active });

    if ("terminalReason" in resolved) {
      log("apply failed", {
        pendingId: active.id,
        reason: resolved.terminalReason,
      });
      await markSubscriptionBoxChangeFailed({
        db: client,
        failureReason: resolved.terminalReason,
        id: active.id,
        now,
      });
      return billingGateResult({
        outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.FAILED_TERMINAL,
        pendingId: active.id,
        reason: resolved.terminalReason,
      });
    }

    const { box } = resolved;
    log("target price resolved", {
      pendingId: active.id,
      runtimePrice: box.price,
      toProductVariantId: box.variantId,
    });

    let contractVariantId: string | null = null;
    try {
      contractVariantId = await fetchContractVariantId(
        admin,
        selection.subscriptionContractId,
      );
    } catch (error) {
      if (isTransientApplyError(error)) {
        log("apply failed", {
          pendingId: active.id,
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
        return billingGateResult({
          outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
          pendingId: active.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }

    const shopifyAlreadyOnTarget = contractVariantId === box.variantId;
    const shopifyOnFromVariant =
      contractVariantId === active.fromProductVariantId;

    if (!shopifyAlreadyOnTarget && !shopifyOnFromVariant) {
      // Timeout/ambiguity or drift: third variant — do not bill, do not guess.
      log("unexpected_contract_variant", {
        contractVariantId,
        expectedFrom: active.fromProductVariantId,
        expectedTo: box.variantId,
        pendingId: active.id,
      });
      return billingGateResult({
        outcome:
          APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_UNEXPECTED_CONTRACT_VARIANT,
        pendingId: active.id,
        reason: `Contract variant unexpected: ${contractVariantId ?? "null"}`,
      });
    }

    if (!shopifyAlreadyOnTarget) {
      try {
        await updateContractBox({
          admin,
          box: {
            price: box.price,
            sellingPlanId: box.sellingPlanId,
            variantId: box.variantId,
          },
          subscriptionContractId: selection.subscriptionContractId,
        });
        log("contract updated", {
          pendingId: active.id,
          runtimePrice: box.price,
          toProductVariantId: box.variantId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Transient or ambiguous draft failure — keep applying; never assume fail.
        log("apply failed", {
          pendingId: active.id,
          reason: message,
          retryable: true,
        });
        return billingGateResult({
          outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
          pendingId: active.id,
          reason: message,
        });
      }
    } else {
      log("applying_contract_already_target", {
        pendingId: active.id,
        toProductVariantId: box.variantId,
      });
    }

    let updatedSelection: SubscriptionMealSelection | null = null;

    if (!selectionAlreadyMatchesTarget(selection, active, box)) {
      updatedSelection = await writeSelectionFromPending({
        box,
        client,
        pending: active,
        selectionId: selection.id,
        updateSelection: deps.updateSelection,
      });
      log("applying_selection_healed", {
        mealsCount: box.mealCount,
        pendingId: active.id,
        selectedMealsCount: normalizePendingSelectedMeals(active.toSelectedMeals)
          ?.length,
      });
    } else {
      log("selection already on target", { pendingId: active.id });
    }

    // Coherence gate: Selection must match target before applied / billing.
    const coherenceSelection = updatedSelection ?? selection;
    if (!selectionAlreadyMatchesTarget(coherenceSelection, active, box)) {
      log("selection coherence incomplete", { pendingId: active.id });
      return billingGateResult({
        outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
        pendingId: active.id,
        reason: "Selection not coherent with target after apply",
        selection: updatedSelection,
      });
    }

    if (deps.markMealSelectionExplicit) {
      try {
        await deps.markMealSelectionExplicit(selection.id);
      } catch (error) {
        log("meal selection explicit tracking failed", {
          error: error instanceof Error ? error.message : String(error),
          pendingId: active.id,
        });
      }
    }

    const applied = await markSubscriptionBoxChangeApplied({
      db: client,
      id: active.id,
      now,
    });

    if (!applied.transitioned) {
      const stillApplying = await getApplyingSubscriptionBoxChange({
        db: client,
        shop: selection.shop,
        subscriptionMealSelectionId: selection.id,
      });

      if (stillApplying?.id === active.id) {
        log("mark applied failed — still applying", { pendingId: active.id });
        return billingGateResult({
          outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
          pendingId: active.id,
          reason: "markApplied CAS lost while still applying",
          selection: updatedSelection,
        });
      }
    }

    log("applying_reconciled", {
      pendingId: active.id,
      runtimePrice: box.price,
    });

    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.APPLIED,
      pendingId: active.id,
      runtimePrice: box.price,
      selection: updatedSelection,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isTransientApplyError(error)) {
      log("apply failed", {
        pendingId: active.id,
        reason: message,
        retryable: true,
      });
      return billingGateResult({
        outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.BLOCKED_RETRYABLE,
        pendingId: active.id,
        reason: message,
      });
    }

    log("apply failed", {
      pendingId: active.id,
      reason: message,
      retryable: false,
    });
    await markSubscriptionBoxChangeFailed({
      db: client,
      failureReason: message.slice(0, 500),
      id: active.id,
      now,
    });
    return billingGateResult({
      outcome: APPLY_PENDING_BOX_CHANGE_OUTCOME.FAILED_TERMINAL,
      pendingId: active.id,
      reason: message,
    });
  }
};
