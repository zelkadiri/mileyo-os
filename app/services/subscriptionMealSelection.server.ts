import { Prisma, type SubscriptionMealSelection } from "@prisma/client";

import {
  isArchivedDuplicateSelection,
  SUBSCRIPTION_SELECTION_STATUS,
} from "../constants/subscriptionMealSelection";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getPropertyValue,
  type LineItemProperty,
} from "../utils/orderLineItemProperties";
import {
  normalizeShopifyId,
  shopifyIdsMatch,
  subscriptionContractIdOrFilter,
  toShopifyOrderGid,
  toSubscriptionContractGid,
} from "../utils/shopifyIds.server";
import {
  fetchSubscriptionContractNextBillingDate,
} from "./subscriptionBillingWorker.server";

export { toSubscriptionContractGid };

type ShopifyAdminGraphql = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

const CONTRACT_LOOKUP_RETRY_MS = 2_000;

export const hasSelectedMealContent = (value: unknown) => {
  if (!value) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((meal) => String(meal).trim().length > 0);
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }

  return false;
};

export type SubscriptionSelectionReconciliationSource =
  | "contract_id"
  | "origin_order_selection"
  | "origin_box_order_selection"
  | "origin_box_order_create"
  | "first_order_graphql";

export type SubscriptionSelectionReconciliationResult = {
  reason: string;
  selection: SubscriptionMealSelection | null;
  source: SubscriptionSelectionReconciliationSource | null;
};

export type OrdersCreateDecision =
  | "attach_existing"
  | "create_first_subscription"
  | "orphan_renewal"
  | "not_subscription";

export const isPrismaUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

export const pickCanonicalSubscriptionSelection = <
  T extends { active: boolean; createdAt: Date; status: string; updatedAt: Date },
>(
  left: T,
  right: T,
) => {
  if (isArchivedDuplicateSelection(left.status)) {
    return right;
  }

  if (isArchivedDuplicateSelection(right.status)) {
    return left;
  }

  const leftActive = left.status === "active" && left.active;
  const rightActive = right.status === "active" && right.active;

  if (leftActive !== rightActive) {
    return leftActive ? left : right;
  }

  if (left.updatedAt.getTime() !== right.updatedAt.getTime()) {
    return left.updatedAt >= right.updatedAt ? left : right;
  }

  return left.createdAt <= right.createdAt ? left : right;
};

const canonicalSelectionWhere = ({
  excludeShopifyOrderId,
  shop,
  subscriptionContractId,
}: {
  excludeShopifyOrderId?: string | null;
  shop: string;
  subscriptionContractId: string;
}): Prisma.SubscriptionMealSelectionWhereInput => {
  const normalizedContractId =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;
  const normalizedExcludeOrderId = excludeShopifyOrderId
    ? (normalizeShopifyId(excludeShopifyOrderId) ?? excludeShopifyOrderId)
    : null;

  return {
    shop,
    status: { not: SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE },
    ...subscriptionContractIdOrFilter(normalizedContractId),
    ...(normalizedExcludeOrderId
      ? { shopifyOrderId: { not: normalizedExcludeOrderId } }
      : {}),
  };
};

/** Deterministic canonical lookup — use everywhere a selection is resolved by contract. */
export const findSubscriptionMealSelectionByContractId = async ({
  excludeShopifyOrderId,
  shop,
  subscriptionContractId,
}: {
  excludeShopifyOrderId?: string | null;
  shop: string;
  subscriptionContractId: string;
}) => {
  const candidates = await db.subscriptionMealSelection.findMany({
    where: canonicalSelectionWhere({
      excludeShopifyOrderId,
      shop,
      subscriptionContractId,
    }),
  });

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const canonical = candidates.reduce(pickCanonicalSubscriptionSelection);

  console.log("[SUBSCRIPTION_SELECTION] canonical picked among contract duplicates", {
    candidateCount: candidates.length,
    canonicalId: canonical.id,
    canonicalOrder: canonical.shopifyOrderName,
    shop,
    subscriptionContractId: normalizeShopifyId(subscriptionContractId),
  });

  return canonical;
};

