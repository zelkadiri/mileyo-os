import db from "../../db.server";
import { authenticate } from "../../shopify.server";
import { dedupeSubscriptionSelectionsByContract } from "../../services/subscriptionMealSelection.server";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import type { AdminOrderDto, OrdersPageData } from "./orders-types";

export const loadOrdersPageData = async (
  request: Request,
): Promise<OrdersPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [orders, allSelections] = await Promise.all([
    db.boxOrder.findMany({
      orderBy: { createdAt: "desc" },
      where: { shop },
    }),
    db.subscriptionMealSelection.findMany({
      where: { shop },
    }),
  ]);

  const selections = dedupeSubscriptionSelectionsByContract(allSelections);
  const selectionByOrderId = new Map(
    selections.map((selection) => [selection.shopifyOrderId, selection]),
  );
  const selectionByContractId = new Map(
    selections.flatMap((selection) => {
      const contractId = normalizeShopifyId(selection.subscriptionContractId);
      return contractId ? [[contractId, selection] as const] : [];
    }),
  );
  const selectionById = new Map(
    selections.map((selection) => [selection.id, selection]),
  );

  return {
    orders: orders.map((order) => {
      const linkedSelection =
        (order.subscriptionSelectionId
          ? selectionById.get(order.subscriptionSelectionId)
          : null) ??
        selectionByOrderId.get(order.shopifyOrderId) ??
        (order.subscriptionContractId
          ? selectionByContractId.get(
              normalizeShopifyId(order.subscriptionContractId) ??
                order.subscriptionContractId,
            )
          : null);

      const mapped: AdminOrderDto = {
        boxTitle: order.boxTitle,
        cancelledAt: order.cancelledAt,
        createdAt: order.createdAt,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        financialStatus: order.financialStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        futureBoxTitle: linkedSelection?.boxTitle ?? null,
        futureMealsCount: linkedSelection?.mealsCount ?? null,
        futureSelectedMeals: linkedSelection?.selectedMeals ?? null,
        futureSubscriptionPrice: linkedSelection?.boxSubscriptionPrice ?? null,
        futureUpdatedAt: linkedSelection?.updatedAt ?? null,
        id: order.id,
        isSubscriptionRenewal: order.isSubscriptionRenewal,
        mealsCount: order.mealsCount,
        orderType: order.orderType,
        selectedMeals: order.selectedMeals,
        selectedMealsSource: order.selectedMealsSource,
        shopifyOrderId: order.shopifyOrderId,
        shopifyOrderName: order.shopifyOrderName,
        simulated: order.simulated,
      };

      return mapped;
    }),
  };
};
