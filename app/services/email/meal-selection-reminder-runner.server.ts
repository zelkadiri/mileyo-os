/**
 * Cron runner for meal-selection reminder emails.
 * Separate from subscription billing worker — local DB only, no Shopify fetch.
 *
 * Phase A: classify + build eligibleItems (business skips counted here).
 * Phase B: dispatchEmailBatch → trySendMealSelectionReminderEmail (infra concurrency).
 */

import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import db from "../../db.server";
import { getDeliveryCutoffStatus } from "../../utils/deliveryDate";
import { getPortalModificationBlockReason } from "../subscriptionModificationBlock.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import {
  EMAIL_BATCH_DEFAULT_MAX_ERRORS,
  dispatchEmailBatch,
} from "./email-batch-dispatcher.server";
import {
  hasExplicitMealSelectionForDelivery,
  isMealSelectionReminderAlreadySentForDelivery,
  isMealSelectionReminderSendWindowOpen,
  resolveMealSelectionCycle,
  resolveSubscriptionEmailRecipient,
  shouldSendMealSelectionReminderEmail,
  trySendMealSelectionReminderEmail,
} from "./meal-selection-email.server";

const PORTAL_RECOVERY_STATUSES = [
  RECOVERY_STATUS.RETRY_SCHEDULED,
  RECOVERY_STATUS.PROCESSING,
  RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
  RECOVERY_STATUS.EMAIL_SEND_FAILED,
  RECOVERY_STATUS.FINAL_FAILED,
] as const;

export type MealSelectionReminderRunnerSummary = {
  eligible: number;
  errors: string[];
  failed: number;
  scanned: number;
  sent: number;
  skippedAlreadySent: number;
  skippedBlocked: number;
  skippedCutoff: number;
  skippedExplicit: number;
  skippedInactive: number;
  skippedNoDelivery: number;
  skippedNoRecipient: number;
  skippedOutsideWindow: number;
};

const emptySummary = (): MealSelectionReminderRunnerSummary => ({
  eligible: 0,
  errors: [],
  failed: 0,
  scanned: 0,
  sent: 0,
  skippedAlreadySent: 0,
  skippedBlocked: 0,
  skippedCutoff: 0,
  skippedExplicit: 0,
  skippedInactive: 0,
  skippedNoDelivery: 0,
  skippedNoRecipient: 0,
  skippedOutsideWindow: 0,
});

export type MealSelectionReminderCandidateSkipReason =
  | "already_sent"
  | "blocked"
  | "cutoff"
  | "explicit"
  | "inactive"
  | "no_delivery"
  | "no_recipient"
  | "outside_window"
  | null;

export type MealSelectionReminderCandidateInput = {
  active: boolean;
  customerEmail?: string | null;
  lastBillingAttemptAt?: Date | null;
  lastBillingAttemptStatus?: string | null;
  mealSelectionLastExplicitDeliveryDate?: string | null;
  mealSelectionReminderDeliveryDate?: string | null;
  mealsCount?: number | null;
  nextScheduledDeliveryDate?: string | null;
  preferredDeliveryWeekday?: number | null;
  resumeAttemptOrderId?: string | null;
  resumeAttemptStatus?: string | null;
  status?: string | null;
  subscriptionContractId?: string | null;
};

/**
 * Pure eligibility classification for one selection (runner + tests).
 * Does not check transactional email flag — handled at send time.
 */
