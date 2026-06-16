import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";

import db from "../db.server";
import { upsertSubscriptionMealSelectionFromFirstOrder } from "../services/subscriptionMealSelection.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { authenticate } from "../shopify.server";

type LineItemProperty = {
  name?: string;
  value?: unknown;
};

type OrderLineItem = {
  name?: string;
  properties?: LineItemProperty[];
  title?: string;
};

type OrderPayload = {
  contact_email?: string | null;
  customer?: {
    email?: string | null;
    first_name?: string | null;
    id?: number | string | null;
    last_name?: string | null;
  } | null;
  email?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  id?: number | string;
  line_items?: OrderLineItem[];
  name?: string | null;
};

const getPropertyValue = (
  properties: LineItemProperty[] | undefined,
  name: string,
) => {
  const property = properties?.find((item) => item.name === name);

  return property?.value == null ? null : String(property.value);
};

const getSelectedMeals = (properties: LineItemProperty[] | undefined) => {
  const jsonValue = getPropertyValue(properties, "_mileyo_selected_meals_json");

  if (jsonValue) {
    try {
      const parsed = JSON.parse(jsonValue) as unknown;

      if (Array.isArray(parsed)) {
        return parsed.map((meal) => String(meal));
      }
    } catch {
      // Fall back to Plat 1, Plat 2, ...
    }
  }

  return (properties ?? [])
    .filter((property) => property.name?.match(/^Plat \d+$/) && property.value)
    .sort((left, right) => {
      const leftIndex = Number.parseInt(
        left.name?.replace("Plat ", "") ?? "0",
        10,
      );
      const rightIndex = Number.parseInt(
        right.name?.replace("Plat ", "") ?? "0",
        10,
      );

      return leftIndex - rightIndex;
    })
    .map((property) => String(property.value));
};

const getCustomerName = (customer: OrderPayload["customer"]) => {
  const name = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

  console.log(`Received ${topic} webhook for ${shop}`);

  const boxLineItem = order.line_items?.find((lineItem) => {
    const orderType = getPropertyValue(lineItem.properties, "Type de commande");
    const mealsCount = getPropertyValue(lineItem.properties, "Nombre de repas");

    return Boolean(orderType && mealsCount);
  });

  if (!boxLineItem || !order.id) {
    return new Response();
  }

  const orderType = getPropertyValue(boxLineItem.properties, "Type de commande");
  const mealsCount = Number.parseInt(
    getPropertyValue(boxLineItem.properties, "Nombre de repas") ?? "",
    10,
  );
  const selectedMeals = getSelectedMeals(boxLineItem.properties);
  const shopifyOrderId = String(order.id);
  const rawOrder = JSON.parse(JSON.stringify(order)) as Prisma.InputJsonValue;
  const selectedMealsJson = selectedMeals as Prisma.InputJsonValue;
  const customerEmail =
    order.email ?? order.contact_email ?? order.customer?.email ?? null;
  const customerShopifyId = normalizeShopifyId(order.customer?.id);
  const boxTitle = boxLineItem.title ?? boxLineItem.name ?? null;

  await db.boxOrder.upsert({
    create: {
      boxTitle,
      customerEmail,
      customerName: getCustomerName(order.customer),
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,
      mealsCount: Number.isNaN(mealsCount) ? null : mealsCount,
      orderType,
      rawOrder,
      selectedMeals: selectedMealsJson,
      shop,
      shopifyOrderId,
      shopifyOrderName: order.name ?? null,
    },
    update: {
      boxTitle,
      customerEmail,
      customerName: getCustomerName(order.customer),
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,
      mealsCount: Number.isNaN(mealsCount) ? null : mealsCount,
      orderType,
      rawOrder,
      selectedMeals: selectedMealsJson,
      shopifyOrderName: order.name ?? null,
    },
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId,
      },
    },
  });

  await upsertSubscriptionMealSelectionFromFirstOrder({
    boxTitle,
    customerEmail,
    customerShopifyId,
    lineItemProperties: boxLineItem.properties,
    mealsCount: Number.isNaN(mealsCount) ? null : mealsCount,
    orderType,
    rawOrder: order,
    selectedMeals: selectedMealsJson,
    shop,
    shopifyOrderId,
    shopifyOrderName: order.name ?? null,
  });

  return new Response();
};
