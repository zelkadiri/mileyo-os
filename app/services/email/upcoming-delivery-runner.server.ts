/**
 * Cron runner for upcoming-delivery emails.
 * Separate from billing worker — local DB only, no Shopify fetch.
 */

import { RECOVERY_STATUS } from "../../constants/subscriptionPaymentRecovery";
import db from "../../db.server";
import { getPortalModificationBlockReason } from "../subscriptionModificationBlock.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import {
  hasUsableUpcomingDeliveryMeals,
  isUpcomingDeliveryCutoffSatisfied,
  isUpcomingDeliveryEmailAlreadySentForDelivery,
  isUpcomingDeliveryEmailSendWindowOpen,
  isUpcomingDeliveryRunnerWindowPotentiallyOpen,
  resolveSubscriptionEmailRecipient,
  resolveUpcomingDeliveryCycle,
  shouldSendUpcomingDeliveryEmail,
  trySendUpcomingDeliveryEmail,
} from "./upcoming-delivery-email.server";

const PORTAL_RECOVERY_STATUSES = [
  RECOVERY_STATUS.RETRY_SCHEDULED,
  RECOVERY_STATUS.PROCESSING,
  RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED,
  RECOVERY_STATUS.EMAIL_SEND_FAILED,
  RECOVERY_STATUS.FINAL_FAILED,
] as const;

export type UpcomingDeliveryRunnerSummary = {
  eligible: number;
  errors: string[];
  failed: number;
  scanned: number;
  sent: number;
  skippedAlreadySent: number;
  skippedBlocked: number;
  skippedCutoff: number;
  skippedInactive: number;
  skippedNoBoxOrder: number;
  skippedNoDelivery: number;
  skippedNoMeals: number;
  skippedNoRecipient: number;
  skippedOutsideWindow: number;
};

export type UpcomingDeliveryCandidateSkipReason =
  | "already_sent"
  | "blocked"
  | "cutoff_not_passed"
  | "inactive"
  | "no_box_order"
  | "no_delivery"
  | "no_meals"
  | "no_recipient"
  | "outside_window"
  | null;

export type UpcomingDeliveryCandidateInput = {
  active: boolean;
  customerEmail?: string | null;
  lastBillingAttemptAt?: Date | null;
  lastBillingAttemptStatus?: string | null;
  mealsCount?: number | null;
  nextScheduledDeliveryDate?: string | null;
  preferredDeliveryWeekday?: number | null;
  resumeAttemptOrderId?: string | null;
  resumeAttemptStatus?: string | null;
  selectedMeals?: unknown;
  status?: string | null;
  subscriptionContractId?: string | null;
  upcomingDeliveryEmailDeliveryDate?: string | null;
};

export type UpcomingDeliveryBoxOrderProof = {
  scheduledDeliveryDate?: string | null;
  simulated?: boolean | null;
  subscriptionSelectionId?: string | null;
};

export const emptyUpcomingDeliveryRunnerSummary =
  (): UpcomingDeliveryRunnerSummary => ({
    eligible: 0,
    errors: [],
    failed: 0,
    scanned: 0,
    sent: 0,
    skippedAlreadySent: 0,
    skippedBlocked: 0,
    skippedCutoff: 0,
    skippedInactive: 0,
    skippedNoBoxOrder: 0,
    skippedNoDelivery: 0,
    skippedNoMeals: 0,
    skippedNoRecipient: 0,
    skippedOutsideWindow: 0,
  });

export const hasMatchingBoxOrderForUpcomingDelivery = ({
  boxOrder,
  effectiveDeliveryDate,
  selectionId,
}: {
  boxOrder?: UpcomingDeliveryBoxOrderProof | null;
  effectiveDeliveryDate: string;
  selectionId: string;
}): boolean => {
  if (!boxOrder) {
    return false;
  }

  if (boxOrder.simulated === true) {
    return false;
  }

  if (boxOrder.subscriptionSelectionId !== selectionId) {
    return false;
  }

  return boxOrder.scheduledDeliveryDate === effectiveDeliveryDate;
};

/**
 * Pure eligibility classification for one selection (runner + tests).
 * Does not check transactional email flag — handled at send time.
 */
