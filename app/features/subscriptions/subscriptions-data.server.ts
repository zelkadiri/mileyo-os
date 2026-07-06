import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import {
  isTerminalPortalDisplayStatus,
} from "../../constants/subscriptionStatus";
import db from "../../db.server";
import { authenticate } from "../../shopify.server";
import { dedupeSubscriptionSelectionsByContract } from "../../services/subscriptionMealSelection.server";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import { isSubscriptionTestActionsEnabled } from "./subscriptions-test.server";
import type { SubscriptionsPageData, SubscriptionStatusCounts } from "./subscriptions-types";

export const loadSubscriptionsPageData = async (
  request: Request,
): Promise<SubscriptionsPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const allSelections = await db.subscriptionMealSelection.findMany({
    orderBy: { updatedAt: "desc" },
    where: { shop },
  });
  const selections = dedupeSubscriptionSelectionsByContract(allSelections).sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
  const hiddenDuplicateCount = allSelections.length - selections.length;
  const boxOrders = await db.boxOrder.findMany({
    where: {
      shop,
      shopifyOrderId: {
        in: selections.map((selection) => selection.shopifyOrderId),
      },
    },
  });
  const customerNameByOrderId = new Map(
    boxOrders.map((order) => [order.shopifyOrderId, order.customerName]),
  );

  const paymentRecoveries = await db.subscriptionPaymentRecovery.findMany({
    include: { subscriptionMealSelection: true },
    orderBy: [{ nextRetryAt: "asc" }, { updatedAt: "desc" }],
    where: {
      shop,
      status: {
        in: [
          RECOVERY_STATUS.PROCESSING,
          RECOVERY_STATUS.RETRY_SCHEDULED,
          RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
          RECOVERY_STATUS.EMAIL_SEND_FAILED,
          RECOVERY_STATUS.FINAL_FAILED,
        ],
      },
    },
  });

  const statusCounts: SubscriptionStatusCounts = {
    active: 0,
    cancelled: 0,
    expired: 0,
    failed: 0,
    other: 0,
    paused: 0,
  };

  for (const selection of selections) {
    switch (selection.status) {
      case "active":
        statusCounts.active += 1;
        break;
      case "paused":
        statusCounts.paused += 1;
        break;
      case "cancelled":
        statusCounts.cancelled += 1;
        break;
      case "expired":
        statusCounts.expired += 1;
        break;
      case "failed":
        statusCounts.failed += 1;
        break;
      default:
        statusCounts.other += 1;
    }
  }

  return {
    hiddenDuplicateCount,
    paymentRecoveries: paymentRecoveries.map((recovery) => {
      const canonicalSelection = allSelections.find(
        (selection) => selection.id === recovery.subscriptionMealSelectionId,
      );
      const contractId = normalizeShopifyId(
        canonicalSelection?.subscriptionContractId,
      );
      const resolvedSelection = contractId
        ? (selections.find(
            (selection) =>
              normalizeShopifyId(selection.subscriptionContractId) ===
              contractId,
          ) ?? canonicalSelection)
        : canonicalSelection;

      return {
        boxTitle: resolvedSelection?.boxTitle ?? recovery.subscriptionMealSelection.boxTitle,
        boxSubscriptionPrice:
          resolvedSelection?.boxSubscriptionPrice ??
          recovery.subscriptionMealSelection.boxSubscriptionPrice,
        customerEmail: recovery.subscriptionMealSelection.customerEmail,
        customerName:
          customerNameByOrderId.get(
            recovery.subscriptionMealSelection.shopifyOrderId,
          ) ?? null,
        failureCount: recovery.failureCount,
        id: recovery.id,
        lastErrorCode: recovery.lastErrorCode,
        lastErrorMessage: recovery.lastErrorMessage,
        mealsCount:
          resolvedSelection?.mealsCount ??
          recovery.subscriptionMealSelection.mealsCount,
        nextRetryAt: recovery.nextRetryAt,
        selectionId: recovery.subscriptionMealSelectionId,
        shopifyOrderName: recovery.subscriptionMealSelection.shopifyOrderName,
        status: recovery.status,
      };
    }),
    selections: selections.map((selection) => ({
      active: selection.active,
      boxSubscriptionPrice: selection.boxSubscriptionPrice,
      boxTitle: selection.boxTitle,
      createdAt: selection.createdAt,
      customerEmail: selection.customerEmail,
      customerName: customerNameByOrderId.get(selection.shopifyOrderId) ?? null,
      id: selection.id,
      isTerminal: isTerminalPortalDisplayStatus(selection.status),
      lastBillingAttemptAt: selection.lastBillingAttemptAt,
      lastBillingAttemptError: selection.lastBillingAttemptError,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus,
      mealsCount: selection.mealsCount,
      nextBillingDate: selection.nextBillingDate,
      selectedMeals: selection.selectedMeals,
      shopifyOrderId: selection.shopifyOrderId,
      shopifyOrderName: selection.shopifyOrderName,
      status: selection.status,
      subscriptionContractId: selection.subscriptionContractId,
      updatedAt: selection.updatedAt,
    })),
    showSubscriptionTestActions: isSubscriptionTestActionsEnabled(),
    statusCounts,
  };
};