export const classifyMealSelectionReminderCandidate = ({
  now = new Date(),
  recovery,
  selection,
}: {
  now?: Date;
  recovery?: { status: string } | null;
  selection: MealSelectionReminderCandidateInput;
}): {
  effectiveDeliveryDate: string | null;
  skipReason: MealSelectionReminderCandidateSkipReason;
} => {
  if (!isMealSelectionReminderSendWindowOpen(now)) {
    return { effectiveDeliveryDate: null, skipReason: "outside_window" };
  }

  if (selection.active !== true || selection.status !== "active") {
    return { effectiveDeliveryDate: null, skipReason: "inactive" };
  }

  if (!selection.subscriptionContractId?.trim()) {
    return { effectiveDeliveryDate: null, skipReason: "inactive" };
  }

  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection, now);

  if (!effectiveDeliveryDate) {
    return { effectiveDeliveryDate: null, skipReason: "no_delivery" };
  }

  if (
    hasExplicitMealSelectionForDelivery({
      effectiveDeliveryDate,
      mealSelectionLastExplicitDeliveryDate:
        selection.mealSelectionLastExplicitDeliveryDate,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "explicit" };
  }

  if (
    isMealSelectionReminderAlreadySentForDelivery({
      effectiveDeliveryDate,
      mealSelectionReminderDeliveryDate:
        selection.mealSelectionReminderDeliveryDate,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "already_sent" };
  }

  const cutoff = getDeliveryCutoffStatus(effectiveDeliveryDate, now);

  if (!cutoff.isKnown || cutoff.isPassed) {
    return { effectiveDeliveryDate, skipReason: "cutoff" };
  }

  const blockReason = getPortalModificationBlockReason(
    {
      active: selection.active,
      lastBillingAttemptAt: selection.lastBillingAttemptAt ?? null,
      lastBillingAttemptStatus: selection.lastBillingAttemptStatus ?? null,
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate ?? null,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
      resumeAttemptOrderId: selection.resumeAttemptOrderId ?? null,
      resumeAttemptStatus: selection.resumeAttemptStatus ?? null,
      status: selection.status ?? "active",
      subscriptionContractId: selection.subscriptionContractId ?? null,
    },
    recovery ?? null,
    now,
  );

  if (blockReason && blockReason !== "cutoff_passed") {
    return { effectiveDeliveryDate, skipReason: "blocked" };
  }

  const { recipient } = resolveSubscriptionEmailRecipient({
    customerEmail: selection.customerEmail ?? null,
    subscriptionContractId: selection.subscriptionContractId ?? null,
  });

  if (!recipient) {
    return { effectiveDeliveryDate, skipReason: "no_recipient" };
  }

  const hasExplicitSelection = false;

  if (
    !shouldSendMealSelectionReminderEmail({
      active: selection.active,
      effectiveDeliveryDate,
      hasExplicitSelection,
      hasRecipient: true,
      mealSelectionReminderDeliveryDate:
        selection.mealSelectionReminderDeliveryDate,
      now,
      status: selection.status,
      subscriptionContractId: selection.subscriptionContractId,
      transactionalEmailsEnabled: true,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "cutoff" };
  }

  return { effectiveDeliveryDate, skipReason: null };
};

const incrementSkip = (
  summary: MealSelectionReminderRunnerSummary,
  skipReason: Exclude<MealSelectionReminderCandidateSkipReason, null>,
) => {
  switch (skipReason) {
    case "outside_window":
      summary.skippedOutsideWindow += 1;
      break;
    case "inactive":
      summary.skippedInactive += 1;
      break;
    case "no_delivery":
      summary.skippedNoDelivery += 1;
      break;
    case "explicit":
      summary.skippedExplicit += 1;
      break;
    case "already_sent":
      summary.skippedAlreadySent += 1;
      break;
    case "cutoff":
      summary.skippedCutoff += 1;
      break;
    case "blocked":
      summary.skippedBlocked += 1;
      break;
    case "no_recipient":
      summary.skippedNoRecipient += 1;
      break;
    default:
      break;
  }
};

type MealSelectionReminderEligibleItem = {
  customerEmail: string | null;
  selectionId: string;
  shopifyOrderId: string;
  subscriptionContractId: string | null;
};

/**
 * Map trySend skipped reasons onto existing business counters.
 * Known: already_sent_for_delivery → skippedAlreadySent;
 * not_eligible + no recipient → skippedNoRecipient.
 * Other runtime skips (selection_missing, invalid_meals_count, …) are left
 * unmapped — same as pre-dispatcher behaviour (no invented counters).
 */
const applyMealSelectionReminderRuntimeSkip = ({
  item,
  orderByShopifyOrderId,
  reason,
  summary,
}: {
  item: MealSelectionReminderEligibleItem;
  orderByShopifyOrderId: Map<
    string,
    { customerEmail: string | null; customerName: string | null }
  >;
  reason: string;
  summary: MealSelectionReminderRunnerSummary;
}): void => {
  if (reason === "already_sent_for_delivery") {
    summary.skippedAlreadySent += 1;
    return;
  }

  if (reason === "not_eligible") {
    const order = orderByShopifyOrderId.get(item.shopifyOrderId);
    const { recipient } = resolveSubscriptionEmailRecipient(item, order);

    if (!recipient) {
      summary.skippedNoRecipient += 1;
    }
  }
};

const pushBoundedRunnerError = (
  summary: MealSelectionReminderRunnerSummary,
  message: string,
): void => {
  if (summary.errors.length >= EMAIL_BATCH_DEFAULT_MAX_ERRORS) {
    return;
  }

  summary.errors.push(message);
};

export const processDueMealSelectionReminders = async (
  shop: string,
  options?: { now?: Date },
): Promise<MealSelectionReminderRunnerSummary> => {
  const summary = emptySummary();
  const now = options?.now ?? new Date();

  if (!isMealSelectionReminderSendWindowOpen(now)) {
    console.log("[mealSelectionReminder] runner skipped outside send window", {
      iso: now.toISOString(),
      shop,
    });
    return summary;
  }

  const selections = await db.subscriptionMealSelection.findMany({
    where: {
      active: true,
      shop,
      status: "active",
      subscriptionContractId: { not: null },
    },
  });

  summary.scanned = selections.length;

  if (selections.length === 0) {
    return summary;
  }

  const selectionIds = selections.map((selection) => selection.id);
  const recoveries = await db.subscriptionPaymentRecovery.findMany({
    orderBy: { updatedAt: "desc" },
    where: {
      shop,
      status: { in: [...PORTAL_RECOVERY_STATUSES] },
      subscriptionMealSelectionId: { in: selectionIds },
    },
  });

  const recoveryBySelectionId = new Map<string, (typeof recoveries)[number]>();

  for (const recovery of recoveries) {
    if (!recoveryBySelectionId.has(recovery.subscriptionMealSelectionId)) {
      recoveryBySelectionId.set(recovery.subscriptionMealSelectionId, recovery);
    }
  }

  const orders = await db.boxOrder.findMany({
    select: {
      customerEmail: true,
      customerName: true,
      shopifyOrderId: true,
    },
    where: {
      shop,
      shopifyOrderId: {
        in: selections.map((selection) => selection.shopifyOrderId),
      },
    },
  });
  const orderByShopifyOrderId = new Map(
    orders.map((order) => [order.shopifyOrderId, order]),
  );

  const eligibleItems: MealSelectionReminderEligibleItem[] = [];

  // Phase A — classify; business skips only. Build eligibleItems for Phase B.
  for (const selection of selections) {
    try {
      const recovery = recoveryBySelectionId.get(selection.id) ?? null;
      const classification = classifyMealSelectionReminderCandidate({
        now,
        recovery,
        selection,
      });

      if (classification.skipReason) {
        incrementSkip(summary, classification.skipReason);
        continue;
      }

      if (!isMileyoTransactionalEmailEnabled()) {
        continue;
      }

      summary.eligible += 1;
      eligibleItems.push({
        customerEmail: selection.customerEmail,
        selectionId: selection.id,
        shopifyOrderId: selection.shopifyOrderId,
        subscriptionContractId: selection.subscriptionContractId,
      });
    } catch (error) {
      summary.failed += 1;
      pushBoundedRunnerError(
        summary,
        `${selection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Phase B — bounded-concurrency send via shared dispatcher.
  const batchResult = await dispatchEmailBatch({
    getItemKey: (item) => item.selectionId,
    items: eligibleItems,
    worker: async (item) => {
      const sendResult = await trySendMealSelectionReminderEmail({
        selectionId: item.selectionId,
      });

      if (sendResult.status === "sent") {
        return { outcome: "success" };
      }

      if (sendResult.status === "failed") {
        return {
          message: sendResult.message,
          outcome: "failed",
          reason: sendResult.reason,
        };
      }

      applyMealSelectionReminderRuntimeSkip({
        item,
        orderByShopifyOrderId,
        reason: sendResult.reason,
        summary,
      });

      return { outcome: "skipped", reason: sendResult.reason };
    },
  });

  summary.sent += batchResult.succeeded;
  summary.failed += batchResult.failed;

  for (const error of batchResult.errors) {
    const key = error.itemKey ?? "unknown";
    pushBoundedRunnerError(
      summary,
      error.reason
        ? `${key}: ${error.reason} — ${error.message}`
        : `${key}: ${error.message}`,
    );
  }

  console.log("[mealSelectionReminder] runner completed", {
    shop,
    ...summary,
  });

  return summary;
};