export const findCanonicalSubscriptionMealSelectionByContractId =
  findSubscriptionMealSelectionByContractId;

export const findDuplicateSubscriptionSelectionsByContract = async ({
  shop,
}: {
  shop?: string;
} = {}) => {
  const selections = await db.subscriptionMealSelection.findMany({
    orderBy: { createdAt: "asc" },
    where: {
      subscriptionContractId: { not: null },
      status: { not: SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE },
      ...(shop ? { shop } : {}),
    },
  });

  const groups = new Map<string, SubscriptionMealSelection[]>();

  for (const selection of selections) {
    const contractId = normalizeShopifyId(selection.subscriptionContractId);

    if (!contractId) {
      continue;
    }

    const group = groups.get(contractId) ?? [];
    group.push(selection);
    groups.set(contractId, group);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([contractId, items]) => ({ contractId, items }));
};

export const archiveDuplicateSubscriptionSelection = async ({
  canonicalId,
  duplicateId,
}: {
  canonicalId: string;
  duplicateId: string;
}) => {
  const [canonical, duplicate] = await Promise.all([
    db.subscriptionMealSelection.findUnique({ where: { id: canonicalId } }),
    db.subscriptionMealSelection.findUnique({ where: { id: duplicateId } }),
  ]);

  if (!canonical || !duplicate) {
    throw new Error("Canonical or duplicate selection not found.");
  }

  const canonicalContract = normalizeShopifyId(canonical.subscriptionContractId);
  const duplicateContract = normalizeShopifyId(duplicate.subscriptionContractId);

  if (!canonicalContract || canonicalContract !== duplicateContract) {
    throw new Error(
      `Contract IDs do not match (${canonicalContract} vs ${duplicateContract}).`,
    );
  }

  const boxOrders = await db.boxOrder.findMany({
    where: { subscriptionSelectionId: duplicateId },
  });

  await db.$transaction([
    db.boxOrder.updateMany({
      data: { subscriptionSelectionId: canonicalId },
      where: { subscriptionSelectionId: duplicateId },
    }),
    db.subscriptionMealSelection.update({
      data: {
        active: false,
        status: SUBSCRIPTION_SELECTION_STATUS.ARCHIVED_DUPLICATE,
        subscriptionContractId: null,
      },
      where: { id: duplicateId },
    }),
  ]);

  return {
    boxOrdersRepointed: boxOrders.length,
    canonicalId,
    duplicateId,
    subscriptionContractId: canonicalContract,
  };
};

export const isSubscriptionOrderType = (orderType: string | null | undefined) =>
  Boolean(orderType?.toLowerCase().includes("abonnement"));

/** Checkout first order from box-builder (not a cron/resume billing renewal). */
export const isFirstSubscriptionCheckoutOrder = ({
  lineItemProperties,
  orderType,
}: {
  lineItemProperties?: LineItemProperty[];
  orderType: string | null;
}) => {
  if (isSubscriptionOrderType(orderType)) {
    return true;
  }

  const mealsCount = getPropertyValue(lineItemProperties, "Nombre de repas");
  const orderTypeProperty = getPropertyValue(
    lineItemProperties,
    "Type de commande",
  );
  const mealsJson = getPropertyValue(
    lineItemProperties,
    "_mileyo_selected_meals_json",
  );

  return Boolean(mealsCount && (orderTypeProperty || mealsJson));
};

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
  const orderGid = toShopifyOrderGid(shopifyOrderId);

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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const resolveSubscriptionContractId = async ({
  isSubscription,
  lineItemProperties,
  rawOrder,
  retryOnMiss = false,
  shop,
  shopifyOrderId,
}: {
  isSubscription: boolean;
  lineItemProperties?: LineItemProperty[];
  rawOrder: unknown;
  retryOnMiss?: boolean;
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
    const fromGraphql = await fetchSubscriptionContractIdFromOrder(
      admin,
      shopifyOrderId,
    );

    if (fromGraphql || !retryOnMiss) {
      return fromGraphql;
    }

    console.log("[SUBSCRIPTION_SELECTION] contract lookup retry scheduled", {
      delayMs: CONTRACT_LOOKUP_RETRY_MS,
      shopifyOrderId,
    });
    await sleep(CONTRACT_LOOKUP_RETRY_MS);

    return await fetchSubscriptionContractIdFromOrder(admin, shopifyOrderId);
  } catch (error) {
    console.log("[SUBSCRIPTION_SELECTION] contract lookup failed", {
      error: error instanceof Error ? error.message : error,
      orderId: shopifyOrderId,
    });
    return null;
  }
};

