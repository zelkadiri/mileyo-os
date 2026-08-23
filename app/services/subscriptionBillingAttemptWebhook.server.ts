import type { SubscriptionMealSelection } from "@prisma/client";

import db from "../db.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { unauthenticated } from "../shopify.server";
import {
  closeRecoveryOnSuccessfulOrder,
  processBillingAttemptFailure,
} from "./subscriptionPaymentRecovery.server";
import { RECOVERY_STATUS } from "../constants/subscriptionPaymentRecovery";
import { findCanonicalSubscriptionMealSelectionByContractId } from "./subscriptionMealSelection.server";
import {
  completeResumeRenewalFromWebhook,
  fetchShopifyBillingAttempt,
  handleResumeBillingFailure,
  isResumeRenewalOrder,
  reconcileBillingAttemptByIdempotencyKey,
  resolveBillingAttemptStatus,
  type ShopifyAdminGraphql,
} from "./subscriptionBillingWorker.server";
import { resetSubscriptionPausedEmailSentAt } from "./email/email.server";

export type SubscriptionBillingAttemptWebhookPayload = {
  admin_graphql_api_id?: string | null;
  admin_graphql_api_order_id?: string | null;
  admin_graphql_api_subscription_contract_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  id?: number | string | null;
  idempotency_key?: string | null;
  order_id?: number | string | null;
  ready?: boolean | null;
  subscription_contract_id?: number | string | null;
};

type ResolvedBillingAttemptWebhook = {
  attemptId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  orderId: string | null;
  status: "failure" | "pending" | "success" | "unknown";
};

export const findSelectionBySubscriptionContract = async (
  shop: string,
  contractRef: string | number | null | undefined,
) => {
  const normalized = normalizeShopifyId(contractRef);

  if (!normalized) {
    return null;
  }

  return findCanonicalSubscriptionMealSelectionByContractId({
    shop,
    subscriptionContractId: normalized,
  });
};

const normalizeOrderRef = (value: string | number | null | undefined) => {
  if (value == null) {
    return null;
  }

  const normalized = normalizeShopifyId(value);

  return normalized ? `gid://shopify/Order/${normalized}` : null;
};

const extractOrderIdFromPayload = (
  payload: SubscriptionBillingAttemptWebhookPayload,
) => {
  if (payload.admin_graphql_api_order_id) {
    return payload.admin_graphql_api_order_id;
  }

  return normalizeOrderRef(payload.order_id);
};

const extractContractRef = (
  payload: SubscriptionBillingAttemptWebhookPayload,
) =>
  payload.admin_graphql_api_subscription_contract_id ??
  payload.subscription_contract_id ??
  null;

const logBillingEvent = (
  event:
    | "duplicate_webhook_ignored"
    | "failed"
    | "pending"
    | "recovery_scheduled"
    | "submitted"
    | "succeeded",
  details: Record<string, unknown>,
) => {
  console.log(`[BILLING] ${event}`, details);
};

export const logBillingAttemptWebhookReceived = ({
  payload,
  shop,
  topic,
}: {
  payload: SubscriptionBillingAttemptWebhookPayload;
  shop: string;
  topic: string;
}) => {
  console.log("[BILLING] webhook received", {
    billingAttemptId: payload.admin_graphql_api_id ?? null,
    contractId:
      extractContractRef(payload) ??
      payload.admin_graphql_api_subscription_contract_id ??
      null,
    errorCode: payload.error_code ?? null,
    errorMessage: payload.error_message ?? null,
    idempotencyKey: payload.idempotency_key ?? null,
    orderId: extractOrderIdFromPayload(payload),
    ready: payload.ready ?? null,
    shop,
    topic,
  });
};

