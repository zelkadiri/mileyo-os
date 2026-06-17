import db from "../db.server";
import { unauthenticated } from "../shopify.server";

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

const subscriptionContractQuery = `#graphql
  query SubscriptionContractNextBilling($id: ID!) {
    subscriptionContract(id: $id) {
      id
      nextBillingDate
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

export type BillingSkipReason =
  | "paused_or_inactive"
  | "missing_contract_id"
  | "missing_next_billing_date"
  | "next_billing_date_in_future"
  | "recent_attempt";

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
};

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

/** Skip re-billing if an attempt was made within this window. */
export const RECENT_BILLING_ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

const EMPTY_SKIP_REASONS = (): Record<BillingSkipReason, number> => ({
  missing_contract_id: 0,
  missing_next_billing_date: 0,
  next_billing_date_in_future: 0,
  paused_or_inactive: 0,
  recent_attempt: 0,
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

const getTodayIsoDate = () => new Date().toISOString().slice(0, 10);

const buildAutoBillingIdempotencyKey = (selectionId: string) =>
  `mileyo_auto_${selectionId}_${getTodayIsoDate()}`;

const isRecentBillingAttempt = (lastBillingAttemptAt: Date | null) => {
  if (!lastBillingAttemptAt) {
    return false;
  }

  return (
    Date.now() - lastBillingAttemptAt.getTime() <
    RECENT_BILLING_ATTEMPT_WINDOW_MS
  );
};

export const getSelectionSkipReason = (selection: {
  active: boolean;
  lastBillingAttemptAt: Date | null;
  nextBillingDate: Date | null;
  status: string;
  subscriptionContractId: string | null;
}): BillingSkipReason | null => {
  if (!selection.subscriptionContractId) {
    return "missing_contract_id";
  }

  if (!selection.active || selection.status !== "active") {
    return "paused_or_inactive";
  }

  if (!selection.nextBillingDate) {
    return "missing_next_billing_date";
  }

  if (selection.nextBillingDate.getTime() > Date.now()) {
    return "next_billing_date_in_future";
  }

  if (isRecentBillingAttempt(selection.lastBillingAttemptAt)) {
    return "recent_attempt";
  }

  return null;
};

const getBillingAttemptOrderId = (
  attempt: SubscriptionBillingAttemptPayload | null | undefined,
) => attempt?.order?.id ?? null;

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
): { status: BillingAttemptStatus; errorMessage: string | null } => {
  if (userErrors.length > 0) {
    return {
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
      errorMessage: processingErrorMessage,
      status: "failure",
    };
  }

  const orderId = getBillingAttemptOrderId(attempt);

  if (orderId) {
    return { errorMessage: null, status: "success" };
  }

  if (attempt?.completedAt) {
    return { errorMessage: null, status: "success" };
  }

  if (attempt?.id) {
    return { errorMessage: null, status: "submitted" };
  }

  return {
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

export const processDueSubscriptionBillings = async (
  shop: string,
): Promise<BillingWorkerSummary> => {
  const { admin } = await unauthenticated.admin(shop);

  const summary: BillingWorkerSummary = {
    errors: 0,
    processed: 0,
    skipped: 0,
    skipReasons: EMPTY_SKIP_REASONS(),
    submitted: 0,
    success: 0,
  };

  const selections = await db.subscriptionMealSelection.findMany({
    where: { shop },
  });

  for (const selection of selections) {
    const skipReason = getSelectionSkipReason(selection);

    if (skipReason) {
      summary.skipped += 1;
      summary.skipReasons[skipReason] += 1;
      continue;
    }

    summary.processed += 1;
    const attemptedAt = new Date();
    const idempotencyKey = buildAutoBillingIdempotencyKey(selection.id);

    try {
      const json = await createBillingAttempt(
        admin,
        selection.subscriptionContractId!,
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
          where: { id: selection.id },
        });
        summary.errors += 1;
        continue;
      }

      const result = json.data?.subscriptionBillingAttemptCreate;
      console.log(
        "[BILLING_WORKER] billing attempt raw result",
        JSON.stringify(result, null, 2),
      );

      const userErrors = result?.userErrors ?? [];
      const attempt = result?.subscriptionBillingAttempt;
      const { status, errorMessage } = resolveBillingAttemptStatus(
        userErrors,
        attempt,
      );
      const attemptId = attempt?.id ?? null;

      if (status === "failure" || status === "unknown") {
        await db.subscriptionMealSelection.update({
          data: {
            lastBillingAttemptAt: attemptedAt,
            lastBillingAttemptError: errorMessage,
            lastBillingAttemptId: attemptId,
            lastBillingAttemptStatus: status,
          },
          where: { id: selection.id },
        });
        summary.errors += 1;
        continue;
      }

      const nextBillingDate =
        status === "success"
          ? await fetchSubscriptionContractNextBillingDate(
              admin,
              selection.subscriptionContractId!,
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
        where: { id: selection.id },
      });

      if (status === "success") {
        summary.success += 1;
      } else {
        summary.submitted += 1;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Impossible de contacter Shopify pour déclencher la facturation.";

      await db.subscriptionMealSelection.update({
        data: {
          lastBillingAttemptAt: attemptedAt,
          lastBillingAttemptError: errorMessage,
          lastBillingAttemptId: null,
          lastBillingAttemptStatus: "failure",
        },
        where: { id: selection.id },
      });
      summary.errors += 1;
    }
  }

  return summary;
};
