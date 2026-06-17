import type { Prisma } from "@prisma/client";

import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { fetchSubscriptionContractNextBillingDate } from "./subscriptionBillingWorker.server";

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

export type SubscriptionLineItem = {
  properties?: LineItemProperty[];
  selling_plan_allocation?: unknown;
  selling_plan_id?: number | string | null;
};

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

const orderSubscriptionContractQuery = `#graphql
  query OrderSubscriptionContract($id: ID!) {
    order(id: $id) {
      lineItems(first: 50) {
        nodes {
          contract {
            id
          }
        }
      }
    }
  }
`;

type OrderSubscriptionContractResponse = {
  data?: {
    order?: {
      lineItems?: {
        nodes?: { contract?: { id?: string | null } | null }[];
      };
    } | null;
  };
  errors?: unknown;
};

export const fetchSubscriptionContractIdFromOrder = async (
  admin: {
    graphql: (
      query: string,
      options?: { variables?: { id: string } },
    ) => Promise<Response>;
  },
  shopifyOrderId: string,
) => {
  const normalizedOrderId = normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId;
  const orderGid = shopifyOrderId.includes("/")
    ? shopifyOrderId
    : `gid://shopify/Order/${normalizedOrderId}`;

  const response = await admin.graphql(orderSubscriptionContractQuery, {
    variables: { id: orderGid },
  });
  const json = (await response.json()) as OrderSubscriptionContractResponse;

  if (json.errors) {
    console.log(
      "[ORDERS_CREATE] subscriptionContractId GraphQL errors",
      json.errors,
    );
    return null;
  }

  for (const lineItem of json.data?.order?.lineItems?.nodes ?? []) {
    const contractId = lineItem.contract?.id;

    if (contractId) {
      return normalizeShopifyId(contractId);
    }
  }

  return null;
};

export const resolveSubscriptionContractId = async ({
  isSubscription,
  lineItemProperties,
  rawOrder,
  shop,
  shopifyOrderId,
}: {
  isSubscription: boolean;
  lineItemProperties?: LineItemProperty[];
  rawOrder: unknown;
  shop: string;
  shopifyOrderId: string;
}) => {
  const fromPayload = extractSubscriptionContractId(rawOrder, lineItemProperties);

  if (fromPayload) {
    return fromPayload;
  }

  if (!isSubscription) {
    return null;
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    return await fetchSubscriptionContractIdFromOrder(admin, shopifyOrderId);
  } catch (error) {
    console.log("[ORDERS_CREATE] subscriptionContractId lookup failed", {
      error: error instanceof Error ? error.message : error,
      orderId: shopifyOrderId,
    });
    return null;
  }
};

export const isSubscriptionOrder = ({
  boxLineItem,
  lineItemProperties,
  orderType,
  rawOrder,
}: {
  boxLineItem: SubscriptionLineItem;
  lineItemProperties?: LineItemProperty[];
  orderType: string | null;
  rawOrder: unknown;
}) => {
  if (isSubscriptionOrderType(orderType)) {
    return true;
  }

  if (boxLineItem.selling_plan_allocation || boxLineItem.selling_plan_id) {
    return true;
  }

  if (extractSubscriptionContractId(rawOrder, lineItemProperties)) {
    return true;
  }

  const order = rawOrder as { subscription_contracts?: unknown[] };

  return Boolean(order.subscription_contracts?.length);
};

export const findMatchingSubscriptionMealSelection = async ({
  boxTitle,
  customerShopifyId,
  lineItemProperties,
  rawOrder,
  resolvedSubscriptionContractId,
  shop,
  shopifyOrderId,
}: {
  boxTitle: string | null;
  customerShopifyId: string | null;
  lineItemProperties?: LineItemProperty[];
  rawOrder: unknown;
  resolvedSubscriptionContractId?: string | null;
  shop: string;
  shopifyOrderId: string;
}) => {
  const normalizedOrderId = normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId;
  const subscriptionContractId =
    resolvedSubscriptionContractId ??
    extractSubscriptionContractId(rawOrder, lineItemProperties);
  const normalizedCustomerId = normalizeShopifyId(customerShopifyId);

  if (subscriptionContractId) {
    const byContract = await db.subscriptionMealSelection.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        active: true,
        shop,
        shopifyOrderId: { not: normalizedOrderId },
        subscriptionContractId,
      },
    });

    if (byContract) {
      console.log("[SUBSCRIPTION_SELECTION] matched by contract id", {
        selectionId: byContract.id,
        shopifyOrderId: normalizedOrderId,
        subscriptionContractId,
      });
      return byContract;
    }

    console.log(
      "[SUBSCRIPTION_SELECTION] no match for contract id, treating as first order",
      {
        shopifyOrderId: normalizedOrderId,
        subscriptionContractId,
      },
    );
    return null;
  }

  if (!normalizedCustomerId || !boxTitle) {
    return null;
  }

  const fallbackMatches = await db.subscriptionMealSelection.findMany({
    orderBy: { updatedAt: "desc" },
    where: {
      active: true,
      boxTitle,
      customerShopifyId: normalizedCustomerId,
      shop,
      shopifyOrderId: { not: normalizedOrderId },
    },
  });

  if (fallbackMatches.length === 1) {
    console.log("[SUBSCRIPTION_SELECTION] fallback matched", {
      selectionId: fallbackMatches[0].id,
      boxTitle,
      customerShopifyId: normalizedCustomerId,
      shopifyOrderId: normalizedOrderId,
    });
    return fallbackMatches[0];
  }

  if (fallbackMatches.length > 1) {
    console.log("[SUBSCRIPTION_SELECTION] fallback ambiguous skipped", {
      boxTitle,
      customerShopifyId: normalizedCustomerId,
      matchCount: fallbackMatches.length,
      selectionIds: fallbackMatches.map((selection) => selection.id),
      shopifyOrderId: normalizedOrderId,
    });
  }

  return null;
};

