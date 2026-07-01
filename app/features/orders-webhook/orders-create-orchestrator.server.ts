import type { Prisma } from "@prisma/client";

import db from "../../db.server";
import {
  findMatchingSubscriptionMealSelection,
  isFirstSubscriptionCheckoutOrder,
  isSubscriptionOrder,
  resolveSubscriptionContractId,
  type OrdersCreateDecision,
  upsertSubscriptionMealSelectionFromFirstOrder,
} from "../../services/subscriptionMealSelection.server";
import {
  completeResumeRenewalFromWebhook,
  fetchSubscriptionContractNextBillingDate,
  isResumeOrderAlreadyScheduled,
  isResumeRenewalOrder,
} from "../../services/subscriptionBillingWorker.server";
import { closeRecoveryOnSuccessfulOrder } from "../../services/subscriptionPaymentRecovery.server";
import {
  getPropertyValue,
  getSelectedMealsFromLineItemProperties,
} from "../../utils/orderLineItemProperties";
import { normalizeShopifyId } from "../../utils/shopifyIds.server";
import { unauthenticated } from "../../shopify.server";
import { findBoxLineItem, getCustomerName } from "./orders-create-parsers";
import type { OrdersCreateWebhookPayload } from "./orders-create-types";

export const handleOrdersCreateWebhook = async ({
  payload,
  shop,
  topic,
}: {
  payload: OrdersCreateWebhookPayload;
  shop: string;
  topic: string;
}) => {
  const order = payload;

  console.log(`[ORDERS_CREATE] Received ${topic} webhook for ${shop}`);

  const boxLineItem = findBoxLineItem(order);

  if (!boxLineItem || !order.id) {
    return;
  }

  const shopifyOrderId = String(order.id);
  const shopifyOrderName = order.name ?? null;
  const orderType = getPropertyValue(boxLineItem.properties, "Type de commande");
  const parsedMealsCount = Number.parseInt(
    getPropertyValue(boxLineItem.properties, "Nombre de repas") ?? "",
    10,
  );
  const lineItemSelectedMeals = getSelectedMealsFromLineItemProperties(
    boxLineItem.properties,
  );
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

  const subscriptionContractIdRaw = isSubscription
    ? await resolveSubscriptionContractId({
        isSubscription,
        lineItemProperties: boxLineItem.properties,
        rawOrder: order,
        shop,
        shopifyOrderId,
      })
    : null;
  const subscriptionContractId = subscriptionContractIdRaw
    ? normalizeShopifyId(subscriptionContractIdRaw)
    : null;

  console.log("[ORDERS_CREATE] Subscription contract lookup", {
    isSubscription,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    shop,
    subscriptionContractId,
    subscriptionContractIdFound: Boolean(subscriptionContractId),
    subscriptionContractIdRaw,
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
  let decision: OrdersCreateDecision = "not_subscription";

  if (isSubscription) {
    if (matchedSelection) {
      decision = "attach_existing";
    } else if (
      subscriptionContractId &&
      !isFirstSubscriptionCheckoutOrder({
        lineItemProperties: boxLineItem.properties,
        orderType,
      })
    ) {
      decision = "orphan_renewal";
    } else {
      decision = "create_first_subscription";
    }
  }

  const freshMatchedSelection =
    isRenewal && matchedSelection
      ? await db.subscriptionMealSelection.findUnique({
          where: { id: matchedSelection.id },
        })
      : null;

  const selectedMealsSource = isRenewal
    ? "saved_selection"
    : "order_properties";
  const selectedMealsJson = (
    isRenewal && freshMatchedSelection?.selectedMeals
      ? freshMatchedSelection.selectedMeals
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
    ? (subscriptionContractId ??
      normalizeShopifyId(matchedSelection?.subscriptionContractId) ??
      null)
    : null;

  console.log("[ORDERS_CREATE] Processed order", {
    decision,
    isRenewal,
    isSubscription,
    matchedSelectionId: matchedSelection?.id ?? null,
    mealSnapshotSource: selectedMealsSource,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    shop,
    subscriptionContractId: resolvedSubscriptionContractId,
    subscriptionContractIdNormalized: subscriptionContractId,
    subscriptionContractIdRaw,
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

  if (decision === "create_first_subscription") {
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
    if (
      subscriptionContractId &&
      normalizeShopifyId(matchedSelection.subscriptionContractId) !==
        subscriptionContractId
    ) {
      await db.subscriptionMealSelection.update({
        data: { subscriptionContractId },
        where: { id: matchedSelection.id },
      });
    }

    try {
      await closeRecoveryOnSuccessfulOrder({
        orderId: shopifyOrderId,
        selectionId: matchedSelection.id,
      });
    } catch (error) {
      console.log("[ORDERS_CREATE] recovery close failed", {
        error: error instanceof Error ? error.message : error,
        selectionId: matchedSelection.id,
        shopifyOrderId,
      });
    }

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
      const freshSelection = await db.subscriptionMealSelection.findUnique({
        where: { id: matchedSelection.id },
      });

      const { admin } = await unauthenticated.admin(shop);
      const orderCreatedAt = order.created_at
        ? new Date(order.created_at)
        : new Date();

      if (freshSelection && isResumeRenewalOrder(freshSelection)) {
        console.log("[ORDERS_CREATE] resume renewal — scheduling from order date", {
          orderCreatedAt: orderCreatedAt.toISOString(),
          resumeAttemptKey: freshSelection.resumeAttemptKey,
          resumeAttemptStatus: freshSelection.resumeAttemptStatus,
          selectionId: matchedSelection.id,
          shopifyOrderId,
        });

        try {
          await completeResumeRenewalFromWebhook({
            admin,
            orderCreatedAt,
            selectionId: matchedSelection.id,
            shopifyOrderId,
            subscriptionContractId: contractIdForSync,
          });
        } catch (error) {
          console.log("[ORDERS_CREATE] resume renewal scheduling failed", {
            error: error instanceof Error ? error.message : error,
            selectionId: matchedSelection.id,
            shopifyOrderId,
          });
        }
      } else if (
        freshSelection &&
        isResumeOrderAlreadyScheduled(freshSelection, shopifyOrderId)
      ) {
        console.log("[ORDERS_CREATE] nextBillingDate sync skipped", {
          reason: "resume_already_scheduled",
          nextBillingDate: freshSelection.nextBillingDate?.toISOString() ?? null,
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
  }
};