const subscriptionContractOriginOrderQuery = `#graphql
  query SubscriptionContractOriginOrder($id: ID!) {
    subscriptionContract(id: $id) {
      id
      originOrder {
        id
      }
    }
  }
`;

type SubscriptionContractOriginOrderResponse = {
  data?: {
    subscriptionContract?: {
      id?: string | null;
      originOrder?: { id?: string | null } | null;
    } | null;
  };
  errors?: unknown;
};

export const fetchSubscriptionContractOriginOrderId = async (
  admin: ShopifyAdminGraphql,
  subscriptionContractId: string,
) => {
  const response = await admin.graphql(subscriptionContractOriginOrderQuery, {
    variables: { id: toSubscriptionContractGid(subscriptionContractId) },
  });
  const json = (await response.json()) as SubscriptionContractOriginOrderResponse;

  if (json.errors) {
    console.log("[SUBSCRIPTION_SELECTION] origin order GraphQL errors", {
      errors: json.errors,
      subscriptionContractId,
    });
    return null;
  }

  const originOrderId = json.data?.subscriptionContract?.originOrder?.id;

  return originOrderId ? normalizeShopifyId(originOrderId) : null;
};

export const findSubscriptionMealSelectionByShopifyOrderId = async ({
  shop,
  shopifyOrderId,
}: {
  shop: string;
  shopifyOrderId: string;
}) => {
  const normalizedOrderId = normalizeShopifyId(shopifyOrderId) ?? shopifyOrderId;

  return db.subscriptionMealSelection.findFirst({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    where: {
      shop,
      shopifyOrderId: normalizedOrderId,
    },
  });
};

export const safeLinkSubscriptionContractToSelection = async ({
  admin,
  selectionId,
  shop,
  source,
  subscriptionContractId,
}: {
  admin?: ShopifyAdminGraphql;
  selectionId: string;
  shop: string;
  source: SubscriptionSelectionReconciliationSource;
  subscriptionContractId: string;
}): Promise<
  | { ok: true; selection: SubscriptionMealSelection }
  | { ok: false; reason: string }
