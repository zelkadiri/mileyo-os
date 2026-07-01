import {
  getPropertyValue,
  type LineItemProperty,
} from "../../utils/orderLineItemProperties";
import type {
  OrderCustomerPayload,
  OrdersCreateWebhookPayload,
} from "./orders-create-types";

export const getCustomerName = (
  customer: OrderCustomerPayload | null | undefined,
) => {
  const name = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
};

export const findBoxLineItem = (order: OrdersCreateWebhookPayload) => {
  const lineItems = order.line_items ?? [];

  const withBoxProperties = lineItems.find((lineItem) => {
    const orderType = getPropertyValue(lineItem.properties, "Type de commande");
    const mealsCount = getPropertyValue(lineItem.properties, "Nombre de repas");

    return Boolean(orderType && mealsCount);
  });

  if (withBoxProperties) {
    return withBoxProperties;
  }

  const withSellingPlan = lineItems.find(
    (lineItem) => lineItem.selling_plan_allocation || lineItem.selling_plan_id,
  );

  if (withSellingPlan) {
    return withSellingPlan;
  }

  if (order.subscription_contracts?.length && lineItems.length > 0) {
    return lineItems[0];
  }

  return null;
};

export type { LineItemProperty };
