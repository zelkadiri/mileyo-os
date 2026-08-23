import type { Prisma } from "@prisma/client";

import db from "../../db.server";
import {
  findMatchingSubscriptionMealSelection,
  hasSelectedMealContent,
  isFirstSubscriptionCheckoutOrder,
  isSubscriptionOrder,
  reconcilePendingContractForSelection,
  reconcileSubscriptionSelectionWithContract,
  type OrdersCreateDecision,
  upsertSubscriptionMealSelectionFromFirstOrder,
  resolveSubscriptionContractId,
} from "../../services/subscriptionMealSelection.server";
import {
  completeResumeRenewalFromWebhook,
  isResumeOrderAlreadyScheduled,
  isResumeRenewalOrder,
} from "../../services/subscriptionBillingWorker.server";
import { closeRecoveryOnSuccessfulOrder } from "../../services/subscriptionPaymentRecovery.server";
import {
  resetSubscriptionPausedEmailSentAt,
  trySendSubscriptionCreatedEmail,
} from "../../services/email/email.server";
import {
  convertCheckoutLead,
  shouldConvertCheckoutLead,
} from "../../services/checkoutLeadConversion.server";
import {
  getPropertyValue,
  getSelectedMealsFromLineItemProperties,
} from "../../utils/orderLineItemProperties";
import { normalizeShopifyId, shopifyIdsMatch } from "../../utils/shopifyIds.server";
import { unauthenticated } from "../../shopify.server";
import {
  alignFirstOrderBillingWithDeliverySchedule,
  alignRenewalBillingWithDeliverySchedule,
  logDeliveryScheduleEvent,
  resolveFirstOrderDeliverySchedule,
  resolveRenewalDeliveryScheduleFromSelection,
  type FirstOrderDeliveryScheduleResolution,
  type RenewalDeliveryScheduleResolution,
} from "../../services/deliverySchedule.server";
import { findBoxLineItem, getCustomerName } from "./orders-create-parsers";
import type { OrdersCreateWebhookPayload } from "./orders-create-types";

const buildBoxOrderDeliveryData = (
  schedule:
    | FirstOrderDeliveryScheduleResolution
    | RenewalDeliveryScheduleResolution
    | null,
) => {
  if (!schedule) {
    return {};
  }

  return {
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
  };
};

