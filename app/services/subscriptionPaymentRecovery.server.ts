import type { SubscriptionMealSelection } from "@prisma/client";

import { isTerminalSubscriptionSelectionStatus } from "../constants/subscriptionMealSelection";
import {
  ACTIVE_RECOVERY_STATUSES,
  isOpenRecoveryStatus,
  MAX_RECOVERY_FAILURES,
  PAYMENT_EMAIL_COOLDOWN_MS,
  RECOVERY_STATUS,
  type PaymentUpdateUnavailableReason,
  type RecoveryStatus,
} from "../constants/subscriptionPaymentRecovery";
import db from "../db.server";
import {
  buildPaymentFailedEmailData,
  buildPaymentRecoveredEmailData,
  isMileyoTransactionalEmailEnabled,
  formatPaymentEmailDateTime,
  resolvePaymentEmailRecipient,
  sendEmail,
  shouldSendPaymentFailedEmail,
  shouldSendPaymentRecoveredEmail,
  trySendSubscriptionPausedEmail,
} from "./email/email.server";
import { computeNextSubscriptionCycleRetryAt } from "../utils/subscriptionCycleBilling";
import {
  fetchShopifyBillingAttempt,
  isResumeRenewalOrder,
  resolveBillingAttemptStatus,
  toSubscriptionContractGid,
  triggerSubscriptionBillingAttempt,
  type ShopifyAdminGraphql,
  type TriggerBillingAttemptResult,
} from "./subscriptionBillingWorker.server";

export {
  isOpenRecoveryStatus,
  MAX_RECOVERY_FAILURES,
  PAYMENT_EMAIL_COOLDOWN_MS,
  RECOVERY_STATUS,
  type PaymentUpdateUnavailableReason,
  type RecoveryStatus,
} from "../constants/subscriptionPaymentRecovery";

export const resolvePaymentRecoveryNextRetryAt = ({
  nextFailureCount,
  reference,
}: {
  nextFailureCount: number;
  reference: Date;
}): Date | null => {
  if (nextFailureCount >= MAX_RECOVERY_FAILURES) {
    return null;
  }

  if (nextFailureCount !== 1 && nextFailureCount !== 2) {
    return null;
  }

  return computeNextSubscriptionCycleRetryAt(reference, nextFailureCount);
};

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

const subscriptionContractPaymentMethodQuery = `#graphql
  query SubscriptionContractPaymentMethod($id: ID!) {
    subscriptionContract(id: $id) {
      id
      customerPaymentMethod {
        id
      }
    }
  }
`;