export const upsertSubscriptionMealSelectionFromFirstOrder = async ({
  boxTitle,
  customerEmail,
  customerShopifyId,
  isSubscription,
  mealsCount,
  orderType,
  rawOrder,
  selectedMeals,
  shop,
  shopifyOrderId,
  shopifyOrderName,
  lineItemProperties,
  subscriptionContractId: subscriptionContractIdOverride,
}: {
  boxTitle: string | null;
  customerEmail: string | null;
  customerShopifyId: string | null;
  isSubscription: boolean;
  mealsCount: number | null;
  orderType: string | null;
  rawOrder: unknown;
  selectedMeals: Prisma.InputJsonValue;
  shop: string;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  lineItemProperties?: LineItemProperty[];
  subscriptionContractId?: string | null;
}) => {
  const normalizedOrderId = normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId;

  if (!isSubscription) {
    console.log("[SUBSCRIPTION_SELECTION] skipped", {
      reason: "not_subscription",
      shopifyOrderId: normalizedOrderId,
      orderType,
    });
    return null;
  }

  console.log("[SUBSCRIPTION_SELECTION] create/upsert start", {
    shopifyOrderId: normalizedOrderId,
    orderType,
    subscriptionContractId: subscriptionContractIdOverride ?? null,
  });

  try {
    const subscriptionContractId =
      subscriptionContractIdOverride ??
      extractSubscriptionContractId(rawOrder, lineItemProperties);

    const normalizedCustomerId = normalizeShopifyId(customerShopifyId);
    let nextBillingDate: Date | null = null;

    if (subscriptionContractId) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        nextBillingDate = await fetchSubscriptionContractNextBillingDate(
          admin,
          subscriptionContractId,
        );
      } catch (error) {
        console.log("[subscriptionMealSelection] nextBillingDate sync failed", {
          error: error instanceof Error ? error.message : error,
          subscriptionContractId,
        });
      }
    }

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
      ...(nextBillingDate ? { nextBillingDate } : {}),
    };

    const existing = await db.subscriptionMealSelection.findFirst({
      where: {
        shop,
        shopifyOrderId: normalizedOrderId,
      },
    });

    if (existing) {
      const result = await db.subscriptionMealSelection.update({
        data,
        where: { id: existing.id },
      });

      console.log("[SUBSCRIPTION_SELECTION] created/upserted", {
        action: "upserted",
        id: result.id,
        shopifyOrderId: normalizedOrderId,
        subscriptionContractId: result.subscriptionContractId ?? null,
      });

      return result;
    }

    const result = await db.subscriptionMealSelection.create({
      data: {
        ...data,
        shop,
        shopifyOrderId: normalizedOrderId,
      },
    });

    console.log("[SUBSCRIPTION_SELECTION] first subscription selection created", {
      id: result.id,
      shopifyOrderId: normalizedOrderId,
      subscriptionContractId: result.subscriptionContractId ?? null,
    });

    console.log("[SUBSCRIPTION_SELECTION] created/upserted", {
      action: "created",
      id: result.id,
      shopifyOrderId: normalizedOrderId,
      subscriptionContractId: result.subscriptionContractId ?? null,
    });

    return result;
  } catch (error) {
    console.log("[SUBSCRIPTION_SELECTION] error", {
      error: error instanceof Error ? error.message : error,
      shopifyOrderId: normalizedOrderId,
      orderType,
    });
    throw error;
  }
};