const logResolvedDeliverySchedule = ({
  isRenewal,
  schedule,
  shop,
  shopifyOrderId,
}: {
  isRenewal: boolean;
  schedule:
    | FirstOrderDeliveryScheduleResolution
    | RenewalDeliveryScheduleResolution
    | null;
  shop: string;
  shopifyOrderId: string;
}) => {
  if (!schedule) {
    logDeliveryScheduleEvent({
      event: "skipped",
      isRenewal,
      shop,
      shopifyOrderId,
    });
    return;
  }

  logDeliveryScheduleEvent({
    deliveryRescheduleReason: schedule.deliveryRescheduleReason,
    desiredDeliveryDate: schedule.desiredDeliveryDate,
    event: schedule.deliveryRescheduleReason ? "rescheduled" : "scheduled",
    isRenewal,
    referenceDate: schedule.referenceDate,
    scheduledDeliveryDate: schedule.scheduledDeliveryDate,
    shop,
    shopifyOrderId,
  });
};

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

  const isFirstCheckout = isFirstSubscriptionCheckoutOrder({
    lineItemProperties: boxLineItem.properties,
    orderType,
  });

  const subscriptionContractIdRaw = isSubscription
    ? await resolveSubscriptionContractId({
        isSubscription,
        lineItemProperties: boxLineItem.properties,
        rawOrder: order,
        retryOnMiss: isFirstCheckout,
        shop,
        shopifyOrderId,
      })
    : null;
  const subscriptionContractId = subscriptionContractIdRaw
    ? normalizeShopifyId(subscriptionContractIdRaw)
    : null;

  console.log("[SUBSCRIPTION_SELECTION] contract lookup", {
    contractDetected: Boolean(subscriptionContractId),
    isSubscription,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    shop,
    subscriptionContractId,
    subscriptionContractIdRaw,
  });

  let matchedSelection = isSubscription
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

  let reconciliationReason: string | null = null;
  let reconciliationSource: string | null = null;

  if (
    isSubscription &&
    subscriptionContractId &&
    !matchedSelection &&
    !isFirstCheckout
  ) {
    const { admin } = await unauthenticated.admin(shop);
    const reconciled = await reconcileSubscriptionSelectionWithContract({
      admin,
      currentShopifyOrderId: shopifyOrderId,
      shop,
      subscriptionContractId,
    });

    reconciliationReason = reconciled.reason;
    reconciliationSource = reconciled.source;

    if (reconciled.selection) {
      matchedSelection = reconciled.selection;
      console.log("[SUBSCRIPTION_SELECTION] orphan renewal recovered", {
        action: "reconcile_orphan_renewal",
        reason: reconciled.reason,
        selectionId: reconciled.selection.id,
        shopifyOrderId,
        source: reconciled.source,
        subscriptionContractId,
      });
    } else {
      console.log("[SUBSCRIPTION_SELECTION] orphan renewal not recovered", {
        action: "orphan_renewal",
        reason: reconciled.reason,
        shopifyOrderId,
        source: reconciled.source,
        subscriptionContractId,
      });
    }
  }

  const isRenewal = Boolean(isSubscription && matchedSelection);
  let decision: OrdersCreateDecision = "not_subscription";

  if (isSubscription) {
    if (matchedSelection) {
      decision = "attach_existing";
    } else if (subscriptionContractId && !isFirstCheckout) {
      decision = "orphan_renewal";
    } else {
      decision = "create_first_subscription";
    }
  }

  const isFirstOrderReplay = Boolean(
    matchedSelection &&
      shopifyIdsMatch(matchedSelection.shopifyOrderId, shopifyOrderId),
  );
  const isResumeRenewal = Boolean(
    matchedSelection && isResumeRenewalOrder(matchedSelection),
  );
  const shouldConvertLead = shouldConvertCheckoutLead({
    isCreateFirstSubscription: decision === "create_first_subscription",
    isFirstOrderReplay,
    isResumeRenewal,
  });

  const freshMatchedSelection =
    isRenewal && matchedSelection
      ? await db.subscriptionMealSelection.findUnique({
          where: { id: matchedSelection.id },
        })
      : null;

  const selectedMealsSource = isRenewal
    ? "saved_selection"
    : "order_properties";
  const renewalMeals = freshMatchedSelection?.selectedMeals;
  const selectedMealsJson = (
    isRenewal && hasSelectedMealContent(renewalMeals)
      ? renewalMeals
      : hasSelectedMealContent(lineItemSelectedMeals)
        ? lineItemSelectedMeals
        : renewalMeals ?? lineItemSelectedMeals
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

  const orderCreatedAt = order.created_at
    ? new Date(order.created_at)
    : new Date();

  const firstOrderDeliverySchedule = !isRenewal
    ? resolveFirstOrderDeliverySchedule({
        lineItemProperties: boxLineItem.properties,
        orderCreatedAt,
      })
    : null;

  const renewalDeliverySchedule =
    isRenewal && matchedSelection
      ? resolveRenewalDeliveryScheduleFromSelection({
          orderCreatedAt,
          selection: {
            nextScheduledDeliveryDate:
              matchedSelection.nextScheduledDeliveryDate,
            preferredDeliveryWeekday: matchedSelection.preferredDeliveryWeekday,
          },
          selectionId: matchedSelection.id,
          shopifyOrderId,
        })
      : null;

  const deliverySchedule = isRenewal
    ? renewalDeliverySchedule
    : firstOrderDeliverySchedule;

  logResolvedDeliverySchedule({
    isRenewal,
    schedule: deliverySchedule,
    shop,
    shopifyOrderId,
  });

  const boxOrderDeliveryData = buildBoxOrderDeliveryData(deliverySchedule);

  console.log("[SUBSCRIPTION_SELECTION] order processed", {
    decision,
    isFirstOrderReplay,
    isRenewal,
    isResumeRenewal,
    isSubscription,
    matchedSelectionId: matchedSelection?.id ?? null,
    mealSnapshotSource: selectedMealsSource,
    orderId: shopifyOrderId,
    orderName: shopifyOrderName,
    reconciliationReason,
    reconciliationSource,
    shop,
    shouldConvertLead,
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
      subscriptionSelectionId:
        isRenewal || decision === "attach_existing"
          ? (matchedSelection?.id ?? null)
          : null,
      ...boxOrderDeliveryData,
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
      subscriptionSelectionId:
        isRenewal || decision === "attach_existing"
          ? (matchedSelection?.id ?? null)
          : null,
      ...boxOrderDeliveryData,
    },
    where: {
      shop_shopifyOrderId: {
        shop,
        shopifyOrderId,
      },
    },
  });

  if (shouldConvertLead) {
    await convertCheckoutLead({
      email: customerEmail,
      shop,
    });
  }

  if (decision === "create_first_subscription") {
    const selection = await upsertSubscriptionMealSelectionFromFirstOrder({
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

    let linkedSelection = selection;

    if (selection && !normalizeShopifyId(selection.subscriptionContractId)) {
      const { admin } = await unauthenticated.admin(shop);
      const pendingReconciliation = await reconcilePendingContractForSelection({
        admin,
        isSubscription,
        lineItemProperties: boxLineItem.properties,
        rawOrder: order,
        selectionId: selection.id,
        shop,
        shopifyOrderId,
      });

      if (pendingReconciliation.selection) {
        linkedSelection = pendingReconciliation.selection;
        console.log("[SUBSCRIPTION_SELECTION] first order contract reconciled", {
          action: "reconcile_pending_contract",
          reason: pendingReconciliation.reason,
          selectionId: pendingReconciliation.selection.id,
          shopifyOrderId,
          source: pendingReconciliation.source,
          subscriptionContractId:
            pendingReconciliation.selection.subscriptionContractId,
        });
      } else {
        console.log("[SUBSCRIPTION_SELECTION] first order contract pending", {
          action: "pending_contract",
          reason: pendingReconciliation.reason,
          selectionId: selection.id,
          shopifyOrderId,
        });
      }
    }

    if (linkedSelection) {
      await db.boxOrder.update({
        data: { subscriptionSelectionId: linkedSelection.id },
        where: {
          shop_shopifyOrderId: {
            shop,
            shopifyOrderId,
          },
        },
      });

      if (firstOrderDeliverySchedule) {
        await db.subscriptionMealSelection.update({
          data: {
            nextScheduledDeliveryDate:
              firstOrderDeliverySchedule.scheduledDeliveryDate,
            preferredDeliveryWeekday:
              firstOrderDeliverySchedule.preferredDeliveryWeekday,
          },
          where: { id: linkedSelection.id },
        });
      }

      const contractIdForAlignment = normalizeShopifyId(
        linkedSelection.subscriptionContractId,
      );

      if (firstOrderDeliverySchedule || contractIdForAlignment) {
        const { admin } = await unauthenticated.admin(shop);

        await alignFirstOrderBillingWithDeliverySchedule({
          admin,
          firstDeliverySchedule: firstOrderDeliverySchedule,
          selectionId: linkedSelection.id,
          shopifyOrderId,
          subscriptionContractId: contractIdForAlignment,
        });
      }

      try {
        await trySendSubscriptionCreatedEmail({
          selectionId: linkedSelection.id,
        });
      } catch (error) {
        console.log("[ORDERS_CREATE] subscription-created email failed", {
          error: error instanceof Error ? error.message : error,
          selectionId: linkedSelection.id,
          shopifyOrderId,
        });
      }
    }
  }

  if (isRenewal && matchedSelection) {
    if (renewalDeliverySchedule) {
      await db.subscriptionMealSelection.update({
        data: {
          nextScheduledDeliveryDate:
            renewalDeliverySchedule.scheduledDeliveryDate,
        },
        where: { id: matchedSelection.id },
      });
    }

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

          await resetSubscriptionPausedEmailSentAt({
            selectionId: matchedSelection.id,
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
        await alignRenewalBillingWithDeliverySchedule({
          admin,
          renewalScheduledDeliveryDate:
            renewalDeliverySchedule?.scheduledDeliveryDate ?? null,
          selectionId: matchedSelection.id,
          shopifyOrderId,
          subscriptionContractId: contractIdForSync,
        });
      }
    }

    if (isFirstOrderReplay) {
      try {
        await trySendSubscriptionCreatedEmail({
          selectionId: matchedSelection.id,
        });
      } catch (error) {
        console.log("[ORDERS_CREATE] subscription-created email failed", {
          error: error instanceof Error ? error.message : error,
          selectionId: matchedSelection.id,
          shopifyOrderId,
        });
      }
    }
  }
};