const customerPaymentMethodSendUpdateEmailMutation = `#graphql
  mutation CustomerPaymentMethodSendUpdateEmail($customerPaymentMethodId: ID!) {
    customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $customerPaymentMethodId) {
      customer {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type PaymentMethodQueryResponse = {
  data?: {
    subscriptionContract?: {
      customerPaymentMethod?: { id?: string | null } | null;
    } | null;
  };
  errors?: { message?: string | null }[];
};

type PaymentEmailMutationResponse = {
  data?: {
    customerPaymentMethodSendUpdateEmail?: {
      customer?: { id?: string | null } | null;
      userErrors?: { field?: string[] | null; message?: string | null }[];
    } | null;
  };
  errors?: { message?: string | null }[];
};

export const isShopifyPaymentUpdateEmailEnabled = () =>
  process.env.ENABLE_SHOPIFY_PAYMENT_UPDATE_EMAIL === "true";

export const buildBillingCycleKey = (
  selectionId: string,
  dueBillingDate: Date | null,
) => {
  if (!dueBillingDate) {
    return `mileyo_cycle_${selectionId}_unknown`;
  }

  return `mileyo_cycle_${selectionId}_${dueBillingDate.toISOString()}`;
};

export const buildRecoveryBillingIdempotencyKey = (
  selectionId: string,
  billingCycleKey: string,
  attemptNumber: number,
) => `mileyo_recovery_${selectionId}_${billingCycleKey}_a${attemptNumber}`;

export const getActiveRecoveryForSelection = async (selectionId: string) =>
  db.subscriptionPaymentRecovery.findFirst({
    orderBy: { updatedAt: "desc" },
    where: {
      status: { in: [...ACTIVE_RECOVERY_STATUSES] },
      subscriptionMealSelectionId: selectionId,
    },
  });

export const getPortalRecoveryForSelection = async (selectionId: string) =>
  db.subscriptionPaymentRecovery.findFirst({
    orderBy: { updatedAt: "desc" },
    where: {
      status: {
        in: [
          RECOVERY_STATUS.RETRY_SCHEDULED,
          RECOVERY_STATUS.PROCESSING,
          RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
          RECOVERY_STATUS.EMAIL_SEND_FAILED,
          RECOVERY_STATUS.FINAL_FAILED,
        ],
      },
      subscriptionMealSelectionId: selectionId,
    },
  });

const pauseSubscriptionContract = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractPauseMutation, {
    variables: {
      subscriptionContractId: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as {
    data?: {
      subscriptionContractPause?: {
        contract?: { id?: string | null } | null;
        userErrors?: { message?: string | null }[];
      } | null;
    };
    errors?: { message?: string | null }[];
  };

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Erreur GraphQL lors de la mise en pause.",
    };
  }

  const userErrorMessage =
    json.data?.subscriptionContractPause?.userErrors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(" ") ?? "";

  if (userErrorMessage) {
    return { error: userErrorMessage };
  }

  return { ok: true as const };
};

const fetchContractPaymentMethodId = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractPaymentMethodQuery, {
    variables: {
      id: toSubscriptionContractGid(subscriptionContractId),
    },
  });
  const json = (await response.json()) as PaymentMethodQueryResponse;

  if (json.errors?.length) {
    return {
      error:
        json.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(" ") || "Impossible de lire le moyen de paiement.",
    };
  }

  const paymentMethodId =
    json.data?.subscriptionContract?.customerPaymentMethod?.id ?? null;

  if (!paymentMethodId) {
    return { error: "Aucun moyen de paiement associé au contrat." };
  }

  return { paymentMethodId };
};

export type PaymentUpdateEligibility = {
  available: boolean;
  reason: PaymentUpdateUnavailableReason;
};

export const resolvePaymentUpdateEligibility = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
): Promise<PaymentUpdateEligibility> => {
  const paymentMethodResult = await fetchContractPaymentMethodId(
    admin,
    subscriptionContractId,
  );

  if ("paymentMethodId" in paymentMethodResult) {
    return { available: true, reason: null };
  }

  const isMissingPaymentMethod =
    paymentMethodResult.error === "Aucun moyen de paiement associé au contrat.";

  return {
    available: false,
    reason: isMissingPaymentMethod ? "missing_payment_method" : "unsupported",
  };
};

export type SendPaymentUpdateEmailResult =
  | { ok: true; sentAt: Date }
  | { ok: false; error: string; status: RecoveryStatus };

export const sendPaymentUpdateEmailForSelection = async ({
  admin,
  forceResendAfterFailure = false,
  selection,
}: {
  admin: ShopifyAdminGraphql;
  forceResendAfterFailure?: boolean;
  selection: Pick<
    SubscriptionMealSelection,
    "id" | "shop" | "subscriptionContractId"
  >;
}): Promise<SendPaymentUpdateEmailResult> => {
  if (!selection.subscriptionContractId) {
    return {
      error: "Contrat d’abonnement Shopify manquant.",
      ok: false,
      status: RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
    };
  }

  const recovery = await getPortalRecoveryForSelection(selection.id);

  if (recovery?.paymentUpdateEmailSentAt) {
    const elapsed =
      Date.now() - recovery.paymentUpdateEmailSentAt.getTime();

    if (
      elapsed < PAYMENT_EMAIL_COOLDOWN_MS &&
      !(forceResendAfterFailure &&
        recovery.status === RECOVERY_STATUS.EMAIL_SEND_FAILED)
    ) {
      return {
        error:
          "Un email de mise à jour a déjà été envoyé récemment. Réessayez demain.",
        ok: false,
        status: recovery.status as RecoveryStatus,
      };
    }
  }

  const paymentMethodResult = await fetchContractPaymentMethodId(
    admin,
    selection.subscriptionContractId,
  );

  if ("error" in paymentMethodResult) {
    if (recovery) {
      await db.subscriptionPaymentRecovery.update({
        data: {
          lastErrorMessage: paymentMethodResult.error,
          status: RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
        },
        where: { id: recovery.id },
      });
    }

    return {
      error:
        paymentMethodResult.error ??
        "Aucun moyen de paiement associé au contrat.",
      ok: false,
      status: RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
    };
  }

  const sentAt = new Date();

  if (!isShopifyPaymentUpdateEmailEnabled()) {
    console.log("[paymentRecovery] payment update email skipped (disabled)", {
      paymentMethodId: paymentMethodResult.paymentMethodId,
      selectionId: selection.id,
    });

    if (recovery) {
      await db.subscriptionPaymentRecovery.update({
        data: { paymentUpdateEmailSentAt: sentAt },
        where: { id: recovery.id },
      });
    }

    return { ok: true, sentAt };
  }

  const response = await admin.graphql(
    customerPaymentMethodSendUpdateEmailMutation,
    {
      variables: {
        customerPaymentMethodId: paymentMethodResult.paymentMethodId,
      },
    },
  );
  const json = (await response.json()) as PaymentEmailMutationResponse;

  if (json.errors?.length) {
    const error =
      json.errors
        .map((entry) => entry.message)
        .filter(Boolean)
        .join(" ") || "Shopify n’a pas pu envoyer l’email.";

    if (recovery) {
      await db.subscriptionPaymentRecovery.update({
        data: {
          lastErrorMessage: error,
          status: RECOVERY_STATUS.EMAIL_SEND_FAILED,
        },
        where: { id: recovery.id },
      });
    }

    return {
      error,
      ok: false,
      status: RECOVERY_STATUS.EMAIL_SEND_FAILED,
    };
  }

  const userErrors = json.data?.customerPaymentMethodSendUpdateEmail?.userErrors ?? [];
  const userErrorMessage = userErrors
    .map((error) => error.message)
    .filter(Boolean)
    .join(" ");

  if (userErrorMessage) {
    if (recovery) {
      await db.subscriptionPaymentRecovery.update({
        data: {
          lastErrorMessage: userErrorMessage,
          status: RECOVERY_STATUS.EMAIL_SEND_FAILED,
        },
        where: { id: recovery.id },
      });
    }

    return {
      error: userErrorMessage,
      ok: false,
      status: RECOVERY_STATUS.EMAIL_SEND_FAILED,
    };
  }

  if (recovery) {
    await db.subscriptionPaymentRecovery.update({
      data: {
        paymentUpdateEmailSentAt: sentAt,
        status:
          recovery.status === RECOVERY_STATUS.EMAIL_SEND_FAILED
            ? RECOVERY_STATUS.RETRY_SCHEDULED
            : recovery.status,
      },
      where: { id: recovery.id },
    });
  }

  console.log("[paymentRecovery] payment update email sent", {
    paymentMethodId: paymentMethodResult.paymentMethodId,
    selectionId: selection.id,
  });

  return { ok: true, sentAt };
};

const trySendMileyoPaymentFailedEmail = async ({
  recovery,
  selection,
}: {
  recovery: {
    failureCount: number;
    id: string;
    nextRetryAt: Date | null;
    paymentFailedEmailSentAt: Date | null;
  };
  selection: SubscriptionMealSelection;
}) => {
  const order = await db.boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolvePaymentEmailRecipient(
    selection,
    order,
  );

  const eligible = shouldSendPaymentFailedEmail({
    failureCount: recovery.failureCount,
    hasRecipient: Boolean(recipient),
    paymentFailedEmailSentAt: recovery.paymentFailedEmailSentAt,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient) {
    console.log("[paymentRecovery] mileyo payment-failed email skipped", {
      failureCount: recovery.failureCount,
      hasRecipient: Boolean(recipient),
      alreadySent: Boolean(recovery.paymentFailedEmailSentAt),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      recoveryId: recovery.id,
      selectionId: selection.id,
    });
    return;
  }

  const result = await sendEmail({
    data: buildPaymentFailedEmailData({
      customerName,
      failureCount: recovery.failureCount,
      nextRetryAt: formatPaymentEmailDateTime(recovery.nextRetryAt),
      recoveryId: recovery.id,
      subscriptionContractId: selection.subscriptionContractId,
    }),
    subject: "Votre paiement d’abonnement n’a pas abouti",
    template: "payment-failed",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[paymentRecovery] mileyo payment-failed email send failed", {
      message: result.message,
      reason: result.reason,
      recoveryId: recovery.id,
      selectionId: selection.id,
    });
    return;
  }

  await db.subscriptionPaymentRecovery.update({
    data: { paymentFailedEmailSentAt: new Date() },
    where: { id: recovery.id },
  });

  console.log("[paymentRecovery] mileyo payment-failed email sent", {
    emailId: result.id,
    recoveryId: recovery.id,
    selectionId: selection.id,
    to: recipient.email,
  });
};

const scheduleRecoveryAfterFailure = async ({
  admin,
  billingCycleKey,
  billingResult,
  selection,
}: {
  admin: ShopifyAdminGraphql;
  billingCycleKey: string;
  billingResult: TriggerBillingAttemptResult;
  dueBillingDate: Date | null;
  selection: SubscriptionMealSelection;
}) => {
  const now = new Date();

  const existing = await db.subscriptionPaymentRecovery.findUnique({
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selection.id,
      },
    },
  });

  if (isRecoveryFailureAlreadyRecorded(existing, billingResult.attemptId)) {
    console.log("[BILLING] duplicate_webhook_ignored", {
      attemptId: billingResult.attemptId,
      billingCycleKey,
      failureCount: existing?.failureCount ?? null,
      selectionId: selection.id,
    });
    return existing;
  }

  const nextFailureCount = (existing?.failureCount ?? 0) + 1;

  if (nextFailureCount > MAX_RECOVERY_FAILURES) {
    return existing;
  }

  const nextRetryAt = resolvePaymentRecoveryNextRetryAt({
    nextFailureCount,
    reference: now,
  });

  const recoveryData = {
    failureCount: nextFailureCount,
    lastBillingAttemptId: billingResult.attemptId,
    lastErrorCode: billingResult.errorCode,
    lastErrorMessage: billingResult.errorMessage,
    lastFailureAt: now,
    nextRetryAt,
    status:
      nextFailureCount >= MAX_RECOVERY_FAILURES
        ? RECOVERY_STATUS.FINAL_FAILED
        : RECOVERY_STATUS.RETRY_SCHEDULED,
  };

  const recovery = existing
    ? await db.subscriptionPaymentRecovery.update({
        data: recoveryData,
        where: { id: existing.id },
      })
    : await db.subscriptionPaymentRecovery.create({
        data: {
          ...recoveryData,
          billingCycleKey,
          shop: selection.shop,
          subscriptionMealSelectionId: selection.id,
        },
      });

  console.log("[paymentRecovery] failure recorded", {
    billingCycleKey,
    failureCount: nextFailureCount,
    lastErrorMessage: billingResult.errorMessage,
    nextRetryAt: nextRetryAt?.toISOString() ?? null,
    selectionId: selection.id,
    status: recovery.status,
  });

  if (nextFailureCount === 1) {
    await sendPaymentUpdateEmailForSelection({ admin, selection });
    await trySendMileyoPaymentFailedEmail({ recovery, selection });
  }

  if (nextFailureCount >= MAX_RECOVERY_FAILURES && selection.subscriptionContractId) {
    const pauseResult = await pauseSubscriptionContract(
      admin,
      selection.subscriptionContractId,
    );

    await db.subscriptionMealSelection.update({
      data: { active: false, status: "paused" },
      where: { id: selection.id },
    });

    await db.subscriptionPaymentRecovery.update({
      data: {
        finalPausedAt: now,
        status: RECOVERY_STATUS.FINAL_FAILED,
        ...(pauseResult.error
          ? {
              lastErrorMessage: `${billingResult.errorMessage ?? "Échec final."} (Pause Shopify : ${pauseResult.error})`,
            }
          : {}),
      },
      where: { id: recovery.id },
    });

    console.log("[paymentRecovery] final failure — subscription paused", {
      billingCycleKey,
      selectionId: selection.id,
    });

    if (!pauseResult.error) {
      try {
        await trySendSubscriptionPausedEmail({
          pauseCause: "payment_final_failure",
          selectionId: selection.id,
        });
      } catch (error) {
        console.log("[paymentRecovery] subscription-paused email failed", {
          error: error instanceof Error ? error.message : error,
          selectionId: selection.id,
        });
      }
    }
  }

  return recovery;
};

export type ProcessBillingAttemptFailureResult =
  | { action: "duplicate_ignored" }
  | { action: "ignored_resume" }
  | {
      action: "recovery_scheduled";
      recovery: Awaited<ReturnType<typeof scheduleRecoveryAfterFailure>>;
    };

export const processBillingAttemptFailure = async ({
  admin,
  billingAttemptId,
  errorCode,
  errorMessage,
  selection,
  source,
}: {
  admin: ShopifyAdminGraphql;
  billingAttemptId: string | null;
  errorCode: string | null;
  errorMessage: string;
  selection: SubscriptionMealSelection;
  source: "cron_reconcile" | "webhook" | "cron";
}): Promise<ProcessBillingAttemptFailureResult> => {
  if (isResumeRenewalOrder(selection)) {
    console.log("[BILLING] failure ignored for resume flow", {
      billingAttemptId,
      selectionId: selection.id,
      source,
    });
    return { action: "ignored_resume" };
  }

  const billingCycleKey = buildBillingCycleKey(
    selection.id,
    selection.nextBillingDate,
  );

  const existing = await db.subscriptionPaymentRecovery.findUnique({
    where: {
      subscriptionMealSelectionId_billingCycleKey: {
        billingCycleKey,
        subscriptionMealSelectionId: selection.id,
      },
    },
  });

  if (isRecoveryFailureAlreadyRecorded(existing, billingAttemptId)) {
    return { action: "duplicate_ignored" };
  }

  if (
    billingAttemptId &&
    selection.lastBillingAttemptId === billingAttemptId &&
    selection.lastBillingAttemptStatus === "failure" &&
    !existing
  ) {
    return { action: "duplicate_ignored" };
  }

  await db.subscriptionMealSelection.update({
    data: {
      lastBillingAttemptAt: new Date(),
      lastBillingAttemptError: errorMessage,
      lastBillingAttemptId: billingAttemptId,
      lastBillingAttemptStatus: "failure",
    },
    where: { id: selection.id },
  });

  const recovery = await scheduleRecoveryAfterFailure({
    admin,
    billingCycleKey,
    billingResult: {
      attemptId: billingAttemptId,
      errorCode,
      errorMessage,
      orderId: null,
      paymentAt: null,
      status: "failure",
    },
    dueBillingDate: selection.nextBillingDate,
    selection,
  });

  console.log("[BILLING] recovery_scheduled", {
    billingAttemptId,
    failureCount: recovery?.failureCount ?? null,
    nextRetryAt: recovery?.nextRetryAt?.toISOString() ?? null,
    recoveryStatus: recovery?.status ?? null,
    selectionId: selection.id,
    source,
  });

  return { action: "recovery_scheduled", recovery };
};

export type RecoveryDiagnosticBranch =
  | "normal_skip"
  | "pending"
  | "recovered"
  | "retry_start"
  | "skipped_inactive"
  | "skipped_resume"
  | "stale_restore"
  | "terminal_contract"
  | "terminal_failure";

export type RecoverySkipReason = "terminal_contract";

const EMPTY_RECOVERY_SKIP_REASONS = (): Record<RecoverySkipReason, number> => ({
  terminal_contract: 0,
});

export type RecoveryDiagnosticItem = {
  branch: RecoveryDiagnosticBranch;
  failureCount: number;
  lastBillingAttemptId: string | null;
  lastBillingAttemptStatus: string | null;
  nextRetryAt: string | null;
  recoveryStatusBefore: string;
  selectionId: string;
};

export type RecoveryWorkerSummary = {
  diagnostics: RecoveryDiagnosticItem[];
  errors: number;
  paused: number;
  processed: number;
  recovered: number;
  retried: number;
  skipped: number;
  skipReasons: Record<RecoverySkipReason, number>;
};

export const isSelectionOwnedByRecoveryRetry = (
  recovery: { status: string } | null | undefined,
) => {
  if (!recovery) {
    return false;
  }

  return (
    recovery.status === RECOVERY_STATUS.RETRY_SCHEDULED ||
    recovery.status === RECOVERY_STATUS.PROCESSING ||
    recovery.status === RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED ||
    recovery.status === RECOVERY_STATUS.EMAIL_SEND_FAILED
  );
};

const pushRecoveryDiagnostic = (
  summary: RecoveryWorkerSummary,
  item: RecoveryDiagnosticItem,
) => {
  summary.diagnostics.push(item);
};

export const reconcileSelectionBillingAttemptState = async ({
  admin,
  selection,
}: {
  admin: ShopifyAdminGraphql;
  selection: SubscriptionMealSelection;
}) => {
  const activeRecovery = await getActiveRecoveryForSelection(selection.id);

  if (isSelectionOwnedByRecoveryRetry(activeRecovery)) {
    console.log(
      "[paymentRecovery] normal worker skipped due to active recovery",
      {
        failureCount: activeRecovery?.failureCount ?? null,
        recoveryStatus: activeRecovery?.status ?? null,
        selectionId: selection.id,
        source: "cron_reconcile",
      },
    );
    return selection;
  }

  if (!selection.lastBillingAttemptId) {
    return selection;
  }

  const attempt = await fetchShopifyBillingAttempt(
    admin,
    selection.lastBillingAttemptId,
  );
  const { errorCode, errorMessage, status } = resolveBillingAttemptStatus(
    [],
    attempt,
  );
  const orderId = attempt?.order?.id ?? null;

  if (
    status === "submitted" ||
    (status === "unknown" && !attempt?.completedAt)
  ) {
    console.log("[BILLING] pending", {
      attemptId: selection.lastBillingAttemptId,
      selectionId: selection.id,
      source: "cron_reconcile",
    });
    return selection;
  }

  if (status === "success" && orderId) {
    if (selection.lastBillingAttemptStatus === "success") {
      console.log("[BILLING] duplicate_webhook_ignored", {
        attemptId: selection.lastBillingAttemptId,
        selectionId: selection.id,
        source: "cron_reconcile",
      });
      return selection;
    }

    await db.subscriptionMealSelection.update({
      data: {
        lastBillingAttemptAt: new Date(),
        lastBillingAttemptError: null,
        lastBillingAttemptId: selection.lastBillingAttemptId,
        lastBillingAttemptStatus: "success",
      },
      where: { id: selection.id },
    });

    if (!isResumeRenewalOrder(selection)) {
      await closeRecoveryOnSuccessfulOrder({
        orderId,
        selectionId: selection.id,
      });
    }

    console.log("[BILLING] succeeded", {
      attemptId: selection.lastBillingAttemptId,
      orderId,
      selectionId: selection.id,
      source: "cron_reconcile",
    });

    return db.subscriptionMealSelection.findUnique({
      where: { id: selection.id },
    });
  }

  if (status === "failure" || (status === "unknown" && attempt?.completedAt)) {
    const result = await processBillingAttemptFailure({
      admin,
      billingAttemptId: selection.lastBillingAttemptId,
      errorCode,
      errorMessage:
        errorMessage ?? "Le paiement de l’abonnement a échoué.",
      selection,
      source: "cron_reconcile",
    });

    if (result.action === "duplicate_ignored") {
      console.log("[BILLING] duplicate_webhook_ignored", {
        attemptId: selection.lastBillingAttemptId,
        selectionId: selection.id,
        source: "cron_reconcile",
      });
    } else if (result.action === "recovery_scheduled") {
      console.log("[BILLING] recovery_scheduled", {
        attemptId: selection.lastBillingAttemptId,
        failureCount: result.recovery?.failureCount ?? null,
        nextRetryAt: result.recovery?.nextRetryAt?.toISOString() ?? null,
        selectionId: selection.id,
        source: "cron_reconcile",
      });
    } else {
      console.log("[BILLING] failed", {
        attemptId: selection.lastBillingAttemptId,
        errorCode,
        errorMessage,
        selectionId: selection.id,
        source: "cron_reconcile",
      });
    }

    return db.subscriptionMealSelection.findUnique({
      where: { id: selection.id },
    });
  }

  return selection;
};

export const handleAutomaticBillingFailure = async ({
  admin,
  billingResult,
  selection,
}: {
  admin: ShopifyAdminGraphql;
  billingResult: TriggerBillingAttemptResult;
  selection: SubscriptionMealSelection;
}) => {
  if (billingResult.orderId) {
    return;
  }

  if (
    billingResult.status !== "failure" &&
    billingResult.status !== "unknown"
  ) {
    return;
  }

  if (isResumeRenewalOrder(selection)) {
    return;
  }

  await processBillingAttemptFailure({
    admin,
    billingAttemptId: billingResult.attemptId,
    errorCode: billingResult.errorCode,
    errorMessage:
      billingResult.errorMessage ?? "Le paiement de l’abonnement a échoué.",
    selection,
    source: "cron",
  });
};

export const closeRecoveryOnSuccessfulOrder = async ({
  orderId,
  selectionId,
}: {
  orderId: string;
  selectionId: string;
}) => {
  const openRecoveries = await db.subscriptionPaymentRecovery.findMany({
    where: {
      status: { in: [...ACTIVE_RECOVERY_STATUSES, RECOVERY_STATUS.FINAL_FAILED] },
      subscriptionMealSelectionId: selectionId,
    },
  });

  if (openRecoveries.length === 0) {
    return;
  }

  const updateResult = await db.subscriptionPaymentRecovery.updateMany({
    data: {
      nextRetryAt: null,
      status: RECOVERY_STATUS.RECOVERED,
    },
    where: {
      id: { in: openRecoveries.map((recovery) => recovery.id) },
      status: { not: RECOVERY_STATUS.RECOVERED },
    },
  });

  console.log("[paymentRecovery] recovery closed after successful order", {
    orderId,
    recoveredCount: updateResult.count,
    selectionId,
  });

  if (updateResult.count === 0) {
    return;
  }

  await trySendMileyoPaymentRecoveredEmail({
    orderId,
    recoveries: openRecoveries,
    selectionId,
  });
};

const trySendMileyoPaymentRecoveredEmail = async ({
  orderId,
  recoveries,
  selectionId,
}: {
  orderId: string;
  recoveries: {
    id: string;
    paymentRecoveredEmailSentAt: Date | null;
  }[];
  selectionId: string;
}) => {
  const alreadySentAt =
    recoveries.find((recovery) => recovery.paymentRecoveredEmailSentAt)
      ?.paymentRecoveredEmailSentAt ?? null;

  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[paymentRecovery] mileyo payment-recovered email skipped", {
      reason: "selection_missing",
      selectionId,
    });
    return;
  }

  const order = await db.boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolvePaymentEmailRecipient(
    selection,
    order,
  );

  const eligible = shouldSendPaymentRecoveredEmail({
    hasRealTransition: true,
    hasRecipient: Boolean(recipient),
    paymentRecoveredEmailSentAt: alreadySentAt,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient) {
    console.log("[paymentRecovery] mileyo payment-recovered email skipped", {
      alreadySent: Boolean(alreadySentAt),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasRecipient: Boolean(recipient),
      recoveryIds: recoveries.map((recovery) => recovery.id),
      selectionId,
    });
    return;
  }

  const primaryRecoveryId = recoveries[0]?.id ?? null;

  const result = await sendEmail({
    data: buildPaymentRecoveredEmailData({
      customerName,
      orderId,
      recoveryId: primaryRecoveryId,
      subscriptionContractId: selection.subscriptionContractId,
    }),
    subject: "Votre paiement a été récupéré",
    template: "payment-recovered",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[paymentRecovery] mileyo payment-recovered email send failed", {
      message: result.message,
      reason: result.reason,
      selectionId,
    });
    return;
  }

  const sentAt = new Date();

  await db.subscriptionPaymentRecovery.updateMany({
    data: { paymentRecoveredEmailSentAt: sentAt },
    where: { id: { in: recoveries.map((recovery) => recovery.id) } },
  });

  console.log("[paymentRecovery] mileyo payment-recovered email sent", {
    emailId: result.id,
    orderId,
    recoveryIds: recoveries.map((recovery) => recovery.id),
    selectionId,
    to: recipient.email,
  });
};

export type ProcessDueRecoveryRetriesOptions = {
  now?: Date;
  selectionId?: string;
};

export const resolveRecoveryWorkerNow = (
  options?: ProcessDueRecoveryRetriesOptions,
) => options?.now ?? new Date();

export const buildDueRecoveryRetriesWhere = ({
  now,
  selectionId,
  shop,
}: {
  now: Date;
  selectionId?: string;
  shop: string;
}) => ({
  shop,
  ...(selectionId ? { subscriptionMealSelectionId: selectionId } : {}),
  OR: [
    {
      status: RECOVERY_STATUS.PROCESSING,
    },
    {
      failureCount: { lt: MAX_RECOVERY_FAILURES },
      nextRetryAt: { lte: now },
      status: {
        in: [
          RECOVERY_STATUS.RETRY_SCHEDULED,
          RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
          RECOVERY_STATUS.EMAIL_SEND_FAILED,
        ],
      },
    },
  ],
});

export const isRecoveryDueForNewAttempt = (
  recovery: {
    nextRetryAt: Date | null;
    status: string;
  },
  now: Date,
) => {
  const isRetryWindowOpen =
    recovery.nextRetryAt !== null &&
    recovery.nextRetryAt.getTime() <= now.getTime();

  if (!isRetryWindowOpen) {
    return false;
  }

  return (
    (
      [
        RECOVERY_STATUS.RETRY_SCHEDULED,
        RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
        RECOVERY_STATUS.EMAIL_SEND_FAILED,
      ] as string[]
    ).includes(recovery.status) ||
    recovery.status === RECOVERY_STATUS.PROCESSING
  );
};

const isRecoveryFailureAlreadyRecorded = (
  recovery: {
    failureCount: number;
    lastBillingAttemptId: string | null;
    status: string;
  } | null,
  billingAttemptId: string | null,
) => {
  if (!recovery || !billingAttemptId || recovery.failureCount <= 0) {
    return false;
  }

  if (recovery.lastBillingAttemptId !== billingAttemptId) {
    return false;
  }

  // Submitted retry still awaiting Shopify result — failure not persisted yet.
  return recovery.status !== RECOVERY_STATUS.PROCESSING;
};

const isTerminalAttemptAlreadyRecorded = (
  recovery: {
    failureCount: number;
    lastBillingAttemptId: string | null;
    status: string;
  },
  attemptId: string | null,
) => isRecoveryFailureAlreadyRecorded(recovery, attemptId);

const isBillingAttemptPending = (
  status: string,
  attempt: Awaited<ReturnType<typeof fetchShopifyBillingAttempt>>,
) =>
  status === "submitted" ||
  (status === "unknown" && Boolean(attempt?.id) && !attempt?.completedAt);

const isBillingAttemptTerminal = (
  status: string,
  attempt: Awaited<ReturnType<typeof fetchShopifyBillingAttempt>>,
) => status === "failure" || (status === "unknown" && Boolean(attempt?.completedAt));

const recordRecoveryRetryFailureOutcome = async ({
  attemptId,
  recoveryId,
  selectionId,
  summary,
  updated,
}: {
  attemptId: string | null;
  recoveryId: string;
  selectionId: string;
  summary: RecoveryWorkerSummary;
  updated: Awaited<ReturnType<typeof scheduleRecoveryAfterFailure>>;
}) => {
  if (updated?.status === RECOVERY_STATUS.FINAL_FAILED) {
    summary.paused += 1;
    return;
  }

  if (updated) {
    if (attemptId) {
      await db.subscriptionMealSelection.update({
        data: {
          lastBillingAttemptAt: updated.lastFailureAt ?? new Date(),
          lastBillingAttemptError: updated.lastErrorMessage,
          lastBillingAttemptId: attemptId,
          lastBillingAttemptStatus: "failure",
        },
        where: { id: selectionId },
      });
    }

    console.log("[paymentRecovery] retry failure handled", {
      attemptId,
      failureCount: updated.failureCount,
      nextRetryAt: updated.nextRetryAt?.toISOString() ?? null,
      recoveryId,
      recoveryStatus: updated.status,
      selectionId,
    });
    return;
  }

  summary.errors += 1;
  console.error("[paymentRecovery] retry failure not persisted", {
    attemptId,
    recoveryId,
    selectionId,
  });
};

export const processDueRecoveryRetries = async (
  shop: string,
  admin: ShopifyAdminGraphql,
  options?: ProcessDueRecoveryRetriesOptions,
): Promise<RecoveryWorkerSummary> => {
  const summary: RecoveryWorkerSummary = {
    diagnostics: [],
    errors: 0,
    paused: 0,
    processed: 0,
    recovered: 0,
    retried: 0,
    skipped: 0,
    skipReasons: EMPTY_RECOVERY_SKIP_REASONS(),
  };

  const now = resolveRecoveryWorkerNow(options);

  const recoveries = await db.subscriptionPaymentRecovery.findMany({
    include: { subscriptionMealSelection: true },
    where: buildDueRecoveryRetriesWhere({
      now,
      selectionId: options?.selectionId,
      shop,
    }),
  });

  for (const recovery of recoveries) {
    const selection = recovery.subscriptionMealSelection;
    const recoveryStatusBefore = recovery.status;
    const diagnosticBase = {
      failureCount: recovery.failureCount,
      lastBillingAttemptId: recovery.lastBillingAttemptId,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
      nextRetryAt: recovery.nextRetryAt?.toISOString() ?? null,
      recoveryStatusBefore,
      selectionId: selection.id,
    };

    try {
      if (
        !selection.subscriptionContractId ||
        isResumeRenewalOrder(selection)
      ) {
        console.log("[paymentRecovery] skipped resume flow", {
          selectionId: selection.id,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "skipped_resume",
        });
        summary.skipped += 1;
        continue;
      }

      if (isTerminalSubscriptionSelectionStatus(selection.status)) {
        console.log("[PAYMENT_RECOVERY] skipped terminal contract", {
          recoveryId: recovery.id,
          selectionId: selection.id,
          skipReason: "terminal_contract",
          status: selection.status,
          subscriptionContractId: selection.subscriptionContractId,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "terminal_contract",
        });
        summary.skipped += 1;
        summary.skipReasons.terminal_contract += 1;
        continue;
      }

      let workingRecovery = recovery;

      if (
        workingRecovery.status === RECOVERY_STATUS.PROCESSING &&
        workingRecovery.lastBillingAttemptId
      ) {
        const staleAttempt = await fetchShopifyBillingAttempt(
          admin,
          workingRecovery.lastBillingAttemptId,
        );
        const staleResolved = resolveBillingAttemptStatus([], staleAttempt);

        if (
          isBillingAttemptTerminal(staleResolved.status, staleAttempt) &&
          !isTerminalAttemptAlreadyRecorded(
            workingRecovery,
            workingRecovery.lastBillingAttemptId,
          )
        ) {
          const { errorCode, errorMessage, status } = staleResolved;

          console.log("[paymentRecovery] stale processing failure recorded", {
            attemptId: workingRecovery.lastBillingAttemptId,
            recoveryId: workingRecovery.id,
            selectionId: selection.id,
            status,
          });

          const updatedRecovery = await scheduleRecoveryAfterFailure({
              admin,
              billingCycleKey: workingRecovery.billingCycleKey,
              billingResult: {
                attemptId: workingRecovery.lastBillingAttemptId,
                errorCode,
                errorMessage:
                  errorMessage ?? "Le paiement de l’abonnement a échoué.",
                orderId: null,
                paymentAt: null,
                status,
              },
              dueBillingDate: selection.nextBillingDate,
              selection,
            });

          if (updatedRecovery) {
            workingRecovery = {
              ...recovery,
              ...updatedRecovery,
            };
          }

          await db.subscriptionMealSelection.update({
            data: {
              lastBillingAttemptAt: new Date(),
              lastBillingAttemptError:
                errorMessage ?? "Le paiement de l’abonnement a échoué.",
              lastBillingAttemptId: workingRecovery.lastBillingAttemptId,
              lastBillingAttemptStatus: "failure",
            },
            where: { id: selection.id },
          });

          pushRecoveryDiagnostic(summary, {
            ...diagnosticBase,
            branch: "stale_restore",
          });
        }
      }

      const shouldStartNewAttempt = isRecoveryDueForNewAttempt(
        workingRecovery,
        now,
      );

      if (
        workingRecovery.status !== RECOVERY_STATUS.PROCESSING &&
        !shouldStartNewAttempt &&
        (!selection.active || selection.status !== "active")
      ) {
        console.log("[paymentRecovery] skipped inactive selection", {
          active: selection.active,
          selectionId: selection.id,
          status: selection.status,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "skipped_inactive",
        });
        summary.skipped += 1;
        continue;
      }

      summary.processed += 1;

      const nextAttemptNumber = workingRecovery.failureCount + 1;
      const nextIdempotencyKey = buildRecoveryBillingIdempotencyKey(
        selection.id,
        workingRecovery.billingCycleKey,
        nextAttemptNumber,
      );
      const previousAttemptId = workingRecovery.lastBillingAttemptId;
      let previousAttemptStatus: string | null = null;

      if (workingRecovery.lastBillingAttemptId) {
        const attempt = await fetchShopifyBillingAttempt(
          admin,
          workingRecovery.lastBillingAttemptId,
        );
        const orderId = attempt?.order?.id ?? null;

        if (orderId) {
          await closeRecoveryOnSuccessfulOrder({
            orderId,
            selectionId: selection.id,
          });
          pushRecoveryDiagnostic(summary, {
            ...diagnosticBase,
            branch: "recovered",
          });
          summary.recovered += 1;
          continue;
        }

        const { errorCode, errorMessage, status } = resolveBillingAttemptStatus(
          [],
          attempt,
        );
        previousAttemptStatus = status;

        if (isBillingAttemptPending(status, attempt)) {
          await db.subscriptionPaymentRecovery.update({
            data: {
              nextRetryAt: null,
              status: RECOVERY_STATUS.PROCESSING,
            },
            where: { id: workingRecovery.id },
          });

          console.log("[paymentRecovery] retry pending", {
            attemptId: workingRecovery.lastBillingAttemptId,
            recoveryId: workingRecovery.id,
            selectionId: selection.id,
            status,
          });
          pushRecoveryDiagnostic(summary, {
            ...diagnosticBase,
            branch: "pending",
          });
          summary.skipped += 1;
          continue;
        }

        if (isBillingAttemptTerminal(status, attempt)) {
          const alreadyRecorded = isTerminalAttemptAlreadyRecorded(
            workingRecovery,
            workingRecovery.lastBillingAttemptId,
          );

          if (alreadyRecorded) {
            if (!shouldStartNewAttempt) {
              console.log("[paymentRecovery] waiting for next retry window", {
                nextRetryAt: workingRecovery.nextRetryAt?.toISOString() ?? null,
                recoveryId: workingRecovery.id,
                selectionId: selection.id,
              });
              pushRecoveryDiagnostic(summary, {
                ...diagnosticBase,
                branch: "pending",
              });
              summary.skipped += 1;
              continue;
            }
          } else {
            console.log("[paymentRecovery] retry terminal failure", {
              attemptId: workingRecovery.lastBillingAttemptId,
              errorCode,
              errorMessage,
              recoveryId: workingRecovery.id,
              selectionId: selection.id,
              status,
            });

            const updated = await scheduleRecoveryAfterFailure({
              admin,
              billingCycleKey: workingRecovery.billingCycleKey,
              billingResult: {
                attemptId: workingRecovery.lastBillingAttemptId,
                errorCode,
                errorMessage,
                orderId: null,
                paymentAt: null,
                status,
              },
              dueBillingDate: selection.nextBillingDate,
              selection,
            });

            await recordRecoveryRetryFailureOutcome({
              attemptId: workingRecovery.lastBillingAttemptId,
              recoveryId: workingRecovery.id,
              selectionId: selection.id,
              summary,
              updated,
            });
            pushRecoveryDiagnostic(summary, {
              ...diagnosticBase,
              branch: "terminal_failure",
            });
            continue;
          }
        }
      } else if (!shouldStartNewAttempt) {
        console.log("[paymentRecovery] recovery not due for new attempt", {
          nextRetryAt: workingRecovery.nextRetryAt?.toISOString() ?? null,
          recoveryId: workingRecovery.id,
          selectionId: selection.id,
          status: workingRecovery.status,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "pending",
        });
        summary.skipped += 1;
        continue;
      }

      console.log("[paymentRecovery] retry starting", {
        failureCount: workingRecovery.failureCount,
        newAttemptNumber: nextAttemptNumber,
        newIdempotencyKey: nextIdempotencyKey,
        previousAttemptId,
        previousAttemptStatus,
        recoveryId: workingRecovery.id,
        selectionId: selection.id,
      });
      pushRecoveryDiagnostic(summary, {
        ...diagnosticBase,
        branch: "retry_start",
      });

      await db.subscriptionPaymentRecovery.update({
        data: {
          nextRetryAt: null,
          status: RECOVERY_STATUS.PROCESSING,
        },
        where: { id: workingRecovery.id },
      });

      const billingResult = await triggerSubscriptionBillingAttempt({
        admin,
        idempotencyKey: nextIdempotencyKey,
        selectionId: selection.id,
        subscriptionContractId: selection.subscriptionContractId,
      });

      summary.retried += 1;

      if (billingResult.status === "success" && billingResult.orderId) {
        await closeRecoveryOnSuccessfulOrder({
          orderId: billingResult.orderId,
          selectionId: selection.id,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "recovered",
        });
        summary.recovered += 1;
        continue;
      }

      if (
        billingResult.status === "submitted" &&
        billingResult.attemptId &&
        !billingResult.orderId
      ) {
        await db.subscriptionPaymentRecovery.update({
          data: {
            lastBillingAttemptId: billingResult.attemptId,
            nextRetryAt: null,
            status: RECOVERY_STATUS.PROCESSING,
          },
          where: { id: workingRecovery.id },
        });

        console.log("[paymentRecovery] retry submitted", {
          attemptId: billingResult.attemptId,
          idempotencyKey: nextIdempotencyKey,
          recoveryId: workingRecovery.id,
          selectionId: selection.id,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "pending",
        });
        continue;
      }

      if (
        billingResult.status === "failure" ||
        billingResult.status === "unknown"
      ) {
        console.log("[paymentRecovery] retry terminal failure", {
          attemptId: billingResult.attemptId,
          errorCode: billingResult.errorCode,
          errorMessage: billingResult.errorMessage,
          idempotencyKey: nextIdempotencyKey,
          recoveryId: workingRecovery.id,
          selectionId: selection.id,
          status: billingResult.status,
        });

        const updated = await scheduleRecoveryAfterFailure({
          admin,
          billingCycleKey: workingRecovery.billingCycleKey,
          billingResult,
          dueBillingDate: selection.nextBillingDate,
          selection,
        });

        await recordRecoveryRetryFailureOutcome({
          attemptId: billingResult.attemptId,
          recoveryId: workingRecovery.id,
          selectionId: selection.id,
          summary,
          updated,
        });
        pushRecoveryDiagnostic(summary, {
          ...diagnosticBase,
          branch: "terminal_failure",
        });
      }
    } catch (error) {
      summary.errors += 1;
      console.error("[paymentRecovery] unexpected retry error", {
        attemptId: recovery.lastBillingAttemptId,
        error: error instanceof Error ? error.message : error,
        recoveryId: recovery.id,
        selectionId: selection.id,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  return summary;
};

export const shouldSkipNormalBillingForRecovery = (recovery: {
  failureCount: number;
  nextRetryAt: Date | null;
  status: string;
} | null) => {
  if (!recovery) {
    return false;
  }

  if (!isOpenRecoveryStatus(recovery.status)) {
    return false;
  }

  if (recovery.failureCount <= 0) {
    return false;
  }

  if (recovery.status === RECOVERY_STATUS.PROCESSING) {
    return true;
  }

  if (recovery.nextRetryAt && recovery.nextRetryAt.getTime() > Date.now()) {
    return true;
  }

  return recovery.failureCount > 0 && recovery.failureCount < MAX_RECOVERY_FAILURES;
};
