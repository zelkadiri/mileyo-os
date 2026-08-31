/**
 * BOX-CHANGE-7D — write-through current-delivery meal titles onto the matching
 * BoxOrder so kitchen preparation sees portal edits before cutoff.
 *
 * Never mutates BoxOrder.mealsCount (paid box size stays frozen).
 * Never creates a BoxOrder (unpaid / not-yet-ordered cycles stay selection-only).
 */
import type { Prisma } from "@prisma/client";

import { normalizeShopifyId } from "../utils/shopifyIds.server";
import { KITCHEN_PREPARATION_BOX_ORDER_WHERE } from "../constants/boxOrder";

/** Existing BoxOrder.selectedMealsSource values — not a new column. */
export const PORTAL_CURRENT_DELIVERY_MEALS_SOURCE =
  "portal_current_delivery_edit" as const;

export type CurrentDeliveryMealsDb = {
  $transaction: <T>(
    fn: (tx: CurrentDeliveryMealsDb) => Promise<T>,
  ) => Promise<T>;
  boxOrder: {
    findMany: (args: {
      take?: number;
      where: Record<string, unknown>;
    }) => Promise<
      {
        id: string;
        mealsCount: number | null;
        selectedMeals: unknown;
      }[]
    >;
    update: (args: {
      data: {
        selectedMeals: Prisma.InputJsonValue;
        selectedMealsSource: string;
      };
      where: { id: string };
    }) => Promise<unknown>;
  };
  subscriptionMealSelection: {
    update: (args: {
      data: {
        mealSelectionLastExplicitDeliveryDate?: string;
        selectedMeals: Prisma.InputJsonValue;
      };
      where: { id: string };
    }) => Promise<unknown>;
  };
};

export type ApplyCurrentDeliveryMealSelectionResult =
  | {
      boxOrderId: string | null;
      boxOrderSynced: boolean;
      ok: true;
    }
  | {
      boxOrderId: string;
      error: "box_order_meals_count_mismatch" | "ambiguous_box_order";
      ok: false;
    };

/**
 * Locate the operational BoxOrder for this selection's current delivery date.
 * Prefer subscriptionSelectionId; fall back to contract + date when the link is missing.
 * Ambiguous matches fail closed (caller must not claim success).
 */
export const findCurrentDeliveryBoxOrder = async ({
  db,
  effectiveDeliveryDate,
  shop,
  subscriptionContractId,
  subscriptionSelectionId,
}: {
  db: CurrentDeliveryMealsDb;
  effectiveDeliveryDate: string;
  shop: string;
  subscriptionContractId?: string | null;
  subscriptionSelectionId: string;
}): Promise<
  | { boxOrder: { id: string; mealsCount: number | null }; ok: true }
  | { error: "ambiguous_box_order"; ok: false }
  | { boxOrder: null; ok: true }
> => {
  const bySelection = await db.boxOrder.findMany({
    take: 2,
    where: {
      scheduledDeliveryDate: effectiveDeliveryDate,
      shop,
      subscriptionSelectionId,
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
    },
  });

  if (bySelection.length > 1) {
    return { error: "ambiguous_box_order", ok: false };
  }

  if (bySelection.length === 1) {
    return { boxOrder: bySelection[0]!, ok: true };
  }

  const contractId = normalizeShopifyId(subscriptionContractId);

  if (!contractId) {
    return { boxOrder: null, ok: true };
  }

  const byContract = await db.boxOrder.findMany({
    take: 2,
    where: {
      scheduledDeliveryDate: effectiveDeliveryDate,
      shop,
      subscriptionContractId: contractId,
      ...KITCHEN_PREPARATION_BOX_ORDER_WHERE,
    },
  });

  if (byContract.length > 1) {
    return { error: "ambiguous_box_order", ok: false };
  }

  if (byContract.length === 1) {
    return { boxOrder: byContract[0]!, ok: true };
  }

  return { boxOrder: null, ok: true };
};

/**
 * Persist current-delivery meal titles on Selection (+ optional matching BoxOrder).
 *
 * Fail-closed when a matching BoxOrder exists but mealsCount ≠ selection.mealsCount:
 * no writes, so portal cannot report success while kitchen would stay stale / diverge.
 *
 * When no BoxOrder exists (cycle not yet paid/ordered): Selection-only update.
 */
export const applyCurrentDeliveryMealSelectionUpdate = async ({
  db,
  effectiveDeliveryDate,
  mealsCount,
  selectedMeals,
  shop,
  subscriptionContractId,
  subscriptionSelectionId,
}: {
  db: CurrentDeliveryMealsDb;
  /** Same cycle key already used by cutoff / explicit tracking — do not recompute. */
  effectiveDeliveryDate: string | null;
  mealsCount: number;
  selectedMeals: string[];
  shop: string;
  subscriptionContractId?: string | null;
  subscriptionSelectionId: string;
}): Promise<ApplyCurrentDeliveryMealSelectionResult> => {
  if (selectedMeals.length !== mealsCount) {
    throw new Error(
      "applyCurrentDeliveryMealSelectionUpdate: selectedMeals length must equal mealsCount",
    );
  }

  let targetBoxOrder: { id: string; mealsCount: number | null } | null = null;

  if (effectiveDeliveryDate) {
    const located = await findCurrentDeliveryBoxOrder({
      db,
      effectiveDeliveryDate,
      shop,
      subscriptionContractId,
      subscriptionSelectionId,
    });

    if (!located.ok) {
      return { boxOrderId: "", error: located.error, ok: false };
    }

    targetBoxOrder = located.boxOrder;

    if (
      targetBoxOrder &&
      targetBoxOrder.mealsCount !== mealsCount
    ) {
      return {
        boxOrderId: targetBoxOrder.id,
        error: "box_order_meals_count_mismatch",
        ok: false,
      };
    }
  }

  await db.$transaction(async (tx) => {
    await tx.subscriptionMealSelection.update({
      data: {
        selectedMeals: selectedMeals as Prisma.InputJsonValue,
        ...(effectiveDeliveryDate
          ? { mealSelectionLastExplicitDeliveryDate: effectiveDeliveryDate }
          : {}),
      },
      where: { id: subscriptionSelectionId },
    });

    if (targetBoxOrder) {
      await tx.boxOrder.update({
        data: {
          selectedMeals: selectedMeals as Prisma.InputJsonValue,
          selectedMealsSource: PORTAL_CURRENT_DELIVERY_MEALS_SOURCE,
        },
        where: { id: targetBoxOrder.id },
      });
    }
  });

  return {
    boxOrderId: targetBoxOrder?.id ?? null,
    boxOrderSynced: Boolean(targetBoxOrder),
    ok: true,
  };
};
