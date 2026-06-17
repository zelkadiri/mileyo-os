import type { ActionFunctionArgs } from "react-router";
import type { Prisma } from "@prisma/client";

import db from "../db.server";
import {
  findMatchingSubscriptionMealSelection,
  isSubscriptionOrder,
  resolveSubscriptionContractId,
  upsertSubscriptionMealSelectionFromFirstOrder,
} from "../services/subscriptionMealSelection.server";
import { fetchSubscriptionContractNextBillingDate } from "../services/subscriptionBillingWorker.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { authenticate, unauthenticated } from "../shopify.server";

type LineItemProperty = {
  name?: string;
  value?: unknown;
};

type OrderLineItem = {
  name?: string;
  properties?: LineItemProperty[];
  selling_plan_allocation?: unknown;
  selling_plan_id?: number | string | null;
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
  subscription_contracts?: unknown[];
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

const findBoxLineItem = (order: OrderPayload) => {
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

  console.log(`[ORDERS_CREATE] Received ${topic} webhook for ${shop}`);

  const boxLineItem = findBoxLineItem(order);

  if (!boxLineItem || !order.id) {
    return new Response();
  }

  const shopifyOrderId = String(order.id);
  const shopifyOrderName = order.name ?? null;
  const orderType = getPropertyValue(boxLineItem.properties, "Type de commande");
  const parsedMealsCount = Number.parseInt(
    getPropertyValue(boxLineItem.properties, "Nombre de repas") ?? "",
    10,
  );
  const lineItemSelectedMeals = getSelectedMeals(boxLineItem.properties);
  const rawOrder = JSON.parse(JSON.stringify(order)) as Prisma.InputJsonValue;
  const customerEmail =
    order.email ?? order.contact_email ?? order.customer?.email ?? null;
  const customerShopifyId = normalizeShopifyId(order.customer?.id);
  const boxTitle = boxLineItem.title ?? boxLineItem.name ?? null;

  const isSubscription = isSubscriptionOrder({
    boxLineItem,
    lineItemProperties: boxLineItem.properties,
    orderType,
    rawOrder: order,
  });

  const subscriptionContractId = isSubscription
    ? await resolveSubscriptionContractId({
        isSubscription,
        lineItemProperties: boxLineItem.properties,
        rawOrder: order,
        shop,
        shopifyOrderId,
      })
    : null;

  console.log("[ORDERS_CREATE] Subscription contract lookup", {
    isSubscription,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    shop,
    subscriptionContractId: subscriptionContractId ?? null,
    subscriptionContractIdFound: Boolean(subscriptionContractId),
  });

  const matchedSelection = isSubscription
    ? await findMatchingSubscriptionMealSelection({
        boxTitle,
        customerShopifyId,
        lineItemProperties: boxLineItem.properties,
        rawOrder: order,
        resolvedSubscriptionContractId: subscriptionContractId,
        shop,
        shopifyOrderId,
      })
    : null;

  const isRenewal = Boolean(isSubscription && matchedSelection);
  const selectedMealsSource = isRenewal
    ? "subscription_future_selection"
    : "line_item_properties";
  const selectedMealsJson = (
    isRenewal && matchedSelection?.selectedMeals
      ? matchedSelection.selectedMeals
      : lineItemSelectedMeals
  ) as Prisma.InputJsonValue;
  const resolvedOrderType =
    orderType ?? (isSubscription ? "Abonnement hebdomadaire" : null);
  const resolvedMealsCount = isRenewal
    ? (matchedSelection?.mealsCount ?? null)
    : Number.isNaN(parsedMealsCount)
      ? null
      : parsedMealsCount;
  const resolvedBoxTitle = isRenewal
    ? (matchedSelection?.boxTitle ?? boxTitle)
    : boxTitle;
  const resolvedSubscriptionContractId = isSubscription
    ? (subscriptionContractId ?? matchedSelection?.subscriptionContractId ?? null)
    : null;

  console.log("[ORDERS_CREATE] Processed order", {
    isRenewal,
    isSubscription,
    matchedSelectionId: matchedSelection?.id ?? null,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    selectedMealsSource,
    shop,
    subscriptionContractId: resolvedSubscriptionContractId,
  });

  await db.boxOrder.upsert({
    create: {
      boxTitle: resolvedBoxTitle,
      customerEmail,
      customerName: getCustomerName(order.customer),
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,
      isSubscriptionRenewal: isRenewal,
      mealsCount: resolvedMealsCount,
      orderType: resolvedOrderType,
      rawOrder,
      selectedMeals: selectedMealsJson,
      selectedMealsSource,
      shop,
      shopifyOrderId,
      shopifyOrderName,
      subscriptionContractId: resolvedSubscriptionContractId,
      subscriptionSelectionId: isRenewal ? matchedSelection?.id ?? null : null,
    },
    update: {
      boxTitle: resolvedBoxTitle,
      customerEmail,
      customerName: getCustomerName(order.customer),
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,
      isSubscriptionRenewal: isRenewal,
      mealsCount: resolvedMealsCount,
      orderType: resolvedOrderType,
      rawOrder,
      selectedMeals: selectedMealsJson,
      selectedMealsSource,
      shopifyOrderName,
      subscriptionContractId: resolvedSubscriptionContractId,
      subscriptionSelectionId: isRenewal ? matchedSelection?.id ?? null : null,
    },
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId,
      },
    },
  });

  if (isSubscription && !isRenewal) {
    await upsertSubscriptionMealSelectionFromFirstOrder({
      boxTitle,
      customerEmail,
      customerShopifyId,
      isSubscription,
      lineItemProperties: boxLineItem.properties,
      mealsCount: resolvedMealsCount,
      orderType: resolvedOrderType,
      rawOrder: order,
      selectedMeals: lineItemSelectedMeals as Prisma.InputJsonValue,
      shop,
      shopifyOrderId,
      shopifyOrderName,
      subscriptionContractId: resolvedSubscriptionContractId,
    });
  }

  if (isRenewal && matchedSelection) {
    const contractIdForSync =
      resolvedSubscriptionContractId ??
      matchedSelection.subscriptionContractId;

    if (!contractIdForSync) {
      console.log("[ORDERS_CREATE] nextBillingDate sync skipped", {
        reason: "missing_subscription_contract_id",
        selectionId: matchedSelection.id,
        shopifyOrderId,
      });
    } else {
      console.log("[ORDERS_CREATE] nextBillingDate sync start", {
        selectionId: matchedSelection.id,
        shopifyOrderId,
        subscriptionContractId: contractIdForSync,
      });

      try {
        const { admin } = await unauthenticated.admin(shop);
        const nextBillingDate = await fetchSubscriptionContractNextBillingDate(
          admin,
          contractIdForSync,
        );

        if (!nextBillingDate) {
          console.log("[ORDERS_CREATE] nextBillingDate sync skipped", {
            reason: "no_date_returned",
            selectionId: matchedSelection.id,
            shopifyOrderId,
            subscriptionContractId: contractIdForSync,
          });
        } else {
          await db.subscriptionMealSelection.update({
            data: { nextBillingDate },
            where: { id: matchedSelection.id },
          });

          console.log("[ORDERS_CREATE] nextBillingDate synced", {
            nextBillingDate: nextBillingDate.toISOString(),
            selectionId: matchedSelection.id,
            shopifyOrderId,
            subscriptionContractId: contractIdForSync,
          });
        }
      } catch (error) {
        console.log("[ORDERS_CREATE] nextBillingDate sync failed", {
          error: error instanceof Error ? error.message : error,
          selectionId: matchedSelection.id,
          shopifyOrderId,
          subscriptionContractId: contractIdForSync,
        });
      }
    }
  }

  return new Response();
};
