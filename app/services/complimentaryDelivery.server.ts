/**
 * Schedule & fulfill complimentary kitchen boxes without Shopify billing.
 *
 * Safety invariants:
 * - Never bills Shopify or opens payment recovery/claims.
 * - Never mutates nextBillingDate.
 * - BoxOrder uses complimentary_* shopifyOrderId (kitchen-local, no webhook).
 * - financialStatus = "complimentary" (never "paid").
 * - Meal snapshot taken AFTER cutoff from live selection.selectedMeals.
 */

import type { ComplimentaryDelivery, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  COMPLIMENTARY_BOX_FINANCIAL_STATUS,
  COMPLIMENTARY_BOX_ORDER_TYPE,
  COMPLIMENTARY_DELIVERY_HISTORY_EVENT,
  COMPLIMENTARY_DELIVERY_STATUS,
  OPEN_COMPLIMENTARY_DELIVERY_STATUSES,
  buildComplimentaryShopifyOrderId,
  type ComplimentaryDeliveryStatus,
} from "../constants/complimentaryDelivery";
import { SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS } from "../constants/subscriptionCycle";
import db from "../db.server";
import {
  getMealSelectionCutoffCalendarDate,
  getWeekday,
  isDeliveryCutoffPassed,
  parseDeliveryDate,
  parisWallClockToInstant,
  type DeliveryDateString,
} from "../utils/deliveryDate";
import { getSelectedMealsFromJson } from "../utils/mealSelection";
import {
  normalizeShopifyId,
  subscriptionContractIdOrFilter,
} from "../utils/shopifyIds.server";
import { findRenewalDeliveryCycleCollision } from "./deliverySchedule.server";

export type ComplimentaryHistoryEntry = {
  at: string;
  detail?: string;
  event: string;
};

const asHistory = (value: unknown): ComplimentaryHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ComplimentaryHistoryEntry =>
      entry != null &&
      typeof entry === "object" &&
      typeof (entry as ComplimentaryHistoryEntry).at === "string" &&
      typeof (entry as ComplimentaryHistoryEntry).event === "string",
  );
};

const appendHistory = (
  row: Pick<ComplimentaryDelivery, "historyJson">,
  event: string,
  detail?: string,
): ComplimentaryHistoryEntry[] => [
  ...asHistory(row.historyJson),
  { at: new Date().toISOString(), detail, event },
];

const mealCutoffInstantForDelivery = (
  scheduledDeliveryDate: DeliveryDateString,
): Date | null => {
  const cutoffDate = getMealSelectionCutoffCalendarDate(scheduledDeliveryDate);
  return parisWallClockToInstant({
    date: cutoffDate,
    hour: 23,
    minute: 59,
    timezone: "Europe/Paris",
  });
};

export type ScheduleComplimentaryDeliveryInput = {
  commercialReason: string;
  operationId?: string;
  scheduledDeliveryDate: string;
  shop: string;
  subscriptionContractId: string;
  /** When true (default), set selection.nextScheduledDeliveryDate to the delivery day for portal cutoff. Does NOT touch nextBillingDate. */
  syncNextScheduledDeliveryDate?: boolean;
};

export type ScheduleComplimentaryDeliveryResult =
  | { ok: true; delivery: ComplimentaryDelivery; created: boolean }
  | { ok: false; code: string; error: string };

