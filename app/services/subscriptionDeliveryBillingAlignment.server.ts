import { isTerminalSubscriptionSelectionStatus } from "../constants/subscriptionMealSelection";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../constants/boxOrder";
import db from "../db.server";
import {
  projectActiveScheduledDeliveryDate,
  type DeliveryDateString,
} from "../utils/deliveryDate";
import {
  resolveBillingCycleDateForDelivery,
  resolveNextBillingCycleAfterDelivery,
} from "../utils/subscriptionBillingSchedule";
import {
  fetchSubscriptionContractNextBillingDate,
  setSubscriptionContractNextBillingDate,
  type ShopifyAdminGraphql,
} from "./subscriptionBillingWorker.server";

export const BILLING_DATE_ALIGNMENT_TOLERANCE_MS = 60_000;

export type DeliveryBillingAlignmentAction =
  | "ok_already_aligned"
  | "would_update_db"
  | "would_update_shopify_and_db"
  | "skipped_missing_delivery_context"
  | "skipped_inactive_contract"
  | "skipped_invalid_data"
  | "failed_shopify_update";

export type DeliveryBillingAlignmentAudit = {
  action: DeliveryBillingAlignmentAction;
  activeDeliveryDate: DeliveryDateString | null;
  hasBoxOrderForActiveDelivery: boolean;
  projectedActiveDeliveryDate: DeliveryDateString | null;
  recommendedNextBillingDate: Date | null;
  shopifyNextBillingDate: Date | null;
  storedNextBillingDate: Date | null;
};

export const areBillingDatesAligned = (
  stored: Date | null | undefined,
  recommended: Date | null,
  toleranceMs = BILLING_DATE_ALIGNMENT_TOLERANCE_MS,
): boolean => {
  if (!stored || !recommended) {
    return false;
  }

  return Math.abs(stored.getTime() - recommended.getTime()) <= toleranceMs;
};

export const resolveRecommendedNextBillingDate = ({
  activeDeliveryDate,
  hasBoxOrderForActiveDelivery,
}: {
  activeDeliveryDate: DeliveryDateString;
  hasBoxOrderForActiveDelivery: boolean;
}): Date | null => {
  if (hasBoxOrderForActiveDelivery) {
    return resolveNextBillingCycleAfterDelivery(activeDeliveryDate);
  }

  return resolveBillingCycleDateForDelivery(activeDeliveryDate);
};

export const resolveProjectedActiveDeliveryDate = ({
  nextScheduledDeliveryDate,
  now = new Date(),
  preferredDeliveryWeekday,
}: {
  nextScheduledDeliveryDate: string | null;
  now?: Date;
  preferredDeliveryWeekday: number | null;
}): DeliveryDateString | null =>
  projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate,
    now,
    preferredDeliveryWeekday,
  }).effectiveDeliveryDate;

export const hasSubscriptionBoxOrderForDeliveryDate = async ({
  activeDeliveryDate,
  selectionId,
  shop,
  subscriptionContractId,
}: {
  activeDeliveryDate: DeliveryDateString;
  selectionId: string;
  shop: string;
  subscriptionContractId: string | null;
}): Promise<boolean> => {
  const match = await db.boxOrder.findFirst({
    select: { id: true },
    where: {
      scheduledDeliveryDate: activeDeliveryDate,
      shop,
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
      OR: [
        { subscriptionSelectionId: selectionId },
        ...(subscriptionContractId
          ? [{ subscriptionContractId }]
          : []),
      ],
    },
  });

  return Boolean(match);
};

const resolveAlignmentAction = ({
  recommendedNextBillingDate,
  shopifyNextBillingDate,
  storedNextBillingDate,
}: {
  recommendedNextBillingDate: Date | null;
  shopifyNextBillingDate: Date | null;
  storedNextBillingDate: Date | null;
}): DeliveryBillingAlignmentAction => {
  if (!recommendedNextBillingDate) {
    return "skipped_missing_delivery_context";
  }

  const dbAligned = areBillingDatesAligned(
    storedNextBillingDate,
    recommendedNextBillingDate,
  );
  const shopifyAligned = areBillingDatesAligned(
    shopifyNextBillingDate,
    recommendedNextBillingDate,
  );

  if (dbAligned && shopifyAligned) {
    return "ok_already_aligned";
  }

  if (dbAligned && !shopifyAligned) {
    return shopifyNextBillingDate ? "would_update_shopify_and_db" : "would_update_db";
  }

  if (!dbAligned && shopifyAligned) {
    return "would_update_db";
  }

  return "would_update_shopify_and_db";
};

