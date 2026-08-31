import type { SubscriptionMealSelection } from "@prisma/client";

import { isTerminalSubscriptionSelectionStatus } from "../constants/subscriptionMealSelection";
import db from "../db.server";
import { syncSubscriptionContractState } from "./subscriptionContractSync.server";
import { unauthenticated } from "../shopify.server";
import {
  reconcilePendingContractForSelection,
} from "./subscriptionMealSelection.server";
import {
  handleAutomaticBillingFailure,
  isSelectionOwnedByRecoveryRetry,
  processDueRecoveryRetries,
  reconcileSelectionBillingAttemptState,
  type RecoveryWorkerSummary,
} from "./subscriptionPaymentRecovery.server";
import { alignImmediatePaymentResumeWithDeliverySchedule } from "./deliverySchedule.server";
import { evaluateDeliveryBillingReadiness } from "../utils/deliveryDate";
import { markMealSelectionExplicitForCurrentDelivery } from "./email/meal-selection-email.server";
import { captureTechnicalError } from "./observability/captureTechnicalError.server";

const billingAttemptCreateMutation = `#graphql
  mutation SubscriptionBillingAttemptCreate(
    $subscriptionContractId: ID!
    $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $subscriptionContractId
      subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput
    ) {
      subscriptionBillingAttempt {
        id
        createdAt
        completedAt
        ready
        errorMessage
        processingError {
          code
          message
        }
        order {
          id
          name
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const billingAttemptQuery = `#graphql
  query SubscriptionBillingAttempt($id: ID!) {
    subscriptionBillingAttempt(id: $id) {
      id
      createdAt
      completedAt
      ready
      errorMessage
      processingError {
        code
        message
      }
      order {
        id
        name
      }
    }
  }
`;

const subscriptionContractQuery = `#graphql
  query SubscriptionContractNextBilling($id: ID!) {
    subscriptionContract(id: $id) {
      id
      nextBillingDate
    }
  }
`;

const subscriptionContractStatusQuery = `#graphql
  query SubscriptionContractStatus($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
    }
  }