> => {
  const normalizedContractId =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;

  const current = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!current) {
    return { ok: false, reason: "selection_not_found" };
  }

  const existingContract = normalizeShopifyId(current.subscriptionContractId);

  if (
    existingContract &&
    existingContract !== normalizedContractId
  ) {
    console.log("[SUBSCRIPTION_SELECTION] link refused — different contract", {
      existingContractId: existingContract,
      incomingContractId: normalizedContractId,
      selectionId,
      source,
    });
    return { ok: false, reason: "selection_already_has_different_contract" };
  }

  const conflict = await findSubscriptionMealSelectionByContractId({
    excludeShopifyOrderId: current.shopifyOrderId,
    shop,
    subscriptionContractId: normalizedContractId,
  });

  if (conflict && conflict.id !== selectionId) {
    console.log("[SUBSCRIPTION_SELECTION] link conflict — using existing canonical", {
      canonicalSelectionId: conflict.id,
      incomingContractId: normalizedContractId,
      selectionId,
      source,
    });
    return { ok: true, selection: conflict };
  }

  let nextBillingDate = current.nextBillingDate;

  if (admin && !nextBillingDate) {
    try {
      nextBillingDate = await fetchSubscriptionContractNextBillingDate(
        admin,
        normalizedContractId,
      );
    } catch (error) {
      console.log("[SUBSCRIPTION_SELECTION] nextBillingDate sync failed during link", {
        error: error instanceof Error ? error.message : error,
        selectionId,
        subscriptionContractId: normalizedContractId,
      });
    }
  }

  try {
    const selection = await db.subscriptionMealSelection.update({
      data: {
        subscriptionContractId: normalizedContractId,
        ...(nextBillingDate ? { nextBillingDate } : {}),
      },
      where: { id: selectionId },
    });

    console.log("[SUBSCRIPTION_SELECTION] contract linked", {
      action: "link_contract",
      reason: "linked",
      selectionId,
      shopifyOrderId: selection.shopifyOrderId,
      source,
      subscriptionContractId: normalizedContractId,
    });

    return { ok: true, selection };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await findSubscriptionMealSelectionByContractId({
      shop,
      subscriptionContractId: normalizedContractId,
    });

    if (!existing) {
      throw error;
    }

    console.log("[SUBSCRIPTION_SELECTION] unique constraint conflict — using existing", {
      existingSelectionId: existing.id,
      selectionId,
      source,
      subscriptionContractId: normalizedContractId,
    });

    return { ok: true, selection: existing };
  }
};

export const recoverSelectionFromOriginBoxOrder = async ({
  admin,
  originShopifyOrderId,
  shop,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  originShopifyOrderId: string;
  shop: string;
  subscriptionContractId: string;
}) => {
  const normalizedOriginOrderId =
    normalizeShopifyId(originShopifyOrderId) ?? originShopifyOrderId;
  const existingByOrder = await findSubscriptionMealSelectionByShopifyOrderId({
    shop,
    shopifyOrderId: normalizedOriginOrderId,
  });

  if (existingByOrder) {
    const linked = await safeLinkSubscriptionContractToSelection({
      admin,
      selectionId: existingByOrder.id,
      shop,
      source: "origin_order_selection",
      subscriptionContractId,
    });

    if (linked.ok) {
      return {
        reason: "linked_existing_origin_order_selection",
        selection: linked.selection,
        source: "origin_order_selection" as const,
      };
    }

    return {
      reason: linked.reason,
      selection: null,
      source: "origin_order_selection" as const,
    };
  }

  const originBoxOrder = await db.boxOrder.findUnique({
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId: normalizedOriginOrderId,
      },
    },
  });

  if (!originBoxOrder) {
    return {
      reason: "origin_box_order_not_found",
      selection: null,
      source: null,
    };
  }

  if (originBoxOrder.subscriptionSelectionId) {
    const linkedSelection = await db.subscriptionMealSelection.findUnique({
      where: { id: originBoxOrder.subscriptionSelectionId },
    });

    if (linkedSelection) {
      const linked = await safeLinkSubscriptionContractToSelection({
        admin,
        selectionId: linkedSelection.id,
        shop,
        source: "origin_box_order_selection",
        subscriptionContractId,
      });

      if (linked.ok) {
        return {
          reason: "linked_box_order_selection",
          selection: linked.selection,
          source: "origin_box_order_selection" as const,
        };
      }

      return {
        reason: linked.reason,
        selection: null,
        source: "origin_box_order_selection" as const,
      };
    }
  }

  if (!hasSelectedMealContent(originBoxOrder.selectedMeals)) {
    return {
      reason: "origin_box_order_has_no_meals",
      selection: null,
      source: null,
    };
  }

  const rawOrder = originBoxOrder.rawOrder as {
    customer?: { id?: number | string; email?: string | null };
  };
  const normalizedContractId =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;
  let nextBillingDate: Date | null = null;

  try {
    nextBillingDate = await fetchSubscriptionContractNextBillingDate(
      admin,
      normalizedContractId,
    );
  } catch (error) {
    console.log("[SUBSCRIPTION_SELECTION] nextBillingDate fetch failed during recovery", {
      error: error instanceof Error ? error.message : error,
      subscriptionContractId: normalizedContractId,
    });
  }

  const selection = await db.subscriptionMealSelection.create({
    data: {
      active: true,
      boxTitle: originBoxOrder.boxTitle,
      customerEmail: originBoxOrder.customerEmail,
      customerShopifyId: normalizeShopifyId(rawOrder.customer?.id),
      mealsCount: originBoxOrder.mealsCount,
      selectedMeals: originBoxOrder.selectedMeals as Prisma.InputJsonValue,
      shop,
      shopifyOrderId: normalizedOriginOrderId,
      shopifyOrderName: originBoxOrder.shopifyOrderName,
      status: "active",
      subscriptionContractId: normalizedContractId,
      ...(nextBillingDate ? { nextBillingDate } : {}),
    },
  }).catch(async (error) => {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await findSubscriptionMealSelectionByContractId({
      shop,
      subscriptionContractId: normalizedContractId,
    });

    if (!existing) {
      throw error;
    }

    console.log("[SUBSCRIPTION_SELECTION] create conflict — using existing canonical", {
      existingSelectionId: existing.id,
      originShopifyOrderId: normalizedOriginOrderId,
      subscriptionContractId: normalizedContractId,
    });

    return existing;
  });

  await db.boxOrder.update({
    data: { subscriptionSelectionId: selection.id },
    where: { id: originBoxOrder.id },
  });

  console.log("[SUBSCRIPTION_SELECTION] recovered from origin BoxOrder", {
    action: "recover_from_box_order",
    originShopifyOrderId: normalizedOriginOrderId,
    selectionId: selection.id,
    subscriptionContractId: normalizedContractId,
  });

  return {
    reason: "created_from_origin_box_order",
    selection,
    source: "origin_box_order_create" as const,
  };
};