export const computeDeliveryBillingAlignmentAudit = ({
  hasBoxOrderForActiveDelivery,
  projectedActiveDeliveryDate,
  selection,
  shopifyNextBillingDate = null,
}: {
  hasBoxOrderForActiveDelivery: boolean;
  projectedActiveDeliveryDate: DeliveryDateString | null;
  selection: {
    active: boolean;
    nextBillingDate: Date | null;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
    status: string;
    subscriptionContractId: string | null;
  };
  shopifyNextBillingDate?: Date | null;
}): DeliveryBillingAlignmentAudit => {
  if (isTerminalSubscriptionSelectionStatus(selection.status)) {
    return {
      action: "skipped_inactive_contract",
      activeDeliveryDate: projectedActiveDeliveryDate,
      hasBoxOrderForActiveDelivery,
      projectedActiveDeliveryDate,
      recommendedNextBillingDate: null,
      shopifyNextBillingDate,
      storedNextBillingDate: selection.nextBillingDate,
    };
  }

  if (!selection.active || selection.status !== "active") {
    return {
      action: "skipped_inactive_contract",
      activeDeliveryDate: projectedActiveDeliveryDate,
      hasBoxOrderForActiveDelivery,
      projectedActiveDeliveryDate,
      recommendedNextBillingDate: null,
      shopifyNextBillingDate,
      storedNextBillingDate: selection.nextBillingDate,
    };
  }

  if (!projectedActiveDeliveryDate) {
    return {
      action: "skipped_missing_delivery_context",
      activeDeliveryDate: null,
      hasBoxOrderForActiveDelivery,
      projectedActiveDeliveryDate: null,
      recommendedNextBillingDate: null,
      shopifyNextBillingDate,
      storedNextBillingDate: selection.nextBillingDate,
    };
  }

  const recommendedNextBillingDate = resolveRecommendedNextBillingDate({
    activeDeliveryDate: projectedActiveDeliveryDate,
    hasBoxOrderForActiveDelivery,
  });

  if (!recommendedNextBillingDate) {
    return {
      action: "skipped_invalid_data",
      activeDeliveryDate: projectedActiveDeliveryDate,
      hasBoxOrderForActiveDelivery,
      projectedActiveDeliveryDate,
      recommendedNextBillingDate: null,
      shopifyNextBillingDate,
      storedNextBillingDate: selection.nextBillingDate,
    };
  }

  return {
    action: resolveAlignmentAction({
      recommendedNextBillingDate,
      shopifyNextBillingDate,
      storedNextBillingDate: selection.nextBillingDate,
    }),
    activeDeliveryDate: projectedActiveDeliveryDate,
    hasBoxOrderForActiveDelivery,
    projectedActiveDeliveryDate,
    recommendedNextBillingDate,
    shopifyNextBillingDate,
    storedNextBillingDate: selection.nextBillingDate,
  };
};

export const auditSubscriptionDeliveryBillingAlignment = async ({
  admin,
  now = new Date(),
  selection,
}: {
  admin?: ShopifyAdminGraphql;
  now?: Date;
  selection: {
    active: boolean;
    id: string;
    nextBillingDate: Date | null;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
    shop: string;
    status: string;
    subscriptionContractId: string | null;
  };
}): Promise<DeliveryBillingAlignmentAudit> => {
  const projectedActiveDeliveryDate = resolveProjectedActiveDeliveryDate({
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
    now,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
  });

  if (!projectedActiveDeliveryDate) {
    return computeDeliveryBillingAlignmentAudit({
      hasBoxOrderForActiveDelivery: false,
      projectedActiveDeliveryDate: null,
      selection,
      shopifyNextBillingDate: null,
    });
  }

  const hasBoxOrderForActiveDelivery =
    await hasSubscriptionBoxOrderForDeliveryDate({
      activeDeliveryDate: projectedActiveDeliveryDate,
      selectionId: selection.id,
      shop: selection.shop,
      subscriptionContractId: selection.subscriptionContractId,
    });

  let shopifyNextBillingDate: Date | null = null;

  if (admin && selection.subscriptionContractId) {
    try {
      shopifyNextBillingDate = await fetchSubscriptionContractNextBillingDate(
        admin,
        selection.subscriptionContractId,
      );
    } catch {
      shopifyNextBillingDate = null;
    }
  }

  return computeDeliveryBillingAlignmentAudit({
    hasBoxOrderForActiveDelivery,
    projectedActiveDeliveryDate,
    selection,
    shopifyNextBillingDate,
  });
};

export const applySubscriptionDeliveryBillingAlignment = async ({
  admin,
  audit,
  selectionId,
  subscriptionContractId,
}: {
  admin: ShopifyAdminGraphql;
  audit: DeliveryBillingAlignmentAudit;
  selectionId: string;
  subscriptionContractId: string;
}): Promise<DeliveryBillingAlignmentAudit> => {
  if (
    audit.action === "ok_already_aligned" ||
    audit.action.startsWith("skipped_")
  ) {
    return audit;
  }

  if (!audit.recommendedNextBillingDate) {
    return {
      ...audit,
      action: "skipped_missing_delivery_context",
    };
  }

  try {
    const shopifyUpdate = await setSubscriptionContractNextBillingDate(
      admin,
      subscriptionContractId,
      audit.recommendedNextBillingDate,
    );

    if (!shopifyUpdate.ok) {
      console.log("[DELIVERY_BILLING_ALIGNMENT] apply failed", {
        error: shopifyUpdate.error,
        selectionId,
        subscriptionContractId,
        targetNextBillingDate: audit.recommendedNextBillingDate.toISOString(),
      });

      return {
        ...audit,
        action: "failed_shopify_update",
      };
    }

    await db.subscriptionMealSelection.update({
      data: { nextBillingDate: shopifyUpdate.nextBillingDate },
      where: { id: selectionId },
    });

    console.log("[DELIVERY_BILLING_ALIGNMENT] applied", {
      alignedNextBillingDate: shopifyUpdate.nextBillingDate.toISOString(),
      selectionId,
      subscriptionContractId,
    });

    return {
      ...audit,
      action: "ok_already_aligned",
      shopifyNextBillingDate: shopifyUpdate.nextBillingDate,
      storedNextBillingDate: shopifyUpdate.nextBillingDate,
    };
  } catch (error) {
    console.log("[DELIVERY_BILLING_ALIGNMENT] apply failed", {
      error: error instanceof Error ? error.message : error,
      selectionId,
      subscriptionContractId,
      targetNextBillingDate: audit.recommendedNextBillingDate.toISOString(),
    });

    return {
      ...audit,
      action: "failed_shopify_update",
    };
  }
};