export const scheduleComplimentaryDelivery = async (
  input: ScheduleComplimentaryDeliveryInput,
): Promise<ScheduleComplimentaryDeliveryResult> => {
  const shop = input.shop.trim();
  const reason = input.commercialReason.trim();
  const contractNormalized = normalizeShopifyId(input.subscriptionContractId);
  const deliveryDate = parseDeliveryDate(input.scheduledDeliveryDate);

  if (!shop) {
    return { code: "invalid_shop", error: "shop requis.", ok: false };
  }
  if (!reason) {
    return {
      code: "invalid_reason",
      error: "commercialReason requis (audit).",
      ok: false,
    };
  }
  if (!contractNormalized) {
    return {
      code: "invalid_contract",
      error: "subscriptionContractId invalide.",
      ok: false,
    };
  }
  if (!deliveryDate) {
    return {
      code: "invalid_delivery_date",
      error: "scheduledDeliveryDate invalide (YYYY-MM-DD).",
      ok: false,
    };
  }

  const weekday = getWeekday(deliveryDate);
  if (
    !(SUBSCRIPTION_CYCLE_DELIVERY_WEEKDAYS as readonly number[]).includes(
      weekday,
    )
  ) {
    return {
      code: "invalid_delivery_weekday",
      error: "Livraison offerte : jeudi ou vendredi uniquement.",
      ok: false,
    };
  }

  const mealCutoffAt = mealCutoffInstantForDelivery(deliveryDate);
  if (!mealCutoffAt) {
    return {
      code: "invalid_cutoff",
      error: "Impossible de dériver le cutoff repas.",
      ok: false,
    };
  }

  const selection = await db.subscriptionMealSelection.findFirst({
    where: {
      shop,
      ...subscriptionContractIdOrFilter(contractNormalized),
    },
  });
  if (!selection) {
    return {
      code: "selection_not_found",
      error: "Sélection d'abonnement introuvable pour ce contrat.",
      ok: false,
    };
  }

  const operationId =
    input.operationId?.trim() ||
    `comp-${contractNormalized}-${deliveryDate}-${randomUUID().slice(0, 8)}`;

  const existing = await db.complimentaryDelivery.findUnique({
    where: {
      subscriptionMealSelectionId_scheduledDeliveryDate: {
        scheduledDeliveryDate: deliveryDate,
        subscriptionMealSelectionId: selection.id,
      },
    },
  });
  if (existing) {
    if (
      existing.status === COMPLIMENTARY_DELIVERY_STATUS.CANCELLED ||
      existing.status === COMPLIMENTARY_DELIVERY_STATUS.FAILED
    ) {
      // Allow re-schedule only via new operation — fail closed on unique.
    }
    return {
      created: false,
      delivery: existing,
      ok: true,
    };
  }

  try {
    const delivery = await db.complimentaryDelivery.create({
      data: {
        commercialReason: reason,
        historyJson: [
          {
            at: new Date().toISOString(),
            detail: reason,
            event: COMPLIMENTARY_DELIVERY_HISTORY_EVENT.SCHEDULED,
          },
        ],
        mealCutoffAt,
        operationId,
        scheduledDeliveryDate: deliveryDate,
        shop,
        status: COMPLIMENTARY_DELIVERY_STATUS.SCHEDULED,
        subscriptionContractId: contractNormalized,
        subscriptionMealSelectionId: selection.id,
      },
    });

    if (input.syncNextScheduledDeliveryDate !== false) {
      // Portal cutoff + meal edits bind to this delivery day. Financial NBD untouched.
      await db.subscriptionMealSelection.update({
        data: { nextScheduledDeliveryDate: deliveryDate },
        where: { id: selection.id },
      });
    }

    return { created: true, delivery, ok: true };
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
        ? "duplicate"
        : "persist_failed";
    return {
      code,
      error:
        error instanceof Error
          ? error.message
          : "Échec de programmation de la livraison offerte.",
      ok: false,
    };
  }
};

const loadPriorKitchenBox = async ({
  selectionId,
  shop,
}: {
  selectionId: string;
  shop: string;
}) =>
  db.boxOrder.findFirst({
    orderBy: { createdAt: "desc" },
    where: {
      cancelledAt: null,
      shop,
      simulated: false,
      subscriptionSelectionId: selectionId,
    },
  });

export type ProcessComplimentaryDeliveriesSummary = {
  errors: number;
  failed: number;
  fulfilled: number;
  processed: number;
  skipped: number;
};

/**
 * After meal cutoff: snapshot live selectedMeals → one kitchen BoxOrder.
 * Safe to re-run (idempotent). Never bills Shopify.
 */
export const processDueComplimentaryDeliveries = async (
  shop: string,
  now: Date = new Date(),
): Promise<ProcessComplimentaryDeliveriesSummary> => {
  const summary: ProcessComplimentaryDeliveriesSummary = {
    errors: 0,
    failed: 0,
    fulfilled: 0,
    processed: 0,
    skipped: 0,
  };

  const due = await db.complimentaryDelivery.findMany({
    orderBy: { mealCutoffAt: "asc" },
    take: 50,
    where: {
      shop,
      status: {
        in: [
          COMPLIMENTARY_DELIVERY_STATUS.SCHEDULED,
          COMPLIMENTARY_DELIVERY_STATUS.FAILED,
        ],
      },
      mealCutoffAt: { lte: now },
    },
  });

  for (const row of due) {
    summary.processed += 1;
    const result = await fulfillComplimentaryDelivery({
      deliveryId: row.id,
      now,
    });
    if (result.ok) {
      if (result.alreadyFulfilled) {
        summary.skipped += 1;
      } else {
        summary.fulfilled += 1;
      }
    } else {
      summary.failed += 1;
      summary.errors += 1;
      console.error("[complimentaryDelivery] fulfill failed", {
        code: result.code,
        deliveryId: row.id,
        error: result.error,
        shop,
      });
    }
  }

  return summary;
};

