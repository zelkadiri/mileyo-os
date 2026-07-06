import type { SubscriptionMealSelection } from "@prisma/client";

import {
  isTerminalSubscriptionSelectionStatus,
  SUBSCRIPTION_SELECTION_STATUS,
} from "../constants/subscriptionMealSelection";
import db from "../db.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { findSubscriptionMealSelectionByContractId } from "./subscriptionMealSelection.server";
import {
  fetchSubscriptionContractNextBillingDate,
  fetchSubscriptionContractStatus,
  type ShopifyAdminGraphql,
} from "./subscriptionBillingWorker.server";

export type SubscriptionContractSyncSource =
  | "webhook"
  | "cron"
  | "portal_action"
  | "portal_reconciliation"
  | "admin_action";

export type SubscriptionContractSyncAction =
  | "updated"
  | "unchanged"
  | "skipped"
  | "error";

export type SubscriptionContractSyncResult = {
  action: SubscriptionContractSyncAction;
  localActiveAfter: boolean | null;
  localActiveBefore: boolean | null;
  localStatusAfter: string | null;
  localStatusBefore: string | null;
  reason: string;
  selection: SubscriptionMealSelection | null;
  shopifyStatus: string | null;
  subscriptionContractId: string;
};

export type SubscriptionContractWebhookPayload = {
  admin_graphql_api_id?: string | null;
  id?: number | string | null;
  status?: string | null;
};

type LocalContractState = {
  active: boolean;
  clearNextBillingDate: boolean;
  status: string;
};

const SHOPIFY_STATUS_TO_LOCAL: Record<string, LocalContractState> = {
  ACTIVE: {
    active: true,
    clearNextBillingDate: false,
    status: SUBSCRIPTION_SELECTION_STATUS.ACTIVE,
  },
  PAUSED: {
    active: false,
    clearNextBillingDate: false,
    status: SUBSCRIPTION_SELECTION_STATUS.PAUSED,
  },
  CANCELLED: {
    active: false,
    clearNextBillingDate: true,
    status: SUBSCRIPTION_SELECTION_STATUS.CANCELLED,
  },
  EXPIRED: {
    active: false,
    clearNextBillingDate: true,
    status: SUBSCRIPTION_SELECTION_STATUS.EXPIRED,
  },
  FAILED: {
    active: false,
    clearNextBillingDate: true,
    status: SUBSCRIPTION_SELECTION_STATUS.FAILED,
  },
};

export const extractSubscriptionContractIdFromWebhookPayload = (
  payload: SubscriptionContractWebhookPayload,
) =>
  normalizeShopifyId(payload.admin_graphql_api_id) ??
  normalizeShopifyId(payload.id);

export const mapShopifyContractStatusToLocal = (
  shopifyStatus: string,
): LocalContractState | null => {
  const normalized = shopifyStatus.trim().toUpperCase();
  return SHOPIFY_STATUS_TO_LOCAL[normalized] ?? null;
};

const logContractSync = (details: Record<string, unknown>) => {
  console.log("[SUBSCRIPTION_CONTRACT_SYNC]", details);
};

const localStateMatchesTarget = (
  selection: SubscriptionMealSelection,
  target: LocalContractState,
  nextBillingDate: Date | null | undefined,
) => {
  const billingMatches = target.clearNextBillingDate
    ? selection.nextBillingDate === null
    : nextBillingDate === undefined ||
      selection.nextBillingDate?.getTime() === nextBillingDate?.getTime() ||
      (selection.nextBillingDate === null && nextBillingDate === null);

  return (
    selection.active === target.active &&
    selection.status === target.status &&
    billingMatches
  );
};