export const reconcileSubscriptionSelectionWithContract = async ({
  admin,
  currentShopifyOrderId,
  shop,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  currentShopifyOrderId?: string | null;
  shop: string;
  subscriptionContractId: string;
}): Promise<SubscriptionSelectionReconciliationResult> => {
  const normalizedContractId =
    normalizeShopifyId(subscriptionContractId) ?? subscriptionContractId;

  console.log("[SUBSCRIPTION_SELECTION] reconciliation start", {
    currentShopifyOrderId: currentShopifyOrderId ?? null,
    shop,
    subscriptionContractId: normalizedContractId,
  });

  const byContract = await findSubscriptionMealSelectionByContractId({
    shop,
    subscriptionContractId: normalizedContractId,
  });

  if (byContract) {
    console.log("[SUBSCRIPTION_SELECTION] reconciliation matched existing contract", {
      selectionId: byContract.id,
      source: "contract_id",
      subscriptionContractId: normalizedContractId,
    });
    return {
      reason: "already_linked",
      selection: byContract,
      source: "contract_id",
    };
  }

  const originOrderId = await fetchSubscriptionContractOriginOrderId(
    admin,
    normalizedContractId,
  );

  if (!originOrderId) {
    console.log("[SUBSCRIPTION_SELECTION] reconciliation failed", {
      reason: "origin_order_unavailable",
      subscriptionContractId: normalizedContractId,
    });
    return {
      reason: "origin_order_unavailable",
      selection: null,
      source: null,
    };
  }

  if (
    currentShopifyOrderId &&
    shopifyIdsMatch(originOrderId, currentShopifyOrderId)
  ) {
    const currentOrderSelection = await findSubscriptionMealSelectionByShopifyOrderId({
      shop,
      shopifyOrderId: currentShopifyOrderId,
    });

    if (currentOrderSelection) {
      const linked = await safeLinkSubscriptionContractToSelection({
        admin,
        selectionId: currentOrderSelection.id,
        shop,
        source: "origin_order_selection",
        subscriptionContractId: normalizedContractId,
      });

      if (linked.ok) {
        return {
          reason: "linked_current_order_selection",
          selection: linked.selection,
          source: "origin_order_selection",
        };
      }

      return {
        reason: linked.reason,
        selection: null,
        source: "origin_order_selection",
      };
    }
  }

  const originRecovery = await recoverSelectionFromOriginBoxOrder({
    admin,
    originShopifyOrderId: originOrderId,
    shop,
    subscriptionContractId: normalizedContractId,
  });

  if (originRecovery.selection) {
    return originRecovery;
  }

  console.log("[SUBSCRIPTION_SELECTION] reconciliation failed", {
    originOrderId,
    reason: originRecovery.reason,
    subscriptionContractId: normalizedContractId,
  });

  return {
    reason: originRecovery.reason,
    selection: null,
    source: originRecovery.source,
  };
};