export type FulfillComplimentaryDeliveryResult =
  | { ok: true; alreadyFulfilled: boolean; boxOrderId: string }
  | { ok: false; code: string; error: string };

export const fulfillComplimentaryDelivery = async ({
  deliveryId,
  now = new Date(),
}: {
  deliveryId: string;
  now?: Date;
}): Promise<FulfillComplimentaryDeliveryResult> => {
  const current = await db.complimentaryDelivery.findUnique({
    where: { id: deliveryId },
  });
  if (!current) {
    return { code: "not_found", error: "Livraison offerte introuvable.", ok: false };
  }

  if (current.status === COMPLIMENTARY_DELIVERY_STATUS.FULFILLED) {
    if (current.boxOrderId) {
      return {
        alreadyFulfilled: true,
        boxOrderId: current.boxOrderId,
        ok: true,
      };
    }
    return {
      code: "fulfilled_without_box",
      error: "Statut fulfilled sans boxOrderId — réconciliation manuelle.",
      ok: false,
    };
  }

  if (current.status === COMPLIMENTARY_DELIVERY_STATUS.CANCELLED) {
    return { code: "cancelled", error: "Livraison offerte annulée.", ok: false };
  }

  if (current.status === COMPLIMENTARY_DELIVERY_STATUS.PROCESSING) {
    return {
      code: "in_flight",
      error: "Traitement déjà en cours — pas de double création.",
      ok: false,
    };
  }

  if (!isDeliveryCutoffPassed(current.scheduledDeliveryDate as DeliveryDateString, now)) {
    return {
      code: "cutoff_not_passed",
      error: "Cutoff repas non atteint — box non créée.",
      ok: false,
    };
  }

  const claimed = await db.complimentaryDelivery.updateMany({
    data: {
      historyJson: appendHistory(
        current,
        current.status === COMPLIMENTARY_DELIVERY_STATUS.FAILED
          ? COMPLIMENTARY_DELIVERY_HISTORY_EVENT.RETRY
          : COMPLIMENTARY_DELIVERY_HISTORY_EVENT.PROCESSING,
      ),
      status: COMPLIMENTARY_DELIVERY_STATUS.PROCESSING,
    },
    where: {
      id: current.id,
      status: {
        in: [
          COMPLIMENTARY_DELIVERY_STATUS.SCHEDULED,
          COMPLIMENTARY_DELIVERY_STATUS.FAILED,
        ],
      },
    },
  });
  if (claimed.count !== 1) {
    return {
      code: "concurrent_state",
      error: "Course au fulfillment — fail-closed.",
      ok: false,
    };
  }

  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: current.subscriptionMealSelectionId },
  });
  if (!selection) {
    await markFailed(current, "Sélection introuvable au fulfillment.");
    return {
      code: "selection_missing",
      error: "Sélection introuvable au fulfillment.",
      ok: false,
    };
  }

  const meals = getSelectedMealsFromJson(selection.selectedMeals);
  const expectedCount = selection.mealsCount;
  if (
    typeof expectedCount !== "number" ||
    expectedCount < 1 ||
    meals.length !== expectedCount
  ) {
    const msg = `Repas invalides: attendu ${expectedCount ?? "?"} plats, reçu ${meals.length}.`;
    await markFailed(current, msg);
    return { code: "invalid_meals", error: msg, ok: false };
  }

  const collision = await findRenewalDeliveryCycleCollision({
    scheduledDeliveryDate: current.scheduledDeliveryDate,
    shop: current.shop,
    shopifyOrderId: buildComplimentaryShopifyOrderId(current.operationId),
    subscriptionSelectionId: selection.id,
  });
  if (collision) {
    const msg = `BoxOrder cuisine déjà présente pour ${current.scheduledDeliveryDate} (${collision.shopifyOrderId}).`;
    await markFailed(current, msg);
    return { code: "duplicate_box", error: msg, ok: false };
  }

  const priorBox = await loadPriorKitchenBox({
    selectionId: selection.id,
    shop: current.shop,
  });
  const addressRaw =
    priorBox?.rawOrder && typeof priorBox.rawOrder === "object"
      ? (priorBox.rawOrder as Record<string, unknown>)
      : {};

  const shopifyOrderId = buildComplimentaryShopifyOrderId(current.operationId);
  const shopifyOrderName = `OFFERT-${current.scheduledDeliveryDate}`;

  const rawOrder: Prisma.InputJsonValue = {
    ...addressRaw,
    complimentary: true,
    complimentaryDeliveryId: current.id,
    complimentaryOperationId: current.operationId,
    financialNote: "Livraison offerte — aucun prélèvement Shopify",
    message:
      "Kitchen-local complimentary BoxOrder. No Shopify order / billing attempt.",
    type: "complimentary_delivery",
  };

  try {
    const boxOrder = await db.boxOrder.create({
      data: {
        boxTitle: selection.boxTitle,
        boxVariantShopifyId: selection.boxVariantShopifyId,
        customerEmail: selection.customerEmail,
        customerName: priorBox?.customerName ?? null,
        financialStatus: COMPLIMENTARY_BOX_FINANCIAL_STATUS,
        fulfillmentStatus: "unfulfilled",
        isSubscriptionRenewal: false,
        mealsCount: expectedCount,
        orderType: COMPLIMENTARY_BOX_ORDER_TYPE,
        rawOrder,
        scheduledDeliveryDate: current.scheduledDeliveryDate,
        selectedMeals: selection.selectedMeals as Prisma.InputJsonValue,
        selectedMealsSource: "subscription_selection_post_cutoff",
        shop: current.shop,
        shopifyOrderId,
        shopifyOrderName,
        simulated: false,
        subscriptionContractId:
          normalizeShopifyId(selection.subscriptionContractId) ??
          selection.subscriptionContractId,
        subscriptionSelectionId: selection.id,
      },
    });

    const processingRow = await db.complimentaryDelivery.findUniqueOrThrow({
      where: { id: current.id },
    });

    await db.complimentaryDelivery.update({
      data: {
        boxOrderId: boxOrder.id,
        boxShopifyOrderId: shopifyOrderId,
        failureReason: null,
        fulfilledAt: now,
        historyJson: appendHistory(
          processingRow,
          COMPLIMENTARY_DELIVERY_HISTORY_EVENT.FULFILLED,
          boxOrder.id,
        ),
        mealsSnapshotJson: selection.selectedMeals as Prisma.InputJsonValue,
        status: COMPLIMENTARY_DELIVERY_STATUS.FULFILLED,
      },
      where: { id: current.id },
    });

    console.log("[complimentaryDelivery] fulfilled", {
      boxOrderId: boxOrder.id,
      deliveryDate: current.scheduledDeliveryDate,
      deliveryId: current.id,
      meals: expectedCount,
      shop: current.shop,
    });

    return { alreadyFulfilled: false, boxOrderId: boxOrder.id, ok: true };
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Création BoxOrder offerte échouée.";
    await markFailed(current, msg);
    return { code: "box_create_failed", error: msg, ok: false };
  }
};

const markFailed = async (
  row: ComplimentaryDelivery,
  reason: string,
) => {
  await db.complimentaryDelivery.update({
    data: {
      failureReason: reason.slice(0, 500),
      historyJson: appendHistory(
        row,
        COMPLIMENTARY_DELIVERY_HISTORY_EVENT.FAILED,
        reason.slice(0, 200),
      ),
      status: COMPLIMENTARY_DELIVERY_STATUS.FAILED,
    },
    where: { id: row.id },
  });
};

export const listOpenComplimentaryDeliveriesForSelection = async ({
  selectionId,
  shop,
}: {
  selectionId: string;
  shop: string;
}) =>
  db.complimentaryDelivery.findMany({
    orderBy: { scheduledDeliveryDate: "asc" },
    where: {
      shop,
      status: { in: [...OPEN_COMPLIMENTARY_DELIVERY_STATUSES, COMPLIMENTARY_DELIVERY_STATUS.FULFILLED] },
      subscriptionMealSelectionId: selectionId,
    },
  });

export type { ComplimentaryDeliveryStatus };