const resolveBillingAttemptFromWebhook = async ({
  admin,
  payload,
  selection,
}: {
  admin: ShopifyAdminGraphql;
  payload: SubscriptionBillingAttemptWebhookPayload;
  selection: SubscriptionMealSelection;
}): Promise<ResolvedBillingAttemptWebhook> => {
  const attemptIdFromPayload = payload.admin_graphql_api_id ?? null;
  const orderIdFromPayload = extractOrderIdFromPayload(payload);
  const idempotencyKey = payload.idempotency_key ?? null;

  if (attemptIdFromPayload) {
    const attempt = await fetchShopifyBillingAttempt(admin, attemptIdFromPayload);
    const resolved = resolveBillingAttemptStatus([], attempt);
    const orderId =
      orderIdFromPayload ?? attempt?.order?.id ?? null;

    return {
      attemptId: attemptIdFromPayload,
      errorCode:
        payload.error_code ??
        resolved.errorCode ??
        attempt?.processingError?.code ??
        null,
      errorMessage:
        payload.error_message ??
        resolved.errorMessage ??
        attempt?.errorMessage ??
        null,
      idempotencyKey,
      orderId,
      status:
        resolved.status === "success"
          ? "success"
          : resolved.status === "failure"
            ? "failure"
            : resolved.status === "submitted"
              ? "pending"
              : "unknown",
    };
  }

  if (idempotencyKey && selection.subscriptionContractId) {
    const reconciled = await reconcileBillingAttemptByIdempotencyKey({
      admin,
      idempotencyKey,
      subscriptionContractId: selection.subscriptionContractId,
    });
    const attempt = reconciled.attempt;

    return {
      attemptId: attempt?.id ?? null,
      errorCode:
        payload.error_code ?? attempt?.processingError?.code ?? null,
      errorMessage:
        payload.error_message ??
        reconciled.errorMessage ??
        attempt?.errorMessage ??
        null,
      idempotencyKey,
      orderId: orderIdFromPayload ?? attempt?.order?.id ?? null,
      status:
        reconciled.status === "success"
          ? "success"
          : reconciled.status === "failure"
            ? "failure"
            : reconciled.status === "submitted"
              ? "pending"
              : "unknown",
    };
  }

  return {
    attemptId: null,
    errorCode: payload.error_code ?? null,
    errorMessage: payload.error_message ?? null,
    idempotencyKey,
    orderId: orderIdFromPayload,
    status: payload.error_code ? "failure" : "unknown",
  };
};

const updateSelectionBillingAttemptState = async ({
  attemptId,
  errorMessage,
  selectionId,
  status,
}: {
  attemptId: string | null;
  errorMessage?: string | null;
  selectionId: string;
  status: string;
}) => {
  await db.subscriptionMealSelection.update({
    data: {
      lastBillingAttemptAt: new Date(),
      lastBillingAttemptError: errorMessage ?? null,
      lastBillingAttemptId: attemptId,
      lastBillingAttemptStatus: status,
    },
    where: { id: selectionId },
  });
};

const isSuccessAlreadyProcessed = async ({
  attemptId,
  selection,
}: {
  attemptId: string | null;
  selection: SubscriptionMealSelection;
}) => {
  if (!attemptId) {
    return false;
  }

  if (
    selection.lastBillingAttemptId === attemptId &&
    selection.lastBillingAttemptStatus === "success"
  ) {
    const recovered = await db.subscriptionPaymentRecovery.findFirst({
      where: {
        status: RECOVERY_STATUS.RECOVERED,
        subscriptionMealSelectionId: selection.id,
      },
    });

    return Boolean(recovered);
  }

  return (
    selection.lastBillingAttemptId === attemptId &&
    selection.lastBillingAttemptStatus === "success"
  );
};

export const handleSubscriptionBillingAttemptSuccessWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: SubscriptionBillingAttemptWebhookPayload;
  shop: string;
  topic: string;
}) => {
  logBillingAttemptWebhookReceived({ payload, shop, topic });

  const selection = await findSelectionBySubscriptionContract(
    shop,
    extractContractRef(payload),
  );

  if (!selection) {
    console.log("[BILLING] webhook ignored — no matching selection", {
      contractId: extractContractRef(payload),
      shop,
      topic,
    });
    return;
  }

  const { admin } = await unauthenticated.admin(shop);
  const resolved = await resolveBillingAttemptFromWebhook({
    admin,
    payload,
    selection,
  });

  console.log("[BILLING] webhook resolved attempt", {
    attemptId: resolved.attemptId,
    contractId: selection.subscriptionContractId,
    errorCode: resolved.errorCode,
    errorMessage: resolved.errorMessage,
    orderId: resolved.orderId,
    selectionId: selection.id,
    status: resolved.status,
    topic,
  });

  if (!resolved.orderId) {
    logBillingEvent("pending", {
      attemptId: resolved.attemptId,
      reason: "success_webhook_without_order",
      selectionId: selection.id,
    });
    return;
  }

  if (isResumeRenewalOrder(selection) && selection.subscriptionContractId) {
    console.log("[resumeBilling] success webhook — order confirmed for resume", {
      attemptId: resolved.attemptId,
      localActive: selection.active,
      localStatus: selection.status,
      orderId: resolved.orderId,
      resumeAttemptKey: selection.resumeAttemptKey,
      selectionId: selection.id,
      topic,
    });

    const attempt = resolved.attemptId
      ? await fetchShopifyBillingAttempt(admin, resolved.attemptId)
      : null;
    const orderCreatedAt =
      (attempt?.completedAt ? new Date(attempt.completedAt) : null) ??
      new Date();

    await completeResumeRenewalFromWebhook({
      admin,
      orderCreatedAt,
      selectionId: selection.id,
      shopifyOrderId: resolved.orderId,
      subscriptionContractId: selection.subscriptionContractId,
    });

    await resetSubscriptionPausedEmailSentAt({
      selectionId: selection.id,
    });

    return;
  }

  if (
    await isSuccessAlreadyProcessed({
      attemptId: resolved.attemptId,
      selection,
    })
  ) {
    logBillingEvent("duplicate_webhook_ignored", {
      attemptId: resolved.attemptId,
      orderId: resolved.orderId,
      selectionId: selection.id,
      topic,
    });
    return;
  }

  await updateSelectionBillingAttemptState({
    attemptId: resolved.attemptId,
    selectionId: selection.id,
    status: "success",
  });

  if (!isResumeRenewalOrder(selection)) {
    await closeRecoveryOnSuccessfulOrder({
      orderId: resolved.orderId,
      selectionId: selection.id,
    });
  }

  const recovery = await db.subscriptionPaymentRecovery.findFirst({
    orderBy: { updatedAt: "desc" },
    where: { subscriptionMealSelectionId: selection.id },
  });

  logBillingEvent("succeeded", {
    attemptId: resolved.attemptId,
    contractId: selection.subscriptionContractId,
    orderId: resolved.orderId,
    recoveryNextRetryAt: recovery?.nextRetryAt?.toISOString() ?? null,
    recoveryStatus: recovery?.status ?? null,
    selectionId: selection.id,
    topic,
  });
};

export const handleSubscriptionBillingAttemptFailureWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: SubscriptionBillingAttemptWebhookPayload;
  shop: string;
  topic: string;
}) => {
  logBillingAttemptWebhookReceived({ payload, shop, topic });

  const selection = await findSelectionBySubscriptionContract(
    shop,
    extractContractRef(payload),
  );

  if (!selection) {
    console.log("[BILLING] webhook ignored — no matching selection", {
      contractId: extractContractRef(payload),
      shop,
      topic,
    });
    return;
  }

  const { admin } = await unauthenticated.admin(shop);
  const resolved = await resolveBillingAttemptFromWebhook({
    admin,
    payload,
    selection,
  });

  console.log("[BILLING] webhook resolved attempt", {
    attemptId: resolved.attemptId,
    contractId: selection.subscriptionContractId,
    errorCode: resolved.errorCode,
    errorMessage: resolved.errorMessage,
    orderId: resolved.orderId,
    selectionId: selection.id,
    status: resolved.status,
    topic,
  });

  if (resolved.orderId) {
    logBillingEvent("succeeded", {
      attemptId: resolved.attemptId,
      note: "failure_webhook_had_order",
      orderId: resolved.orderId,
      selectionId: selection.id,
    });

    await handleSubscriptionBillingAttemptSuccessWebhook({
      payload: {
        ...payload,
        admin_graphql_api_order_id: resolved.orderId,
      },
      shop,
      topic: "subscription_billing_attempts/success",
    });
    return;
  }

  const result = await processBillingAttemptFailure({
    admin,
    billingAttemptId: resolved.attemptId,
    errorCode: resolved.errorCode,
    errorMessage:
      resolved.errorMessage ?? "Le paiement de l’abonnement a échoué.",
    selection,
    source: "webhook",
  });

  if (result.action === "duplicate_ignored") {
    logBillingEvent("duplicate_webhook_ignored", {
      attemptId: resolved.attemptId,
      selectionId: selection.id,
      topic,
    });
    return;
  }

  if (result.action === "ignored_resume") {
    await handleResumeBillingFailure({
      admin,
      attemptId: resolved.attemptId,
      errorMessage:
        resolved.errorMessage ?? "Le paiement de reprise a échoué.",
      selection,
      source: `webhook:${topic}`,
    });
    return;
  }

  logBillingEvent("failed", {
    attemptId: resolved.attemptId,
    errorCode: resolved.errorCode,
    errorMessage: resolved.errorMessage,
    selectionId: selection.id,
    topic,
  });
};

export const handleSubscriptionBillingAttemptChallengedWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: SubscriptionBillingAttemptWebhookPayload;
  shop: string;
  topic: string;
}) => {
  logBillingAttemptWebhookReceived({ payload, shop, topic });

  const selection = await findSelectionBySubscriptionContract(
    shop,
    extractContractRef(payload),
  );

  if (!selection) {
    console.log("[BILLING] webhook ignored — no matching selection", {
      contractId: extractContractRef(payload),
      shop,
      topic,
    });
    return;
  }

  const { admin } = await unauthenticated.admin(shop);
  const resolved = await resolveBillingAttemptFromWebhook({
    admin,
    payload,
    selection,
  });

  await updateSelectionBillingAttemptState({
    attemptId: resolved.attemptId,
    selectionId: selection.id,
    status: "challenged",
  });

  logBillingEvent("pending", {
    attemptId: resolved.attemptId,
    reason: "3ds_challenged",
    selectionId: selection.id,
    topic,
  });
};