`;

const subscriptionContractActivateMutation = `#graphql
  mutation SubscriptionContractActivate($subscriptionContractId: ID!) {
    subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
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

const subscriptionContractPauseMutation = `#graphql
  mutation SubscriptionContractPause($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
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

const subscriptionContractBillingPolicyQuery = `#graphql
  query SubscriptionContractBillingPolicy($id: ID!) {
    subscriptionContract(id: $id) {
      id
      billingPolicy {
        interval
        intervalCount
      }
    }
  }
`;

const subscriptionContractSetNextBillingDateMutation = `#graphql
  mutation SubscriptionContractSetNextBillingDate(
    $contractId: ID!
    $date: DateTime!
  ) {
    subscriptionContractSetNextBillingDate(contractId: $contractId, date: $date) {
      contract {
        id
        nextBillingDate
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type SubscriptionBillingAttemptPayload = {
  id?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  ready?: boolean | null;
  errorMessage?: string | null;
  processingError?: {
    code?: string | null;
    message?: string | null;
  } | null;
  order?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

type BillingAttemptCreateResponse = {
  data?: {
    subscriptionBillingAttemptCreate?: {
      subscriptionBillingAttempt?: SubscriptionBillingAttemptPayload | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionContractResponse = {
  data?: {
    subscriptionContract?: {
      id?: string | null;
      nextBillingDate?: string | null;
    } | null;
  };
  errors?: unknown;
};

type SubscriptionContractStatusResponse = {
  data?: {
    subscriptionContract?: {
      id?: string | null;
      status?: string | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SubscriptionContractMutationResponse = {
  data?: {
    subscriptionContractActivate?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
    subscriptionContractPause?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
    subscriptionContractCancel?: {
      contract?: { id?: string | null; status?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

const getGraphqlUserErrors = (
  userErrors?: { message?: string | null }[] | null,
) =>
  userErrors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(" ") ?? "";

export type SubscriptionBillingPolicy = {
  interval: string;
  intervalCount: number;
};

type SubscriptionContractBillingPolicyResponse = {
  data?: {
    subscriptionContract?: {
      billingPolicy?: {
        interval?: string | null;
        intervalCount?: number | null;
      } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

type SetNextBillingDateResponse = {
  data?: {
    subscriptionContractSetNextBillingDate?: {
      contract?: {
        id?: string | null;
        nextBillingDate?: string | null;
      } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

export type BillingSkipReason =
  | "paused_or_inactive"
  | "missing_contract_id"
  | "missing_next_billing_date"
  | "next_billing_date_in_future"
  | "payment_recovery"
  | "recent_attempt"
  | "terminal_contract"
  | "contract_sync_error"
  | "delivery_billing_not_ready"
  | "pending_box_change";

export type BillingAttemptStatus =
  | "success"
  | "submitted"
  | "failure"
  | "unknown";

export type BillingWorkerSummary = {
  processed: number;
  skipped: number;
  success: number;
  submitted: number;
  errors: number;
  skipReasons: Record<BillingSkipReason, number>;
  recovery: RecoveryWorkerSummary;
};

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

export type { ShopifyAdminGraphql };

/** Skip re-billing if an attempt was made within this window (cron dedup). */
export const RECENT_BILLING_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

/** Resume UI lock — only block the customer briefly while billing is in flight. */
export const RESUME_PROCESSING_TIMEOUT_MS = 3 * 60 * 1000;

export const RESUME_LOCK_STATUS = {
  ARCHIVED: "archived",
  FAILED: "failed",
  PROCESSING: "processing",
  SCHEDULE_UPDATE_FAILED: "schedule_update_failed",
  SUCCEEDED: "succeeded",
} as const;

export type ResumeLockStatus =
  (typeof RESUME_LOCK_STATUS)[keyof typeof RESUME_LOCK_STATUS];

const EMPTY_SKIP_REASONS = (): Record<BillingSkipReason, number> => ({
  contract_sync_error: 0,
  delivery_billing_not_ready: 0,
  missing_contract_id: 0,
  missing_next_billing_date: 0,
  next_billing_date_in_future: 0,
  paused_or_inactive: 0,
  payment_recovery: 0,
  pending_box_change: 0,
  recent_attempt: 0,
  terminal_contract: 0,
});

export const isShopifyBillingWorkerButtonEnabled = () =>
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_SHOPIFY_BILLING_WORKER_BUTTON === "true";

export const toSubscriptionContractGid = (subscriptionContractId: string) =>
  subscriptionContractId.includes("/")
    ? subscriptionContractId
    : `gid://shopify/SubscriptionContract/${subscriptionContractId}`;

export const fetchSubscriptionContractNextBillingDate = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<Date | null> => {
  const response = await admin.graphql(subscriptionContractQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractResponse;

  if (json.errors) {
    console.log(
      "[subscriptionBilling] nextBillingDate GraphQL errors",
      json.errors,
    );
    return null;
  }

  const nextBillingDate = json.data?.subscriptionContract?.nextBillingDate;

  if (!nextBillingDate) {
    return null;
  }

  const parsed = new Date(nextBillingDate);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const fetchSubscriptionContractStatus = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<string | null> => {
  const response = await admin.graphql(subscriptionContractStatusQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractStatusResponse;

  if (json.errors?.length) {
    console.log("[resumeBilling] contract status GraphQL errors", {
      errors: json.errors,
      subscriptionContractId,
    });
    return null;
  }

  return json.data?.subscriptionContract?.status ?? null;
};

export const activateSubscriptionContractWithVerification = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
  context: { selectionId: string },
): Promise<
  | { ok: true; shopifyStatus: string }
  | { ok: false; error: string; shopifyStatus: string | null }
> => {
  const response = await admin.graphql(subscriptionContractActivateMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractMutationResponse;

  console.log("[resumeBilling] activation mutation result", {
    graphQLErrors: json.errors ?? null,
    mutationContractStatus:
      json.data?.subscriptionContractActivate?.contract?.status ?? null,
    selectionId: context.selectionId,
    subscriptionContractId,
    userErrors: json.data?.subscriptionContractActivate?.userErrors ?? null,
  });

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la réactivation.",
      ok: false,
      shopifyStatus: null,
    };
  }

  const result = json.data?.subscriptionContractActivate;
  const userErrorMessage = getGraphqlUserErrors(result?.userErrors);

  if (userErrorMessage) {
    return { error: userErrorMessage, ok: false, shopifyStatus: null };
  }

  if (!result?.contract?.id) {
    return {
      error: "Shopify n’a pas confirmé la réactivation.",
      ok: false,
      shopifyStatus: null,
    };
  }

  const freshStatus = await fetchSubscriptionContractStatus(
    admin,
    subscriptionContractId,
  );

  console.log("[resumeBilling] fresh Shopify contract status after activation", {
    selectionId: context.selectionId,
    shopifyStatus: freshStatus,
    subscriptionContractId,
  });

  if (freshStatus !== "ACTIVE") {
    const reason =
      freshStatus === "PAUSED"
        ? "Shopify conserve le contrat en pause après la demande de réactivation."
        : `Le contrat Shopify n’est pas actif (statut : ${freshStatus ?? "inconnu"}).`;

    return { error: reason, ok: false, shopifyStatus: freshStatus };
  }

  return { ok: true, shopifyStatus: freshStatus };
};

export const pauseSubscriptionContractOnShopify = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<{ error?: string }> => {
  const response = await admin.graphql(subscriptionContractPauseMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractMutationResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la mise en pause.",
    };
  }

  const userErrorMessage = getGraphqlUserErrors(
    json.data?.subscriptionContractPause?.userErrors,
  );

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  return {};
};

export const cancelSubscriptionContractOnShopify = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<{ error?: string }> => {
  const response = await admin.graphql(subscriptionContractCancelMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractMutationResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de l’annulation.",
    };
  }

  const result = json.data?.subscriptionContractCancel;
  const userErrorMessage = getGraphqlUserErrors(result?.userErrors);

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  if (!result?.contract?.id) {
    return { error: "Shopify n’a pas confirmé l’annulation du contrat." };
  }

  return {};
};

export type PortalSubscriptionState = "active" | "paused" | "resume_processing";

export const derivePortalSubscriptionState = (selection: {
  active: boolean;
  resumeAttemptOrderId: string | null;
  resumeAttemptStatus: string | null;
  status: string;
}): PortalSubscriptionState => {
  if (
    selection.resumeAttemptStatus === RESUME_LOCK_STATUS.PROCESSING &&
    !selection.resumeAttemptOrderId
  ) {
    return "resume_processing";
  }

  if (selection.status === "active" && selection.active) {
    return "active";
  }

  return "paused";
};

export const isResumeAttemptInFlight = (selection: {
  resumeAttemptOrderId: string | null;
  resumeAttemptStatus: string | null;
}) =>
  selection.resumeAttemptStatus === RESUME_LOCK_STATUS.PROCESSING &&
  !selection.resumeAttemptOrderId;

export const reconcilePortalSelectionShopifyState = async (
  admin: ShopifyAdminGraphql,
  record: SubscriptionMealSelection,
): Promise<SubscriptionMealSelection> => {
  if (!record.subscriptionContractId) {
    return record;
  }

  const syncResult = await syncSubscriptionContractState({
    admin,
    shop: record.shop,
    source: "portal_reconciliation",
    subscriptionContractId: record.subscriptionContractId,
  });

  return syncResult.selection ?? record;
};

export const fetchSubscriptionContractBillingPolicy = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<SubscriptionBillingPolicy | null> => {
  const response = await admin.graphql(subscriptionContractBillingPolicyQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as SubscriptionContractBillingPolicyResponse;

  if (json.errors?.length) {
    console.log(
      "[subscriptionBilling] billingPolicy GraphQL errors",
      json.errors,
    );
    return null;
  }

  const billingPolicy = json.data?.subscriptionContract?.billingPolicy;
  const interval = billingPolicy?.interval;
  const intervalCount = billingPolicy?.intervalCount;

  if (!interval || !intervalCount || intervalCount < 1) {
    return null;
  }

  return { interval, intervalCount };
};

export const calculateNextBillingDateFromPolicy = (
  paymentDate: Date,
  billingPolicy: SubscriptionBillingPolicy,
): Date => {
  const count = billingPolicy.intervalCount;
  const msPerDay = 24 * 60 * 60 * 1000;

  switch (billingPolicy.interval) {
    case "DAY":
      return new Date(paymentDate.getTime() + count * msPerDay);
    case "WEEK":
      return new Date(paymentDate.getTime() + count * 7 * msPerDay);
    case "MONTH": {
      const result = new Date(paymentDate.getTime());
      result.setUTCMonth(result.getUTCMonth() + count);
      return result;
    }
    case "YEAR": {
      const result = new Date(paymentDate.getTime());
      result.setUTCFullYear(result.getUTCFullYear() + count);
      return result;
    }
    default:
      throw new Error(
        `Unsupported billing interval: ${billingPolicy.interval}`,
      );
  }
};

const parseShopifyDateTime = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const setSubscriptionContractNextBillingDate = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
  nextBillingDate: Date,
): Promise<
  | { ok: true; nextBillingDate: Date }
  | { ok: false; error: string }
> => {
  const response = await admin.graphql(
    subscriptionContractSetNextBillingDateMutation,
    {
      variables: {
        contractId: toSubscriptionContractGid(subscriptionContractId),
        date: nextBillingDate.toISOString(),
      },
    },
  );
  const json = (await response.json()) as SetNextBillingDateResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la mise à jour de la date.",
      ok: false,
    };
  }

  const result = json.data?.subscriptionContractSetNextBillingDate;
  const userErrorMessage =
    result?.userErrors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(" ") ?? "";

  if (userErrorMessage) {
    return { error: userErrorMessage, ok: false };
  }

  const confirmedDate = parseShopifyDateTime(result?.contract?.nextBillingDate);

  if (!confirmedDate) {
    return {
      error: "Shopify n’a pas confirmé la nouvelle date de facturation.",
      ok: false,
    };
  }

  return { ok: true, nextBillingDate: confirmedDate };
};

export type ScheduleResumeNextBillingDateResult =
  | { ok: true; nextBillingDate: Date }
  | { ok: false; error: string };

/** Schedule next billing from the active delivery calendar after resume payment. */
export const scheduleNextBillingDateAfterResumePayment = async ({
  admin,
  paymentAt,
  selection,
  selectionId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  oldNextBillingDate?: Date | null;
  paymentAt: Date;
  selection: {
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
  };
  selectionId: string;
  subscriptionContractId: string;
}): Promise<ScheduleResumeNextBillingDateResult> => {
  console.log("[resumeBilling] scheduling nextBillingDate from delivery schedule", {
    paymentAt: paymentAt.toISOString(),
    selectionId,
    subscriptionContractId,
  });

  const alignmentResult = await alignImmediatePaymentResumeWithDeliverySchedule({
    admin,
    paymentAt,
    selection,
    selectionId,
    subscriptionContractId,
  });

  if (alignmentResult.status === "aligned") {
    console.log("[resumeBilling] nextBillingDate updated", {
      finalNextBillingDate: alignmentResult.alignedNextBillingDate.toISOString(),
      paymentAt: paymentAt.toISOString(),
      resumeTargetDeliveryDate: alignmentResult.resumeTargetDeliveryDate,
      selectionId,
      subscriptionContractId,
    });

    return {
      nextBillingDate: alignmentResult.alignedNextBillingDate,
      ok: true,
    };
  }

  const error =
    alignmentResult.status === "failed"
      ? alignmentResult.error
      : "Impossible de calculer la prochaine livraison après reprise.";

  console.log("[resumeBilling] nextBillingDate scheduling failed", {
    error,
    paymentAt: paymentAt.toISOString(),
    reason: alignmentResult.status === "skipped" ? alignmentResult.reason : "failed",
    selectionId,
    subscriptionContractId,
  });

  return { error, ok: false };
};

const getTodayIsoDate = () => new Date().toISOString().slice(0, 10);

const buildAutoBillingIdempotencyKey = (selectionId: string) =>
  `mileyo_auto_${selectionId}_${getTodayIsoDate()}`;

export const buildResumeBillingIdempotencyKey = (
  selectionId: string,
  resumeAttemptKey: string,
  retryNumber = 1,
) => `mileyo_resume_${selectionId}_${resumeAttemptKey}_r${retryNumber}`;

const UNFINISHED_RESUME_ATTEMPT_STATUSES = new Set<string>([
  RESUME_LOCK_STATUS.PROCESSING,
  RESUME_LOCK_STATUS.FAILED,
  RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED,
]);

export type EnsureResumeAttemptResult = {
  idempotencyKey: string;
  isNewCycle: boolean;
  isRetry: boolean;
  resumeAttemptKey: string;
  retryNumber: number;
};

const bumpResumeRetryGeneration = async ({
  oldAttemptId,
  oldIdempotencyKey,
  resumeAttemptKey,
  selection,
  selectionId,
}: {
  oldAttemptId?: string | null;
  oldIdempotencyKey: string;
  resumeAttemptKey: string;
  selection: SubscriptionMealSelection;
  selectionId: string;
}) => {
  const newRetryNumber = (selection.resumeAttemptRetryNumber ?? 1) + 1;
  const newIdempotencyKey = buildResumeBillingIdempotencyKey(
    selectionId,
    resumeAttemptKey,
    newRetryNumber,
  );
  const resolvedOldAttemptId =
    oldAttemptId ?? selection.resumeAttemptBillingAttemptId;

  await db.subscriptionMealSelection.update({
    data: {
      resumeAttemptLastFailedBillingAttemptId: resolvedOldAttemptId,
      resumeAttemptRetryNumber: newRetryNumber,
    },
    where: { id: selectionId },
  });

  console.log("[resumeBilling] terminal failure found, creating fresh retry", {
    newIdempotencyKey,
    newRetryNumber,
    oldAttemptId: resolvedOldAttemptId,
    oldIdempotencyKey,
    selectionId,
  });

  return { idempotencyKey: newIdempotencyKey, retryNumber: newRetryNumber };
};

/** Persist a resume-cycle key before billing; reuse key only while in-flight. */
export const ensureResumeAttemptForBilling = async (
  selectionId: string,
): Promise<EnsureResumeAttemptResult> => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (selection?.resumeAttemptKey && isResumeAttemptInFlight(selection)) {
    const retryNumber = selection.resumeAttemptRetryNumber ?? 1;
    const { resumeAttemptKey } = selection;
    const idempotencyKey = buildResumeBillingIdempotencyKey(
      selectionId,
      resumeAttemptKey,
      retryNumber,
    );

    console.log("[resumeBilling] reusing in-flight resume attempt", {
      idempotencyKey,
      isNewCycle: false,
      isRetry: true,
      resumeAttemptKey,
      resumeAttemptStatus: selection.resumeAttemptStatus,
      retryNumber,
      selectionId,
    });

    return {
      idempotencyKey,
      isNewCycle: false,
      isRetry: true,
      resumeAttemptKey,
      retryNumber,
    };
  }

  if (
    selection?.resumeAttemptKey &&
    selection.resumeAttemptStatus &&
    selection.resumeAttemptStatus !== RESUME_LOCK_STATUS.ARCHIVED &&
    selection.resumeAttemptStatus !== RESUME_LOCK_STATUS.SUCCEEDED
  ) {
    const retryNumber = selection.resumeAttemptRetryNumber ?? 1;
    const { resumeAttemptKey } = selection;
    const idempotencyKey = buildResumeBillingIdempotencyKey(
      selectionId,
      resumeAttemptKey,
      retryNumber,
    );

    console.log("[resumeBilling] continuing resume cycle", {
      idempotencyKey,
      isNewCycle: false,
      isRetry: true,
      resumeAttemptKey,
      resumeAttemptStatus: selection.resumeAttemptStatus,
      retryNumber,
      selectionId,
    });

    return {
      idempotencyKey,
      isNewCycle: false,
      isRetry: true,
      resumeAttemptKey,
      retryNumber,
    };
  }

  const resumeAttemptKey = crypto.randomUUID();
  const idempotencyKey = buildResumeBillingIdempotencyKey(
    selectionId,
    resumeAttemptKey,
    1,
  );

  await db.subscriptionMealSelection.update({
    data: {
      resumeAttemptBillingAttemptId: null,
      resumeAttemptKey,
      resumeAttemptLastFailedBillingAttemptId: null,
      resumeAttemptOrderId: null,
      resumeAttemptRetryNumber: 1,
      resumeAttemptStartedAt: null,
      resumeAttemptStatus: null,
    },
    where: { id: selectionId },
  });

  console.log("[resumeBilling] fresh resume cycle started", {
    idempotencyKey,
    isNewCycle: true,
    isRetry: false,
    resumeAttemptKey,
    retryNumber: 1,
    selectionId,
  });

  return {
    idempotencyKey,
    isNewCycle: true,
    isRetry: false,
    resumeAttemptKey,
    retryNumber: 1,
  };
};

/** Close the current resume cycle when pausing so the next resume can bill again. */
export const archiveResumeAttemptOnPause = async (selectionId: string) => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection?.resumeAttemptKey) {
    return;
  }

  await db.subscriptionMealSelection.update({
    data: {
      resumeAttemptStatus: RESUME_LOCK_STATUS.ARCHIVED,
    },
    where: { id: selectionId },
  });

  console.log("[resumeBilling] archived resume attempt on pause", {
    resumeAttemptBillingAttemptId: selection.resumeAttemptBillingAttemptId,
    resumeAttemptKey: selection.resumeAttemptKey,
    resumeAttemptOrderId: selection.resumeAttemptOrderId,
    resumeAttemptStatus: selection.resumeAttemptStatus,
    selectionId,
  });
};

export const toShopifyOrderGid = (shopifyOrderId: string) =>
  shopifyOrderId.includes("/")
    ? shopifyOrderId
    : `gid://shopify/Order/${shopifyOrderId}`;

export const shopifyOrderIdsMatch = (
  storedOrderId: string | null,
  shopifyOrderId: string,
) => {
  if (!storedOrderId) {
    return false;
  }

  const normalize = (value: string) =>
    value.replace(/^gid:\/\/shopify\/Order\//, "");

  return (
    normalize(storedOrderId) === normalize(shopifyOrderId) ||
    storedOrderId === shopifyOrderId
  );
};

export const isResumeRenewalOrder = (selection: {
  resumeAttemptKey: string | null;
  resumeAttemptStatus: string | null;
}) =>
  Boolean(selection.resumeAttemptKey) &&
  selection.resumeAttemptStatus !== null &&
  selection.resumeAttemptStatus !== RESUME_LOCK_STATUS.ARCHIVED &&
  UNFINISHED_RESUME_ATTEMPT_STATUSES.has(selection.resumeAttemptStatus);

export const isResumeOrderAlreadyScheduled = (
  selection: {
    nextBillingDate: Date | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStatus: string | null;
  },
  shopifyOrderId: string,
) =>
  selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SUCCEEDED &&
  shopifyOrderIdsMatch(selection.resumeAttemptOrderId, shopifyOrderId);

/** After async resume billing, schedule nextBillingDate from the real order time. */
export const completeResumeRenewalFromWebhook = async ({
  admin,
  orderCreatedAt,
  selectionId,
  shopifyOrderId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  orderCreatedAt: Date;
  selectionId: string;
  shopifyOrderId: string;
  subscriptionContractId: string;
}) => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection?.resumeAttemptKey) {
    console.log("[resumeBilling] webhook: skip — no resume attempt key", {
      selectionId,
      shopifyOrderId,
    });
    return;
  }

  const orderGid = toShopifyOrderGid(shopifyOrderId);

  if (isResumeOrderAlreadyScheduled(selection, shopifyOrderId)) {
    console.log("[resumeBilling] webhook: skip — resume already scheduled", {
      nextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
      resumeAttemptKey: selection.resumeAttemptKey,
      selectionId,
      shopifyOrderId,
    });
    return;
  }

  console.log("[resumeBilling] webhook: scheduling from order created_at", {
    orderCreatedAt: orderCreatedAt.toISOString(),
    resumeAttemptKey: selection.resumeAttemptKey,
    resumeAttemptStatus: selection.resumeAttemptStatus,
    selectionId,
    shopifyOrderId,
  });

  const scheduleResult = await scheduleNextBillingDateAfterResumePayment({
    admin,
    paymentAt: orderCreatedAt,
    selection: {
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
    },
    selectionId,
    subscriptionContractId,
  });

  if (scheduleResult.ok) {
    await releaseResumeBillingLock({
      attemptId: selection.resumeAttemptBillingAttemptId,
      errorMessage: null,
      orderId: orderGid,
      resumeAttemptKey: selection.resumeAttemptKey,
      selectionId,
      status: RESUME_LOCK_STATUS.SUCCEEDED,
    });

    console.log("[resumeBilling] webhook: resume cycle completed", {
      finalNextBillingDate: scheduleResult.nextBillingDate.toISOString(),
      orderCreatedAt: orderCreatedAt.toISOString(),
      resumeAttemptKey: selection.resumeAttemptKey,
      selectionId,
      shopifyOrderId,
    });
    return;
  }

  await releaseResumeBillingLock({
    attemptId: selection.resumeAttemptBillingAttemptId,
    errorMessage: scheduleResult.error,
    orderId: orderGid,
    resumeAttemptKey: selection.resumeAttemptKey,
    selectionId,
    status: RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED,
  });

  console.log("[resumeBilling] webhook: schedule update failed", {
    error: scheduleResult.error,
    resumeAttemptKey: selection.resumeAttemptKey,
    selectionId,
    shopifyOrderId,
  });
};

type BillingAttemptQueryResponse = {
  data?: {
    subscriptionBillingAttempt?: SubscriptionBillingAttemptPayload | null;
  };
  errors?: { message?: string | null }[];
};

export type ResumeBillingPrepareResult =
  | {
      action: "proceed";
      idempotencyKey?: string;
      isFreshRetry?: boolean;
      retryNumber?: number;
    }
  | { action: "block_processing" }
  | {
      action: "billing_already_succeeded";
      attemptId: string;
      orderId: string;
      paymentAt: Date;
    }
  | {
      action: "retry_schedule_only";
      attemptId: string;
      orderId: string;
      paymentAt: Date;
    };

const isWithinMs = (timestamp: Date | null, windowMs: number) => {
  if (!timestamp) {
    return false;
  }

  return Date.now() - timestamp.getTime() < windowMs;
};

const isResumeProcessingActive = (selection: {
  resumeAttemptKey: string | null;
  resumeAttemptStartedAt: Date | null;
  resumeAttemptStatus: string | null;
}) =>
  Boolean(selection.resumeAttemptKey) &&
  selection.resumeAttemptStatus === RESUME_LOCK_STATUS.PROCESSING &&
  isWithinMs(selection.resumeAttemptStartedAt, RESUME_PROCESSING_TIMEOUT_MS);

const isCurrentResumeAttempt = (
  selection: {
    resumeAttemptKey: string | null;
  },
  resumeAttemptKey: string,
) => selection.resumeAttemptKey === resumeAttemptKey;

const extractAttemptPayment = (
  attempt: SubscriptionBillingAttemptPayload | null | undefined,
  fallbackAt: Date,
) => {
  const orderId = getBillingAttemptOrderId(attempt);
  const paymentAt =
    parseShopifyDateTime(attempt?.completedAt) ?? (orderId ? fallbackAt : null);

  if (!orderId || !paymentAt || !attempt?.id) {
    return null;
  }

  return { attemptId: attempt.id, orderId, paymentAt };
};

export const fetchShopifyBillingAttempt = async (
  admin: ShopifyAdminGraphql,
  attemptId: string,
): Promise<SubscriptionBillingAttemptPayload | null> => {
  const response = await admin.graphql(billingAttemptQuery, {
    variables: { id: attemptId },
  });
  const json = (await response.json()) as BillingAttemptQueryResponse;

  if (json.errors?.length) {
    console.log("[resumeBilling] fetch billing attempt errors", {
      attemptId,
      errors: json.errors,
    });
    return null;
  }

  return json.data?.subscriptionBillingAttempt ?? null;
};

/** Reconcile via idempotency key — returns existing attempt without creating a duplicate. */
export const reconcileBillingAttemptByIdempotencyKey = async ({
  admin,
  idempotencyKey,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  idempotencyKey: string;
  subscriptionContractId: string;
}) => {
  const json = await createBillingAttempt(
    admin,
    subscriptionContractId,
    idempotencyKey,
  );

  if (json.errors?.length) {
    return {
      attempt: null as SubscriptionBillingAttemptPayload | null,
      errorMessage:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la réconciliation.",
      status: "failure" as BillingAttemptStatus,
    };
  }

  const result = json.data?.subscriptionBillingAttemptCreate;
  const userErrors = result?.userErrors ?? [];
  const attempt = result?.subscriptionBillingAttempt ?? null;
  const resolved = resolveBillingAttemptStatus(userErrors, attempt);

  return {
    attempt,
    errorMessage: resolved.errorMessage,
    status: resolved.status,
  };
};

export const releaseResumeBillingLock = async ({
  attemptId,
  errorMessage,
  orderId,
  resumeAttemptKey,
  selectionId,
  status,
}: {
  attemptId?: string | null;
  errorMessage?: string | null;
  orderId?: string | null;
  resumeAttemptKey: string;
  selectionId: string;
  status: ResumeLockStatus;
}) => {
  const resolvedStatus =
    status === RESUME_LOCK_STATUS.SUCCEEDED && !orderId
      ? RESUME_LOCK_STATUS.PROCESSING
      : status;

  const subscriptionActive =
    (resolvedStatus === RESUME_LOCK_STATUS.SUCCEEDED ||
      resolvedStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED) &&
    Boolean(orderId);
  const subscriptionPaused =
    resolvedStatus === RESUME_LOCK_STATUS.FAILED ||
    resolvedStatus === RESUME_LOCK_STATUS.PROCESSING;

  const before = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  await db.subscriptionMealSelection.update({
    data: {
      lastBillingAttemptAt: new Date(),
      lastBillingAttemptError: errorMessage ?? null,
      lastBillingAttemptId: attemptId ?? null,
      lastBillingAttemptStatus: resolvedStatus,
      resumeAttemptBillingAttemptId: attemptId ?? undefined,
      resumeAttemptKey,
      ...(orderId ? { resumeAttemptOrderId: orderId } : {}),
      resumeAttemptStatus: resolvedStatus,
      ...(subscriptionActive
        ? { active: true, status: "active" }
        : subscriptionPaused
          ? { active: false, status: "paused" }
          : {}),
    },
    where: { id: selectionId },
  });

  const after = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  console.log("[resumeBilling] lock released", {
    attemptId: attemptId ?? null,
    errorMessage: errorMessage ?? null,
    idempotencyKey: buildResumeBillingIdempotencyKey(
      selectionId,
      resumeAttemptKey,
      after?.resumeAttemptRetryNumber ?? 1,
    ),
    localActiveAfter: after?.active ?? null,
    localStatusAfter: after?.status ?? null,
    localStatusBefore: before?.status ?? null,
    orderId: orderId ?? null,
    resumeAttemptKey,
    selectionId,
    status: resolvedStatus,
  });
};

export const handleResumeBillingFailure = async ({
  admin,
  attemptId,
  errorMessage,
  selection,
  source,
}: {
  admin: ShopifyAdminGraphql;
  attemptId: string | null;
  errorMessage: string;
  selection: SubscriptionMealSelection;
  source: string;
}) => {
  if (!selection.resumeAttemptKey) {
    return;
  }

  console.log("[resumeBilling] failure handling start", {
    attemptId,
    localActive: selection.active,
    localStatus: selection.status,
    resumeAttemptKey: selection.resumeAttemptKey,
    selectionId: selection.id,
    source,
  });

  if (selection.subscriptionContractId) {
    const pauseResult = await pauseSubscriptionContractOnShopify(
      admin,
      selection.subscriptionContractId,
    );

    console.log("[resumeBilling] contract pause after billing failure", {
      pauseError: pauseResult.error ?? null,
      selectionId: selection.id,
      source,
    });
  }

  await releaseResumeBillingLock({
    attemptId,
    errorMessage,
    orderId: null,
    resumeAttemptKey: selection.resumeAttemptKey,
    selectionId: selection.id,
    status: RESUME_LOCK_STATUS.FAILED,
  });
};

export const setResumeBillingProcessingLock = async ({
  resumeAttemptKey,
  selectionId,
}: {
  resumeAttemptKey: string;
  selectionId: string;
}) => {
  const startedAt = new Date();
  const before = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  console.log("[resumeBilling] local status before processing lock", {
    active: before?.active ?? null,
    resumeAttemptStatus: before?.resumeAttemptStatus ?? null,
    selectionId,
    status: before?.status ?? null,
  });

  await db.subscriptionMealSelection.update({
    data: {
      active: false,
      lastBillingAttemptAt: startedAt,
      lastBillingAttemptError: null,
      lastBillingAttemptId: null,
      lastBillingAttemptStatus: RESUME_LOCK_STATUS.PROCESSING,
      resumeAttemptKey,
      resumeAttemptStartedAt: startedAt,
      resumeAttemptStatus: RESUME_LOCK_STATUS.PROCESSING,
      status: "paused",
    },
    where: { id: selectionId },
  });

  console.log("[resumeBilling] processing lock acquired", {
    idempotencyKey: buildResumeBillingIdempotencyKey(
      selectionId,
      resumeAttemptKey,
      before?.resumeAttemptRetryNumber ?? 1,
    ),
    resumeAttemptKey,
    selectionId,
  });
};

export const prepareResumeBillingFlow = async ({
  admin,
  idempotencyKey,
  resumeAttemptKey,
  selectionId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  idempotencyKey: string;
  resumeAttemptKey: string;
  selectionId: string;
  subscriptionContractId: string;
}): Promise<ResumeBillingPrepareResult> => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection || !isCurrentResumeAttempt(selection, resumeAttemptKey)) {
    console.log("[resumeBilling] prepare: no matching resume attempt, proceeding", {
      idempotencyKey,
      resumeAttemptKey,
      selectionId,
    });
    return { action: "proceed" };
  }

  console.log("[resumeBilling] prepare: existing attempt state", {
    idempotencyKey,
    resumeAttemptBillingAttemptId: selection.resumeAttemptBillingAttemptId,
    resumeAttemptKey: selection.resumeAttemptKey,
    resumeAttemptOrderId: selection.resumeAttemptOrderId,
    resumeAttemptStartedAt: selection.resumeAttemptStartedAt?.toISOString() ?? null,
    resumeAttemptStatus: selection.resumeAttemptStatus,
    selectionId,
  });

  if (isResumeAttemptInFlight(selection)) {
    console.log("[resumeBilling] prepare: blocked — resume attempt in flight", {
      idempotencyKey,
      resumeAttemptKey,
      selectionId,
    });
    return { action: "block_processing" };
  }

  if (isResumeProcessingActive(selection)) {
    console.log("[resumeBilling] prepare: blocked — actively processing", {
      idempotencyKey,
      resumeAttemptKey,
      selectionId,
    });
    return { action: "block_processing" };
  }

  if (
    selection.resumeAttemptOrderId &&
    (selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SUCCEEDED ||
      selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED)
  ) {
    console.log("[resumeBilling] prepare: order already exists for current cycle", {
      idempotencyKey,
      orderId: selection.resumeAttemptOrderId,
      resumeAttemptKey,
      resumeAttemptStatus: selection.resumeAttemptStatus,
      selectionId,
    });

    const payment = {
      attemptId:
        selection.resumeAttemptBillingAttemptId ??
        selection.resumeAttemptOrderId,
      orderId: selection.resumeAttemptOrderId,
      paymentAt: selection.resumeAttemptStartedAt ?? new Date(),
    };

    if (selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED) {
      return {
        action: "retry_schedule_only",
        ...payment,
      };
    }

    return {
      action: "billing_already_succeeded",
      ...payment,
    };
  }

  const reconcileFromAttempt = async (
    attempt: SubscriptionBillingAttemptPayload | null,
    source: string,
  ): Promise<ResumeBillingPrepareResult | null> => {
    if (!attempt) {
      console.log("[resumeBilling] prepare: no attempt to reconcile", {
        idempotencyKey,
        resumeAttemptKey,
        selectionId,
        source,
      });
      return null;
    }

    const payment = extractAttemptPayment(
      attempt,
      selection.resumeAttemptStartedAt ?? new Date(),
    );
    const { status, errorMessage } = resolveBillingAttemptStatus([], attempt);

    console.log("[resumeBilling] prepare: reconciled attempt", {
      attemptId: attempt.id ?? null,
      idempotencyKey,
      orderId: payment?.orderId ?? null,
      resumeAttemptKey,
      selectionId,
      source,
      status,
    });

    if (payment) {
      const lockStatus =
        selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED
          ? RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED
          : RESUME_LOCK_STATUS.SUCCEEDED;

      await releaseResumeBillingLock({
        attemptId: payment.attemptId,
        errorMessage: null,
        orderId: payment.orderId,
        resumeAttemptKey,
        selectionId,
        status: lockStatus,
      });

      if (lockStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED) {
        return {
          action: "retry_schedule_only",
          ...payment,
        };
      }

      return {
        action: "billing_already_succeeded",
        ...payment,
      };
    }

    if (status === "failure" || status === "unknown") {
      const fresh = await bumpResumeRetryGeneration({
        oldAttemptId: attempt.id,
        oldIdempotencyKey: idempotencyKey,
        resumeAttemptKey,
        selection,
        selectionId,
      });

      await releaseResumeBillingLock({
        attemptId: attempt.id ?? null,
        errorMessage: errorMessage ?? "La tentative de paiement a échoué.",
        resumeAttemptKey,
        selectionId,
        status: RESUME_LOCK_STATUS.FAILED,
      });

      return {
        action: "proceed",
        idempotencyKey: fresh.idempotencyKey,
        isFreshRetry: true,
        retryNumber: fresh.retryNumber,
      };
    }

    if (
      status === "submitted" &&
      isWithinMs(selection.resumeAttemptStartedAt, RESUME_PROCESSING_TIMEOUT_MS)
    ) {
      console.log("[resumeBilling] prepare: blocked — Shopify attempt still processing", {
        attemptId: attempt.id ?? null,
        idempotencyKey,
        resumeAttemptKey,
        selectionId,
        source,
      });
      await releaseResumeBillingLock({
        attemptId: attempt.id ?? null,
        errorMessage: null,
        resumeAttemptKey,
        selectionId,
        status: RESUME_LOCK_STATUS.PROCESSING,
      });
      return { action: "block_processing" };
    }

    return null;
  };

  if (selection.resumeAttemptBillingAttemptId) {
    const attempt = await fetchShopifyBillingAttempt(
      admin,
      selection.resumeAttemptBillingAttemptId,
    );
    const fromAttempt = await reconcileFromAttempt(attempt, "billing_attempt_fetch");

    if (fromAttempt) {
      return fromAttempt;
    }
  }

  if (selection.resumeAttemptStatus !== RESUME_LOCK_STATUS.FAILED) {
    const reconciled = await reconcileBillingAttemptByIdempotencyKey({
      admin,
      idempotencyKey,
      subscriptionContractId,
    });
    const fromReconcile = await reconcileFromAttempt(
      reconciled.attempt,
      "idempotency_reconcile",
    );

    if (fromReconcile) {
      return fromReconcile;
    }
  } else if (!selection.resumeAttemptBillingAttemptId) {
    const fresh = await bumpResumeRetryGeneration({
      oldIdempotencyKey: idempotencyKey,
      resumeAttemptKey,
      selection,
      selectionId,
    });

    return {
      action: "proceed",
      idempotencyKey: fresh.idempotencyKey,
      isFreshRetry: true,
      retryNumber: fresh.retryNumber,
    };
  }

  console.log("[resumeBilling] prepare: proceeding with billing attempt", {
    idempotencyKey,
    resumeAttemptKey,
    selectionId,
  });

  return { action: "proceed" };
};

export const isRecentBillingAttempt = (lastBillingAttemptAt: Date | null) => {
  if (!lastBillingAttemptAt) {
    return false;
  }

  return (
    Date.now() - lastBillingAttemptAt.getTime() <
    RECENT_BILLING_ATTEMPT_WINDOW_MS
  );
};

const getBillingAttemptOrderId = (
  attempt: SubscriptionBillingAttemptPayload | null | undefined,
) => attempt?.order?.id ?? null;

export const getSelectionSkipReason = (
  selection: {
    active: boolean;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    nextBillingDate: Date | null;
    resumeAttemptKey: string | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStartedAt: Date | null;
    resumeAttemptStatus: string | null;
    status: string;
    subscriptionContractId: string | null;
  },
  recovery?: {
    failureCount: number;
    nextRetryAt: Date | null;
    status: string;
  } | null,
): BillingSkipReason | null => {
  if (!selection.subscriptionContractId) {
    return "missing_contract_id";
  }

  if (isTerminalSubscriptionSelectionStatus(selection.status)) {
    return "terminal_contract";
  }

  if (recovery && isSelectionOwnedByRecoveryRetry(recovery)) {
    return "payment_recovery";
  }

  if (!selection.active || selection.status !== "active") {
    return "paused_or_inactive";
  }

  if (
    selection.resumeAttemptStatus === RESUME_LOCK_STATUS.SCHEDULE_UPDATE_FAILED
  ) {
    return "recent_attempt";
  }

  if (isResumeAttemptInFlight(selection)) {
    return "recent_attempt";
  }

  if (isResumeProcessingActive(selection)) {
    return "recent_attempt";
  }

  if (recovery && recovery.failureCount > 0) {
    const openRecoveryStatuses = new Set([
      "processing",
      "retry_scheduled",
      "payment_method_update_needed",
      "email_send_failed",
    ]);

    if (openRecoveryStatuses.has(recovery.status)) {
      if (recovery.status === "processing") {
        return "payment_recovery";
      }

      if (recovery.nextRetryAt && recovery.nextRetryAt.getTime() > Date.now()) {
        return "payment_recovery";
      }

      if (recovery.failureCount < 3) {
        return "payment_recovery";
      }
    }
  }

  if (!selection.nextBillingDate) {
    return "missing_next_billing_date";
  }

  if (selection.nextBillingDate.getTime() > Date.now()) {
    return "next_billing_date_in_future";
  }

  if (isRecentBillingAttempt(selection.lastBillingAttemptAt)) {
    const status = selection.lastBillingAttemptStatus;

    if (
      status === RESUME_LOCK_STATUS.FAILED ||
      status === "failure"
    ) {
      return null;
    }

    if (
      status === "submitted" ||
      status === "challenged" ||
      status === RESUME_LOCK_STATUS.PROCESSING
    ) {
      return "recent_attempt";
    }

    return "recent_attempt";
  }

  return null;
};

const formatProcessingError = (
  processingError?: {
    code?: string | null;
    message?: string | null;
  } | null,
) => {
  if (processingError?.code || processingError?.message) {
    return [processingError.code, processingError.message]
      .filter(Boolean)
      .join(": ");
  }

  return null;
};

export const resolveBillingAttemptStatus = (
  userErrors: { message?: string | null }[],
  attempt: SubscriptionBillingAttemptPayload | null | undefined,
): {
  errorCode: string | null;
  errorMessage: string | null;
  status: BillingAttemptStatus;
} => {
  if (userErrors.length > 0) {
    return {
      errorCode: null,
      errorMessage:
        userErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Shopify a refusé la tentative de facturation.",
      status: "failure",
    };
  }

  const processingErrorMessage = formatProcessingError(attempt?.processingError);

  if (processingErrorMessage) {
    return {
      errorCode: attempt?.processingError?.code ?? null,
      errorMessage: processingErrorMessage,
      status: "failure",
    };
  }

  const orderId = getBillingAttemptOrderId(attempt);

  if (orderId) {
    return { errorCode: null, errorMessage: null, status: "success" };
  }

  if (attempt?.completedAt) {
    return { errorCode: null, errorMessage: null, status: "success" };
  }

  if (attempt?.id) {
    return { errorCode: null, errorMessage: null, status: "submitted" };
  }

  return {
    errorCode: null,
    errorMessage: "État de facturation indéterminé.",
    status: "unknown",
  };
};

const createBillingAttempt = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
  idempotencyKey: string,
) => {
  const response = await admin.graphql(billingAttemptCreateMutation, {
    variables: {
      subscriptionBillingAttemptInput: { idempotencyKey },
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });

  return (await response.json()) as BillingAttemptCreateResponse;
};

export type TriggerBillingAttemptResult = {
  attemptId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  orderId: string | null;
  paymentAt: Date | null;
  status: BillingAttemptStatus;
};

export const triggerSubscriptionBillingAttempt = async ({
  admin,
  idempotencyKey,
  selectionId,
  shop,
  subscriptionContractId,
  syncNextBillingDateFromShopify = true,
}: {
  admin: ShopifyAdminGraphql;
  idempotencyKey: string;
  selectionId: string;
  shop?: string;
  subscriptionContractId: string;
  syncNextBillingDateFromShopify?: boolean;
}): Promise<TriggerBillingAttemptResult> => {
  const attemptedAt = new Date();

  try {
    const json = await createBillingAttempt(
      admin,
      subscriptionContractId,
      idempotencyKey,
    );

    if (json.errors?.length) {
      const errorMessage =
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors du déclenchement.";

      await db.subscriptionMealSelection.update({
        data: {
          lastBillingAttemptAt: attemptedAt,
          lastBillingAttemptError: errorMessage,
          lastBillingAttemptId: null,
          lastBillingAttemptStatus: "failure",
        },
        where: { id: selectionId },
      });

      return {
        attemptId: null,
        errorCode: null,
        errorMessage,
        orderId: null,
        paymentAt: null,
        status: "failure",
      };
    }

    const result = json.data?.subscriptionBillingAttemptCreate;
    const userErrors = result?.userErrors ?? [];
    const attempt = result?.subscriptionBillingAttempt;
    const { errorCode, errorMessage, status } = resolveBillingAttemptStatus(
      userErrors,
      attempt,
    );
    const attemptId = attempt?.id ?? null;
    const orderId = getBillingAttemptOrderId(attempt);
    const paymentAt =
      parseShopifyDateTime(attempt?.completedAt) ??
      (orderId ? attemptedAt : null);

    if (status === "failure" || status === "unknown") {
      await db.subscriptionMealSelection.update({
        data: {
          lastBillingAttemptAt: attemptedAt,
          lastBillingAttemptError: errorMessage,
          lastBillingAttemptId: attemptId,
          lastBillingAttemptStatus: status,
        },
        where: { id: selectionId },
      });

      return {
        attemptId,
        errorCode,
        errorMessage,
        orderId,
        paymentAt,
        status,
      };
    }

    const nextBillingDate =
      syncNextBillingDateFromShopify && status === "success"
        ? await fetchSubscriptionContractNextBillingDate(
            admin,
            subscriptionContractId,
          )
        : null;

    await db.subscriptionMealSelection.update({
      data: {
        lastBillingAttemptAt: attemptedAt,
        lastBillingAttemptError: null,
        lastBillingAttemptId: attemptId,
        lastBillingAttemptStatus: status,
        ...(nextBillingDate ? { nextBillingDate } : {}),
      },
      where: { id: selectionId },
    });

    return {
      attemptId,
      errorCode: null,
      errorMessage: null,
      orderId,
      paymentAt,
      status,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Impossible de contacter Shopify pour déclencher la facturation.";

    captureTechnicalError(error, {
      errorCode: "billing_attempt_throw",
      selectionId,
      shop,
      source: "billing",
      subscriptionContractId,
    });

    await db.subscriptionMealSelection.update({
      data: {
        lastBillingAttemptAt: attemptedAt,
        lastBillingAttemptError: errorMessage,
        lastBillingAttemptId: null,
        lastBillingAttemptStatus: "failure",
      },
      where: { id: selectionId },
    });

    return {
      attemptId: null,
      errorCode: null,
      errorMessage,
      orderId: null,
      paymentAt: null,
      status: "failure",
    };
  }
};

export const getBillingRunnerDeliveryGate = ({
  now = new Date(),
  selection,
}: {
  now?: Date;
  selection: {
    nextBillingDate: Date | null;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
  };
}): {
  readiness: ReturnType<typeof evaluateDeliveryBillingReadiness>;
  shouldRealignLegacyBillingDate: boolean;
  skipReason: BillingSkipReason | null;
} => {
  const readiness = evaluateDeliveryBillingReadiness({
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
    now,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
  });

  console.log("[BILLING_RUNNER] cycle_gate", {
    billingReadyAt: readiness.billingReadyAt?.toISOString() ?? null,
    billingTargetDeliveryDate: readiness.billingTargetDeliveryDate,
    deliveryReady: readiness.isReady,
    projectedActiveDeliveryDate: readiness.projectedActiveDeliveryDate,
    readinessReason: readiness.reason,
    selectionNextBillingDate: selection.nextBillingDate?.toISOString() ?? null,
    skipReason: null,
  });

  return {
    readiness,
    shouldRealignLegacyBillingDate: false,
    skipReason: null,
  };
};

/** Historical J-2 realign. Kept for audits. Not called by processDueSubscriptionBillings. */
export const realignLegacyNextBillingDateFromDeliverySchedule = async ({
  admin,
  billingReadyAt,
  selectionId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  billingReadyAt: Date;
  selectionId: string;
  subscriptionContractId: string;
}) => {
  try {
    const shopifyUpdate = await setSubscriptionContractNextBillingDate(
      admin,
      subscriptionContractId,
      billingReadyAt,
    );

    if (!shopifyUpdate.ok) {
      console.log("[BILLING_RUNNER] legacy realignment failed", {
        error: shopifyUpdate.error,
        selectionId,
        subscriptionContractId,
        targetNextBillingDate: billingReadyAt.toISOString(),
      });
      return;
    }

    await db.subscriptionMealSelection.update({
      data: { nextBillingDate: shopifyUpdate.nextBillingDate },
      where: { id: selectionId },
    });

    console.log("[BILLING_RUNNER] legacy nextBillingDate realigned", {
      alignedNextBillingDate: shopifyUpdate.nextBillingDate.toISOString(),
      selectionId,
      subscriptionContractId,
    });
  } catch (error) {
    console.log("[BILLING_RUNNER] legacy realignment failed", {
      error: error instanceof Error ? error.message : error,
      selectionId,
      subscriptionContractId,
      targetNextBillingDate: billingReadyAt.toISOString(),
    });
  }
};

export const processDueSubscriptionBillings = async (
  shop: string,
): Promise<BillingWorkerSummary> => {
  const { admin } = await unauthenticated.admin(shop);

  const recoverySummary = await processDueRecoveryRetries(shop, admin);

  const summary: BillingWorkerSummary = {
    errors: 0,
    processed: 0,
    recovery: recoverySummary,
    skipped: 0,
    skipReasons: EMPTY_SKIP_REASONS(),
    submitted: 0,
    success: 0,
  };

  const activeRecoveries = await db.subscriptionPaymentRecovery.findMany({
    where: {
      shop,
      status: {
        in: [
          "processing",
          "retry_scheduled",
          "payment_method_update_needed",
          "email_send_failed",
        ],
      },
    },
  });
  const recoveryBySelectionId = new Map(
    activeRecoveries.map((recovery) => [
      recovery.subscriptionMealSelectionId,
      recovery,
    ]),
  );

  const selections = await db.subscriptionMealSelection.findMany({
    where: { shop },
  });

  // BOX-CHANGE-4/5: load apply helper once per cron run (dynamic import avoids ESM TDZ
  // cycle: billingWorker → boxChange → modificationBlock → billingWorker).
  const {
    applyPendingSubscriptionBoxChangeForBilling,
    isBillingAllowedAfterBoxChangeApply,
  } = await import("./subscriptionBoxChange.server");

  for (const selection of selections) {
    let currentSelection = selection;
    const activeRecovery =
      recoveryBySelectionId.get(currentSelection.id) ?? null;

    if (!currentSelection.subscriptionContractId) {
      try {
        const pendingReconciliation = await reconcilePendingContractForSelection({
          admin,
          isSubscription: true,
          rawOrder: null,
          selectionId: currentSelection.id,
          shop,
          shopifyOrderId: currentSelection.shopifyOrderId,
        });

        if (pendingReconciliation.selection) {
          currentSelection = pendingReconciliation.selection;
          console.log("[SUBSCRIPTION_SELECTION] billing worker contract reconciled", {
            action: "reconcile_pending_contract",
            reason: pendingReconciliation.reason,
            selectionId: currentSelection.id,
            source: pendingReconciliation.source,
            subscriptionContractId: currentSelection.subscriptionContractId,
          });
        }
      } catch (error) {
        console.log("[SUBSCRIPTION_SELECTION] billing worker reconciliation failed", {
          error: error instanceof Error ? error.message : error,
          selectionId: currentSelection.id,
        });
      }
    }

    if (isSelectionOwnedByRecoveryRetry(activeRecovery)) {
      console.log(
        "[paymentRecovery] normal worker skipped due to active recovery",
        {
          failureCount: activeRecovery?.failureCount ?? null,
          recoveryStatus: activeRecovery?.status ?? null,
          selectionId: currentSelection.id,
          source: "cron_billing",
        },
      );
      summary.skipped += 1;
      summary.skipReasons.payment_recovery += 1;
      continue;
    }

    if (
      isRecentBillingAttempt(currentSelection.lastBillingAttemptAt) &&
      currentSelection.lastBillingAttemptId
    ) {
      const reconciled = await reconcileSelectionBillingAttemptState({
        admin,
        selection: currentSelection,
      });

      if (reconciled) {
        currentSelection = reconciled;

        const freshRecovery = await db.subscriptionPaymentRecovery.findFirst({
          where: {
            shop,
            status: {
              in: [
                "processing",
                "retry_scheduled",
                "payment_method_update_needed",
                "email_send_failed",
              ],
            },
            subscriptionMealSelectionId: currentSelection.id,
          },
        });

        if (freshRecovery) {
          recoveryBySelectionId.set(currentSelection.id, freshRecovery);
        }
      }
    }

    const preSyncSkipReason = getSelectionSkipReason(
      currentSelection,
      recoveryBySelectionId.get(currentSelection.id) ?? null,
    );

    if (preSyncSkipReason) {
      if (preSyncSkipReason === "terminal_contract") {
        console.log("[SUBSCRIPTION_CONTRACT_SYNC] cron skipped terminal contract", {
          selectionId: currentSelection.id,
          skipReason: preSyncSkipReason,
          status: currentSelection.status,
          subscriptionContractId: currentSelection.subscriptionContractId,
        });
      }

      summary.skipped += 1;
      summary.skipReasons[preSyncSkipReason] += 1;
      continue;
    }

    let contractSyncFailed = false;

    if (currentSelection.subscriptionContractId) {
      try {
        const syncResult = await syncSubscriptionContractState({
          admin,
          shop,
          source: "cron",
          subscriptionContractId: currentSelection.subscriptionContractId,
        });

        if (
          syncResult.action === "error" ||
          (syncResult.action === "skipped" &&
            syncResult.reason === "unsupported_shopify_status")
        ) {
          contractSyncFailed = true;
          console.log(
            "[SUBSCRIPTION_CONTRACT_SYNC] cron billing blocked — contract sync failed",
            {
              error: syncResult.reason,
              selectionId: currentSelection.id,
              shop,
              source: "cron",
              subscriptionContractId: currentSelection.subscriptionContractId,
              syncAction: syncResult.action,
            },
          );
        } else if (syncResult.selection) {
          currentSelection = syncResult.selection;
        }
      } catch (error) {
        contractSyncFailed = true;
        console.log(
          "[SUBSCRIPTION_CONTRACT_SYNC] cron billing blocked — contract sync failed",
          {
            error: error instanceof Error ? error.message : error,
            selectionId: currentSelection.id,
            shop,
            source: "cron",
            subscriptionContractId: currentSelection.subscriptionContractId,
          },
        );
      }
    }

    if (contractSyncFailed) {
      summary.skipped += 1;
      summary.skipReasons.contract_sync_error += 1;
      continue;
    }

    const skipReason = getSelectionSkipReason(
      currentSelection,
      recoveryBySelectionId.get(currentSelection.id) ?? null,
    );

    if (skipReason) {
      if (skipReason === "terminal_contract") {
        console.log("[SUBSCRIPTION_CONTRACT_SYNC] cron skipped terminal contract", {
          selectionId: currentSelection.id,
          skipReason,
          status: currentSelection.status,
          subscriptionContractId: currentSelection.subscriptionContractId,
        });
      }

      summary.skipped += 1;
      summary.skipReasons[skipReason] += 1;
      continue;
    }

    const deliveryGate = getBillingRunnerDeliveryGate({
      selection: {
        nextBillingDate: currentSelection.nextBillingDate,
        nextScheduledDeliveryDate: currentSelection.nextScheduledDeliveryDate,
        preferredDeliveryWeekday: currentSelection.preferredDeliveryWeekday,
      },
    });

    if (deliveryGate.skipReason) {
      summary.skipped += 1;
      summary.skipReasons[deliveryGate.skipReason] += 1;
      continue;
    }

    // BOX-CHANGE-4/5: apply matching pending before billing attempt.
    // Never on recovery path (already skipped above via payment_recovery).
    // Fail-closed: only explicit allowlist outcomes may bill.
    const boxChangeApply = await applyPendingSubscriptionBoxChangeForBilling({
      admin,
      markMealSelectionExplicit: async (selectionId) => {
        await markMealSelectionExplicitForCurrentDelivery({ selectionId });
      },
      selection: currentSelection,
    });

    if (!isBillingAllowedAfterBoxChangeApply(boxChangeApply)) {
      console.log("[BOX_CHANGE_APPLY] billing skipped after apply gate", {
        outcome: boxChangeApply.outcome,
        pendingId: boxChangeApply.pendingId,
        reason: boxChangeApply.reason ?? null,
        selectionId: currentSelection.id,
        source: "cron",
      });
      summary.skipped += 1;
      summary.skipReasons.pending_box_change += 1;
      continue;
    }

    if (boxChangeApply.selection) {
      currentSelection = boxChangeApply.selection;
    }

    summary.processed += 1;
    const idempotencyKey = buildAutoBillingIdempotencyKey(currentSelection.id);

    const billingResult = await triggerSubscriptionBillingAttempt({
      admin,
      idempotencyKey,
      selectionId: currentSelection.id,
      shop,
      subscriptionContractId: currentSelection.subscriptionContractId!,
    });

    if (billingResult.status === "failure" || billingResult.status === "unknown") {
      summary.errors += 1;

      await handleAutomaticBillingFailure({
        admin,
        billingResult,
        selection: currentSelection,
      });
      continue;
    }

    if (billingResult.status === "success" && billingResult.orderId) {
      console.log("[BILLING] succeeded", {
        attemptId: billingResult.attemptId,
        orderId: billingResult.orderId,
        selectionId: currentSelection.id,
        source: "cron",
      });
      summary.success += 1;
    } else if (billingResult.status === "success") {
      summary.success += 1;
    } else {
      console.log("[BILLING] submitted", {
        attemptId: billingResult.attemptId,
        selectionId: currentSelection.id,
        source: "cron",
      });
      summary.submitted += 1;
    }
  }

  return summary;
};