export const reconcilePendingContractForSelection = async ({
  admin,
  isSubscription,
  lineItemProperties,
  rawOrder = null,
  selectionId,
  shop,
  shopifyOrderId,
}: {
  admin: ShopifyAdminGraphql;
  isSubscription: boolean;
  lineItemProperties?: LineItemProperty[];
  rawOrder?: unknown;
  selectionId: string;
  shop: string;
  shopifyOrderId: string;
}): Promise<SubscriptionSelectionReconciliationResult> => {
  const contractId = await resolveSubscriptionContractId({
    isSubscription,
    lineItemProperties,
    rawOrder,
    retryOnMiss: true,
    shop,
    shopifyOrderId,
  });

  if (!contractId) {
    console.log("[SUBSCRIPTION_SELECTION] pending contract still missing", {
      reason: "contract_still_unavailable",
      selectionId,
      shopifyOrderId,
    });
    return {
      reason: "contract_still_unavailable",
      selection: null,
      source: null,
    };
  }

  const linked = await safeLinkSubscriptionContractToSelection({
    admin,
    selectionId,
    shop,
    source: "first_order_graphql",
    subscriptionContractId: contractId,
  });

  if (!linked.ok) {
    return {
      reason: linked.reason,
      selection: null,
      source: "first_order_graphql",
    };
  }

  return {
    reason: "linked_after_first_order_lookup",
    selection: linked.selection,
    source: "first_order_graphql",
  };
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
  const subscriptionContractId = normalizeShopifyId(
    resolvedSubscriptionContractId ??
      extractSubscriptionContractId(rawOrder, lineItemProperties),
  );

  const byCurrentOrder = await findSubscriptionMealSelectionByShopifyOrderId({
    shop,
    shopifyOrderId: normalizedOrderId,
  });

  if (byCurrentOrder) {
    console.log("[SUBSCRIPTION_SELECTION] matched by checkout order id", {
      selectionId: byCurrentOrder.id,
      shopifyOrderId: normalizedOrderId,
      subscriptionContractId: byCurrentOrder.subscriptionContractId ?? null,
    });
    return byCurrentOrder;
  }

  if (subscriptionContractId) {
    const byContract = await findSubscriptionMealSelectionByContractId({
      excludeShopifyOrderId: normalizedOrderId,
      shop,
      subscriptionContractId,
    });

    if (byContract) {
      console.log("[SUBSCRIPTION_SELECTION] matched by contract id", {
        selectionId: byContract.id,
        shopifyOrderId: normalizedOrderId,
        subscriptionContractId,
        subscriptionContractIdStored: byContract.subscriptionContractId,
      });
      return byContract;
    }

    console.log("[SUBSCRIPTION_SELECTION] no local selection for contract", {
      action: "await_reconciliation",
      shopifyOrderId: normalizedOrderId,
      subscriptionContractId,
    });
    return null;
  }

  if (!normalizedOrderId) {
    return null;
  }

  console.log("[SUBSCRIPTION_SELECTION] contract missing — no unsafe fallback", {
    boxTitle,
    customerShopifyId: normalizeShopifyId(customerShopifyId),
    shopifyOrderId: normalizedOrderId,
  });

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
    const subscriptionContractId = normalizeShopifyId(
      subscriptionContractIdOverride ??
        extractSubscriptionContractId(rawOrder, lineItemProperties),
    );

    if (subscriptionContractId) {
      const existingByContract = await findSubscriptionMealSelectionByContractId({
        shop,
        subscriptionContractId,
      });

      if (existingByContract) {
        console.log(
          "[SUBSCRIPTION_SELECTION] skipped create — contract already linked",
          {
            existingSelectionId: existingByContract.id,
            existingShopifyOrderId: existingByContract.shopifyOrderId,
            shopifyOrderId: normalizedOrderId,
            subscriptionContractId,
          },
        );
        return existingByContract;
      }
    }

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
      ...(subscriptionContractId ? { subscriptionContractId } : {}),
      ...(nextBillingDate ? { nextBillingDate } : {}),
    };

    const existing = await db.subscriptionMealSelection.findFirst({
      where: {
        shop,
        shopifyOrderId: normalizedOrderId,
      },
    });

    if (existing) {
      const resolvedMeals = hasSelectedMealContent(selectedMeals)
        ? selectedMeals
        : (existing.selectedMeals as Prisma.InputJsonValue | null);

      const updateData: Prisma.SubscriptionMealSelectionUpdateInput = {
        ...data,
        ...(resolvedMeals != null ? { selectedMeals: resolvedMeals } : {}),
        subscriptionContractId:
          subscriptionContractId ??
          normalizeShopifyId(existing.subscriptionContractId) ??
          existing.subscriptionContractId,
      };

      const result = await db.subscriptionMealSelection.update({
        data: updateData,
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
    }).catch(async (error) => {
      if (!isPrismaUniqueConstraintError(error) || !subscriptionContractId) {
        throw error;
      }

      const existing = await findSubscriptionMealSelectionByContractId({
        shop,
        subscriptionContractId,
      });

      if (!existing) {
        throw error;
      }

      console.log("[SUBSCRIPTION_SELECTION] create conflict — using existing canonical", {
        existingSelectionId: existing.id,
        shopifyOrderId: normalizedOrderId,
        subscriptionContractId,
      });

      return existing;
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
    if (isPrismaUniqueConstraintError(error)) {
      const contractId = normalizeShopifyId(
        subscriptionContractIdOverride ??
          extractSubscriptionContractId(rawOrder, lineItemProperties),
      );

      if (contractId) {
        const existing = await findSubscriptionMealSelectionByContractId({
          shop,
          subscriptionContractId: contractId,
        });

        if (existing) {
          console.log("[SUBSCRIPTION_SELECTION] upsert unique conflict — using existing", {
            existingSelectionId: existing.id,
            shopifyOrderId: normalizedOrderId,
            subscriptionContractId: contractId,
          });
          return existing;
        }
      }
    }

    console.log("[SUBSCRIPTION_SELECTION] error", {
      error: error instanceof Error ? error.message : error,
      shopifyOrderId: normalizedOrderId,
      orderType,
    });
    throw error;
  }
};

export const dedupeSubscriptionSelectionsByContract = <
  T extends {
    active: boolean;
    createdAt: Date;
    id: string;
    shopifyOrderName: string | null;
    status: string;
    subscriptionContractId: string | null;
    updatedAt: Date;
  },
>(
  records: T[],
) => {
  const byContract = new Map<string, T>();
  const withoutContract: T[] = [];

  for (const record of records) {
    if (isArchivedDuplicateSelection(record.status)) {
      continue;
    }

    const contractId = normalizeShopifyId(record.subscriptionContractId);

    if (!contractId) {
      withoutContract.push(record);
      continue;
    }

    const existing = byContract.get(contractId);

    byContract.set(
      contractId,
      existing
        ? pickCanonicalSubscriptionSelection(existing, record)
        : record,
    );
  }

  return [...byContract.values(), ...withoutContract];
};