export const classifyUpcomingDeliveryCandidate = ({
  effectiveDeliveryDateOverride,
  matchingBoxOrder,
  now = new Date(),
  order,
  recovery,
  selection,
  selectionId = "selection-test",
}: {
  effectiveDeliveryDateOverride?: string | null;
  matchingBoxOrder?: UpcomingDeliveryBoxOrderProof | null;
  now?: Date;
  order?: { customerEmail?: string | null; customerName?: string | null } | null;
  recovery?: { status: string } | null;
  selection: UpcomingDeliveryCandidateInput;
  selectionId?: string;
}): {
  effectiveDeliveryDate: string | null;
  skipReason: UpcomingDeliveryCandidateSkipReason;
} => {
  if (selection.active !== true || selection.status !== "active") {
    return { effectiveDeliveryDate: null, skipReason: "inactive" };
  }

  if (!selection.subscriptionContractId?.trim()) {
    return { effectiveDeliveryDate: null, skipReason: "inactive" };
  }

  const { effectiveDeliveryDate } = effectiveDeliveryDateOverride
    ? {
        effectiveDeliveryDate: effectiveDeliveryDateOverride.trim() || null,
      }
    : resolveUpcomingDeliveryCycle(selection, now);

  if (!effectiveDeliveryDate) {
    return { effectiveDeliveryDate: null, skipReason: "no_delivery" };
  }

  if (
    !isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate,
      now,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "outside_window" };
  }

  if (!isUpcomingDeliveryCutoffSatisfied(effectiveDeliveryDate, now)) {
    return { effectiveDeliveryDate, skipReason: "cutoff_not_passed" };
  }

  if (
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate,
      upcomingDeliveryEmailDeliveryDate:
        selection.upcomingDeliveryEmailDeliveryDate,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "already_sent" };
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

  if (
    !hasUsableUpcomingDeliveryMeals({
      mealsCount: selection.mealsCount,
      selectedMeals: selection.selectedMeals,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "no_meals" };
  }

  const { recipient } = resolveSubscriptionEmailRecipient(
    {
      customerEmail: selection.customerEmail ?? null,
      subscriptionContractId: selection.subscriptionContractId ?? null,
    },
    order ?? null,
  );

  if (!recipient) {
    return { effectiveDeliveryDate, skipReason: "no_recipient" };
  }

  if (
    !hasMatchingBoxOrderForUpcomingDelivery({
      boxOrder: matchingBoxOrder,
      effectiveDeliveryDate,
      selectionId,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "no_box_order" };
  }

  if (
    !shouldSendUpcomingDeliveryEmail({
      active: selection.active,
      effectiveDeliveryDate,
      hasRecipient: true,
      hasUsableMeals: true,
      now,
      status: selection.status,
      subscriptionContractId: selection.subscriptionContractId,
      transactionalEmailsEnabled: true,
      upcomingDeliveryEmailDeliveryDate:
        selection.upcomingDeliveryEmailDeliveryDate,
    })
  ) {
    return { effectiveDeliveryDate, skipReason: "outside_window" };
  }

  return { effectiveDeliveryDate, skipReason: null };
};

export const incrementUpcomingDeliverySkip = (
  summary: UpcomingDeliveryRunnerSummary,
  skipReason: Exclude<UpcomingDeliveryCandidateSkipReason, null>,
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
    case "cutoff_not_passed":
      summary.skippedCutoff += 1;
      break;
    case "already_sent":
      summary.skippedAlreadySent += 1;
      break;
    case "blocked":
      summary.skippedBlocked += 1;
      break;
    case "no_recipient":
      summary.skippedNoRecipient += 1;
      break;
    case "no_box_order":
      summary.skippedNoBoxOrder += 1;
      break;
    case "no_meals":
      summary.skippedNoMeals += 1;
      break;
    default:
      break;
  }
};

const buildBoxOrderLookupKey = (
  subscriptionSelectionId: string,
  scheduledDeliveryDate: string,
) => `${subscriptionSelectionId}:${scheduledDeliveryDate}`;

export const processDueUpcomingDeliveryEmails = async (
  shop: string,
  options?: { now?: Date },
): Promise<UpcomingDeliveryRunnerSummary> => {
  const summary = emptyUpcomingDeliveryRunnerSummary();
  const now = options?.now ?? new Date();

  if (!isUpcomingDeliveryRunnerWindowPotentiallyOpen(now)) {
    console.log("[upcomingDeliveryEmail] runner skipped outside send window", {
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

  const recipientOrders = await db.boxOrder.findMany({
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
    recipientOrders.map((order) => [order.shopifyOrderId, order]),
  );

  const proofBoxOrders = await db.boxOrder.findMany({
    select: {
      scheduledDeliveryDate: true,
      simulated: true,
      subscriptionSelectionId: true,
    },
    where: {
      shop,
      simulated: false,
      subscriptionSelectionId: { in: selectionIds },
    },
  });

  const boxOrderBySelectionAndDate = new Map<
    string,
    (typeof proofBoxOrders)[number]
  >();

  for (const boxOrder of proofBoxOrders) {
    if (!boxOrder.subscriptionSelectionId || !boxOrder.scheduledDeliveryDate) {
      continue;
    }

    boxOrderBySelectionAndDate.set(
      buildBoxOrderLookupKey(
        boxOrder.subscriptionSelectionId,
        boxOrder.scheduledDeliveryDate,
      ),
      boxOrder,
    );
  }

  for (const selection of selections) {
    try {
      const recovery = recoveryBySelectionId.get(selection.id) ?? null;
      const recipientOrder = orderByShopifyOrderId.get(selection.shopifyOrderId);
      const { effectiveDeliveryDate } = resolveUpcomingDeliveryCycle(
        selection,
        now,
      );

      const matchingBoxOrder = effectiveDeliveryDate
        ? (boxOrderBySelectionAndDate.get(
            buildBoxOrderLookupKey(selection.id, effectiveDeliveryDate),
          ) ?? null)
        : null;

      const classification = classifyUpcomingDeliveryCandidate({
        matchingBoxOrder,
        now,
        order: recipientOrder ?? null,
        recovery,
        selection,
        selectionId: selection.id,
      });

      if (classification.skipReason) {
        incrementUpcomingDeliverySkip(summary, classification.skipReason);
        continue;
      }

      if (!isMileyoTransactionalEmailEnabled()) {
        continue;
      }

      summary.eligible += 1;

      const sendResult = await trySendUpcomingDeliveryEmail({
        now,
        selectionId: selection.id,
      });

      if (sendResult.status === "sent") {
        summary.sent += 1;
        continue;
      }

      if (sendResult.status === "failed") {
        summary.failed += 1;

        if (summary.errors.length < 50) {
          summary.errors.push(
            `${selection.id}: ${sendResult.reason} — ${sendResult.message}`,
          );
        }

        continue;
      }

      if (sendResult.reason === "already_sent_for_delivery") {
        summary.skippedAlreadySent += 1;
        continue;
      }

      if (sendResult.reason === "not_eligible") {
        summary.skippedNoRecipient += 1;
      }
    } catch (error) {
      summary.failed += 1;

      if (summary.errors.length < 50) {
        summary.errors.push(
          `${selection.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  console.log("[upcomingDeliveryEmail] runner completed", {
    shop,
    ...summary,
  });

  return summary;
};