export const syncSubscriptionContractState = async ({
  admin,
  shop,
  source,
  subscriptionContractId,
  webhookTopic,
}: {
  admin: ShopifyAdminGraphql;
  shop: string;
  source: SubscriptionContractSyncSource;
  subscriptionContractId: string;
  webhookTopic?: string;
}): Promise<SubscriptionContractSyncResult> => {
  const normalizedContractId =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;

  const selection = await findSubscriptionMealSelectionByContractId({
    shop,
    subscriptionContractId: normalizedContractId,
  });

  if (!selection) {
    logContractSync({
      action: "skipped",
      reason: "no_canonical_selection_for_contract",
      shop,
      source,
      subscriptionContractId: normalizedContractId,
      webhookTopic: webhookTopic ?? null,
    });

    return {
      action: "skipped",
      localActiveAfter: null,
      localActiveBefore: null,
      localStatusAfter: null,
      localStatusBefore: null,
      reason: "no_canonical_selection_for_contract",
      selection: null,
      shopifyStatus: null,
      subscriptionContractId: normalizedContractId,
    };
  }

  const localStatusBefore = selection.status;
  const localActiveBefore = selection.active;

  let shopifyStatus: string | null;

  try {
    shopifyStatus = await fetchSubscriptionContractStatus(
      admin,
      normalizedContractId,
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "shopify_status_fetch_failed";

    logContractSync({
      action: "error",
      localActiveBefore,
      localStatusBefore,
      reason,
      selectionId: selection.id,
      shop,
      shopifyStatus: null,
      source,
      subscriptionContractId: normalizedContractId,
      webhookTopic: webhookTopic ?? null,
    });

    return {
      action: "error",
      localActiveAfter: localActiveBefore,
      localActiveBefore,
      localStatusAfter: localStatusBefore,
      localStatusBefore,
      reason,
      selection,
      shopifyStatus: null,
      subscriptionContractId: normalizedContractId,
    };
  }

  if (!shopifyStatus) {
    logContractSync({
      action: "error",
      localActiveBefore,
      localStatusBefore,
      reason: "shopify_status_unavailable",
      selectionId: selection.id,
      shop,
      shopifyStatus: null,
      source,
      subscriptionContractId: normalizedContractId,
      webhookTopic: webhookTopic ?? null,
    });

    return {
      action: "error",
      localActiveAfter: localActiveBefore,
      localActiveBefore,
      localStatusAfter: localStatusBefore,
      localStatusBefore,
      reason: "shopify_status_unavailable",
      selection,
      shopifyStatus: null,
      subscriptionContractId: normalizedContractId,
    };
  }

  const targetLocal = mapShopifyContractStatusToLocal(shopifyStatus);

  if (!targetLocal) {
    logContractSync({
      action: "skipped",
      localActiveBefore,
      localStatusBefore,
      reason: "unsupported_shopify_status",
      selectionId: selection.id,
      shop,
      shopifyStatus,
      source,
      subscriptionContractId: normalizedContractId,
      webhookTopic: webhookTopic ?? null,
    });

    return {
      action: "skipped",
      localActiveAfter: localActiveBefore,
      localActiveBefore,
      localStatusAfter: localStatusBefore,
      localStatusBefore,
      reason: "unsupported_shopify_status",
      selection,
      shopifyStatus,
      subscriptionContractId: normalizedContractId,
    };
  }

  let nextBillingDate: Date | null | undefined;

  if (targetLocal.clearNextBillingDate) {
    nextBillingDate = null;
  } else if (targetLocal.status === SUBSCRIPTION_SELECTION_STATUS.ACTIVE) {
    try {
      nextBillingDate = await fetchSubscriptionContractNextBillingDate(
        admin,
        normalizedContractId,
      );
    } catch (error) {
      logContractSync({
        action: "error",
        localActiveBefore,
        localStatusBefore,
        note: "next_billing_date_fetch_failed_status_sync_continues",
        reason:
          error instanceof Error
            ? error.message
            : "next_billing_date_fetch_failed",
        selectionId: selection.id,
        shop,
        shopifyStatus,
        source,
        subscriptionContractId: normalizedContractId,
        webhookTopic: webhookTopic ?? null,
      });
      nextBillingDate = undefined;
    }
  } else {
    nextBillingDate = undefined;
  }

  if (localStateMatchesTarget(selection, targetLocal, nextBillingDate)) {
    logContractSync({
      action: "unchanged",
      localActiveBefore,
      localStatusBefore,
      reason: "already_in_sync",
      selectionId: selection.id,
      shop,
      shopifyStatus,
      source,
      subscriptionContractId: normalizedContractId,
      webhookTopic: webhookTopic ?? null,
    });

    return {
      action: "unchanged",
      localActiveAfter: localActiveBefore,
      localActiveBefore,
      localStatusAfter: localStatusBefore,
      localStatusBefore,
      reason: "already_in_sync",
      selection,
      shopifyStatus,
      subscriptionContractId: normalizedContractId,
    };
  }

  const updated = await db.subscriptionMealSelection.update({
    data: {
      active: targetLocal.active,
      status: targetLocal.status,
      ...(targetLocal.clearNextBillingDate ? { nextBillingDate: null } : {}),
      ...(nextBillingDate ? { nextBillingDate } : {}),
    },
    where: { id: selection.id },
  });

  logContractSync({
    action: "updated",
    localActiveAfter: updated.active,
    localActiveBefore,
    localStatusAfter: updated.status,
    localStatusBefore,
    reason: "shopify_state_applied",
    selectionId: updated.id,
    shop,
    shopifyStatus,
    source,
    subscriptionContractId: normalizedContractId,
    webhookTopic: webhookTopic ?? null,
  });

  return {
    action: "updated",
    localActiveAfter: updated.active,
    localActiveBefore,
    localStatusAfter: updated.status,
    localStatusBefore,
    reason: "shopify_state_applied",
    selection: updated,
    shopifyStatus,
    subscriptionContractId: normalizedContractId,
  };
};

export const TERMINAL_CONTRACT_ACTION_MESSAGE =
  "Cet abonnement est terminé et ne peut plus être modifié.";

export const getTerminalContractActionMessage = (status: string) => {
  switch (status) {
    case SUBSCRIPTION_SELECTION_STATUS.CANCELLED:
      return "Cet abonnement a été annulé et ne peut plus être modifié.";
    case SUBSCRIPTION_SELECTION_STATUS.EXPIRED:
      return "Cet abonnement est expiré et ne peut plus être modifié.";
    case SUBSCRIPTION_SELECTION_STATUS.FAILED:
      return "Cet abonnement a échoué définitivement et ne peut plus être modifié.";
    case SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE:
      return "Cet abonnement n’est plus disponible.";
    default:
      return TERMINAL_CONTRACT_ACTION_MESSAGE;
  }
};

export const assertSubscriptionContractActionAllowed = (
  selection: SubscriptionMealSelection,
) => {
  if (isTerminalSubscriptionSelectionStatus(selection.status)) {
    return {
      allowed: false as const,
      message: getTerminalContractActionMessage(selection.status),
    };
  }

  if (!selection.subscriptionContractId) {
    return {
      allowed: false as const,
      message: "Contrat d’abonnement Shopify manquant.",
    };
  }

  return { allowed: true as const };
};

export const syncAndAssertSubscriptionContractActionAllowed = async ({
  admin,
  selection,
  shop,
  source,
}: {
  admin: ShopifyAdminGraphql;
  selection: SubscriptionMealSelection;
  shop: string;
  source: SubscriptionContractSyncSource;
}) => {
  if (!selection.subscriptionContractId) {
    return {
      allowed: false as const,
      message: "Contrat d’abonnement Shopify manquant.",
      selection,
      syncResult: null,
    };
  }

  const syncResult = await syncSubscriptionContractState({
    admin,
    shop,
    source,
    subscriptionContractId: selection.subscriptionContractId,
  });

  const freshSelection = syncResult.selection ?? selection;
  const guard = assertSubscriptionContractActionAllowed(freshSelection);

  if (!guard.allowed) {
    return {
      ...guard,
      selection: freshSelection,
      syncResult,
    };
  }

  return {
    allowed: true as const,
    selection: freshSelection,
    syncResult,
  };
};
