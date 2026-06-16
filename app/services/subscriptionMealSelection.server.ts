import type { Prisma } from "@prisma/client";

import db from "../db.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";

type LineItemProperty = {
  name?: string;
  value?: unknown;
};

const getPropertyValue = (
  properties: LineItemProperty[] | undefined,
  name: string,
) => {
  const property = properties?.find((item) => item.name === name);

  return property?.value == null ? null : String(property.value);
};

export const isSubscriptionOrderType = (orderType: string | null | undefined) =>
  Boolean(orderType?.toLowerCase().includes("abonnement"));

export const extractSubscriptionContractId = (
  rawOrder: unknown,
  properties?: LineItemProperty[],
) => {
  const order = rawOrder as {
    subscription_contracts?: {
      admin_graphql_api_id?: string | null;
      id?: number | string | null;
    }[];
  };

  const fromContract =
    order.subscription_contracts?.[0]?.id ??
    order.subscription_contracts?.[0]?.admin_graphql_api_id;

  if (fromContract != null) {
    return normalizeShopifyId(fromContract);
  }

  return (
    normalizeShopifyId(
      getPropertyValue(properties, "subscription_contract_id"),
    ) ??
    normalizeShopifyId(getPropertyValue(properties, "Contrat abonnement"))
  );
};

export const upsertSubscriptionMealSelectionFromFirstOrder = async ({
  boxTitle,
  customerEmail,
  customerShopifyId,
  mealsCount,
  orderType,
  rawOrder,
  selectedMeals,
  shop,
  shopifyOrderId,
  shopifyOrderName,
  lineItemProperties,
}: {
  boxTitle: string | null;
  customerEmail: string | null;
  customerShopifyId: string | null;
  mealsCount: number | null;
  orderType: string | null;
  rawOrder: unknown;
  selectedMeals: Prisma.InputJsonValue;
  shop: string;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  lineItemProperties?: LineItemProperty[];
}) => {
  if (!isSubscriptionOrderType(orderType)) {
    return null;
  }

  const normalizedOrderId = normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId;
  const subscriptionContractId = extractSubscriptionContractId(
    rawOrder,
    lineItemProperties,
  );

  const normalizedCustomerId = normalizeShopifyId(customerShopifyId);
  const data = {
    active: true,
    boxTitle,
    customerEmail,
    customerShopifyId: normalizedCustomerId,
    mealsCount,
    selectedMeals,
    shopifyOrderName,
    status: "active",
    subscriptionContractId,
  };

  const existing = await db.subscriptionMealSelection.findFirst({
    where: {
      shop,
      shopifyOrderId: normalizedOrderId,
    },
  });

  if (existing) {
    return db.subscriptionMealSelection.update({
      data,
      where: { id: existing.id },
    });
  }

  return db.subscriptionMealSelection.create({
    data: {
      ...data,
      shop,
      shopifyOrderId: normalizedOrderId,
    },
  });
};
