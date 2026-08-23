/**
 * Pure helpers for meal-selection transactional emails.
 *
 * Explicit delivery tracking is separate from selectedMeals completeness:
 * carry-over meals do not count as an explicit choice for a new cycle.
 *
 * Eligibility helpers are pure (no Resend / no DB). Transport stays in sendEmail.
 */

import {
  MEAL_SELECTION_REMINDER_WINDOW_START_HOUR,
  MEAL_SELECTION_REMINDER_WINDOW_START_MINUTE,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../../constants/subscriptionCycle";
import {
  formatDeliveryCutoffDeadlineLabel,
  getDeliveryCutoffStatus,
  getWeekday,
  projectActiveScheduledDeliveryDate,
  referenceDateFromInstant,
} from "../../utils/deliveryDate";
import { getSelectedMealsFromJson } from "../../utils/mealSelection";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type {
  MealSelectionConfirmedEmailData,
  MealSelectionReminderEmailData,
} from "./email.types";
import {
  buildSubscriptionPortalUrl,
  formatSubscriptionEmailDeliveryDate,
  resolveSubscriptionEmailRecipient,
  type SubscriptionEmailOrderSource,
  type SubscriptionEmailSelectionSource,
} from "./subscription-email.server";

export type MealSelectionEmailSelectionSource = SubscriptionEmailSelectionSource & {
  active?: boolean | null;
  status?: string | null;
  preferredDeliveryWeekday?: number | null;
  selectedMeals?: unknown;
  mealSelectionLastExplicitDeliveryDate?: string | null;
  mealSelectionConfirmedEmailSentAt?: Date | string | null;
  mealSelectionConfirmedDeliveryDate?: string | null;
  mealSelectionReminderEmailSentAt?: Date | string | null;
  mealSelectionReminderDeliveryDate?: string | null;
};

export type MealSelectionEmailOrderSource = SubscriptionEmailOrderSource;

export type MealSelectionCycle = {
  effectiveDeliveryDate: string | null;
  projectedFromStoredDate: string | null;
  wasProjected: boolean;
};

export type MarkMealSelectionExplicitResult =
  | {
      effectiveDeliveryDate: string;
      ok: true;
      skipped: false;
    }
  | {
      effectiveDeliveryDate: null;
      ok: true;
      reason: string;
      skipped: true;
    }
  | {
      error: string;
      ok: false;
    };

/**
 * Resolve the active delivery cycle key (`YYYY-MM-DD`) from stored selection fields.
 * Never recalculates the cycle manually — delegates to projectActiveScheduledDeliveryDate.
 */
export const resolveMealSelectionCycle = (
  selection: {
    nextScheduledDeliveryDate?: string | null;
    preferredDeliveryWeekday?: number | null;
  },
  now: Date = new Date(),
): MealSelectionCycle => {
  const projection = projectActiveScheduledDeliveryDate({
    nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate ?? null,
    now,
    preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
  });

  return {
    effectiveDeliveryDate: projection.effectiveDeliveryDate,
    projectedFromStoredDate: projection.projectedFromStoredDate,
    wasProjected: projection.wasProjected,
  };
};

/**
 * Persist explicit meal-selection tracking for the active delivery cycle.
 * Never invents a date — skips when effectiveDeliveryDate is unknown.
 * No email transport.
 */
export const markMealSelectionExplicitForCurrentDelivery = async ({
  effectiveDeliveryDate: effectiveDeliveryDateOverride,
  now = new Date(),
  selectionId,
}: {
  effectiveDeliveryDate?: string | null;
  now?: Date;
  selectionId: string;
}): Promise<MarkMealSelectionExplicitResult> => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    return { error: "selection_missing", ok: false };
  }

  const trimmedOverride = effectiveDeliveryDateOverride?.trim();
  const effectiveDeliveryDate =
    trimmedOverride ||
    resolveMealSelectionCycle(selection, now).effectiveDeliveryDate;

  if (!effectiveDeliveryDate) {
    console.log("[mealSelectionEmail] explicit tracking skipped", {
      reason: "unknown_effective_delivery_date",
      selectionId,
    });

    return {
      effectiveDeliveryDate: null,
      ok: true,
      reason: "unknown_effective_delivery_date",
      skipped: true,
    };
  }

  await db.subscriptionMealSelection.update({
    data: {
      mealSelectionLastExplicitDeliveryDate: effectiveDeliveryDate,
    },
    where: { id: selectionId },
  });

  console.log("[mealSelectionEmail] explicit delivery tracked", {
    effectiveDeliveryDate,
    selectionId,
  });

  return {
    effectiveDeliveryDate,
    ok: true,
    skipped: false,
  };
};

/**
 * True when the client explicitly saved meal choices for this delivery date.
 * Used by reminder eligibility — not selectedMeals.length completeness.
 */
export const hasExplicitMealSelectionForDelivery = ({
  effectiveDeliveryDate,
  mealSelectionLastExplicitDeliveryDate,
}: {
  effectiveDeliveryDate?: string | null;
  mealSelectionLastExplicitDeliveryDate?: string | null;
}): boolean => {
  const delivery = effectiveDeliveryDate?.trim();
  const explicit = mealSelectionLastExplicitDeliveryDate?.trim();

  if (!delivery || !explicit) {
    return false;
  }

  return explicit === delivery;
};

export const isMealSelectionConfirmedAlreadySentForDelivery = ({
  effectiveDeliveryDate,
  mealSelectionConfirmedDeliveryDate,
}: {
  effectiveDeliveryDate?: string | null;
  mealSelectionConfirmedDeliveryDate?: string | null;
}): boolean => {
  const delivery = effectiveDeliveryDate?.trim();
  const sentFor = mealSelectionConfirmedDeliveryDate?.trim();

  if (!delivery || !sentFor) {
    return false;
  }

  return sentFor === delivery;
};

export const isMealSelectionReminderAlreadySentForDelivery = ({
  effectiveDeliveryDate,
  mealSelectionReminderDeliveryDate,
}: {
  effectiveDeliveryDate?: string | null;
  mealSelectionReminderDeliveryDate?: string | null;
}): boolean => {
  const delivery = effectiveDeliveryDate?.trim();
  const sentFor = mealSelectionReminderDeliveryDate?.trim();

  if (!delivery || !sentFor) {
    return false;
  }

  return sentFor === delivery;
};

export const isMealSelectionCutoffPassed = (
  effectiveDeliveryDate: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!effectiveDeliveryDate?.trim()) {
    return false;
  }

  return getDeliveryCutoffStatus(effectiveDeliveryDate, now).isPassed;
};

const getParisWallClockParts = (
  instant: Date,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: timezone,
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    hour: read("hour"),
    minute: read("minute"),
  };
};

/**
 * Reminder send window V1:
 * - Sunday from 10:00 Europe/Paris
 * - All of Monday until cutoff (checked separately)
 */
export const isMealSelectionReminderSendWindowOpen = (
  now: Date = new Date(),
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): boolean => {
  const todayParis = referenceDateFromInstant(now, timezone);
  const weekday = getWeekday(todayParis);

  if (weekday === 1) {
    return true;
  }

  if (weekday === 0) {
    const { hour, minute } = getParisWallClockParts(now, timezone);

    return (
      hour > MEAL_SELECTION_REMINDER_WINDOW_START_HOUR ||
      (hour === MEAL_SELECTION_REMINDER_WINDOW_START_HOUR &&
        minute >= MEAL_SELECTION_REMINDER_WINDOW_START_MINUTE)
    );
  }

  return false;
};

export const isMealSelectionCutoffUnknown = (
  effectiveDeliveryDate: string | null | undefined,
  now: Date = new Date(),
): boolean => !getDeliveryCutoffStatus(effectiveDeliveryDate, now).isKnown;

export const shouldSendMealSelectionConfirmedEmail = ({
  active,
  effectiveDeliveryDate,
  hasExplicitSelection,
  hasRecipient,
  mealSelectionConfirmedDeliveryDate,
  status,
  transactionalEmailsEnabled,
}: {
  active?: boolean | null;
  effectiveDeliveryDate?: string | null;
  hasExplicitSelection: boolean;
  hasRecipient: boolean;
  mealSelectionConfirmedDeliveryDate?: string | null;
  status?: string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (active !== true) {
    return false;
  }

  if (status !== "active") {
    return false;
  }

  if (!hasRecipient) {
    return false;
  }

  if (!effectiveDeliveryDate?.trim()) {
    return false;
  }

  if (!hasExplicitSelection) {
    return false;
  }

  if (
    isMealSelectionConfirmedAlreadySentForDelivery({
      effectiveDeliveryDate,
      mealSelectionConfirmedDeliveryDate,
    })
  ) {
    return false;
  }

  return true;
};

export const shouldSendMealSelectionReminderEmail = ({
  active,
  effectiveDeliveryDate,
  hasExplicitSelection,
  hasRecipient,
  mealSelectionReminderDeliveryDate,
  now = new Date(),
  status,
  subscriptionContractId,
  transactionalEmailsEnabled,
}: {
  active?: boolean | null;
  effectiveDeliveryDate?: string | null;
  hasExplicitSelection: boolean;
  hasRecipient: boolean;
  mealSelectionReminderDeliveryDate?: string | null;
  now?: Date;
  status?: string | null;
  subscriptionContractId?: string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (active !== true) {
    return false;
  }

  if (status !== "active") {
    return false;
  }

  if (!subscriptionContractId?.trim()) {
    return false;
  }

  if (!hasRecipient) {
    return false;
  }

  if (!effectiveDeliveryDate?.trim()) {
    return false;
  }

  if (isMealSelectionCutoffPassed(effectiveDeliveryDate, now)) {
    return false;
  }

  if (hasExplicitSelection) {
    return false;
  }

  if (
    isMealSelectionReminderAlreadySentForDelivery({
      effectiveDeliveryDate,
      mealSelectionReminderDeliveryDate,
    })
  ) {
    return false;
  }

  return true;
};

export const formatMealSelectionDeliveryDateLabel = (
  effectiveDeliveryDate: string | null | undefined,
): string | null =>
  formatSubscriptionEmailDeliveryDate(effectiveDeliveryDate);

export const formatMealSelectionCutoffLabel = (
  effectiveDeliveryDate: string | null | undefined,
): string | null => formatDeliveryCutoffDeadlineLabel(effectiveDeliveryDate);

export const buildMealSelectionConfirmedEmailData = ({
  customerName,
  effectiveDeliveryDate,
  mealsCount,
  portalUrl,
  selectedMeals,
  shop,
}: {
  customerName?: string | null;
  effectiveDeliveryDate: string;
  mealsCount: number;
  portalUrl?: string | null;
  selectedMeals: string[];
  shop?: string | null;
}): MealSelectionConfirmedEmailData => {
  const deliveryDateLabel =
    formatMealSelectionDeliveryDateLabel(effectiveDeliveryDate) ??
    effectiveDeliveryDate;

  return {
    customerName: customerName?.trim() || null,
    deliveryDateLabel,
    mealsCount,
    portalUrl: buildSubscriptionPortalUrl({ shop, portalUrl }),
    selectedCount: selectedMeals.length,
    selectedMeals,
  };
};

export const buildMealSelectionReminderEmailData = ({
  customerName,
  effectiveDeliveryDate,
  mealsCount,
  portalUrl,
  shop,
}: {
  customerName?: string | null;
  effectiveDeliveryDate: string;
  mealsCount: number;
  portalUrl?: string | null;
  shop?: string | null;
}): MealSelectionReminderEmailData => {
  const deliveryDateLabel =
    formatMealSelectionDeliveryDateLabel(effectiveDeliveryDate) ??
    effectiveDeliveryDate;
  const cutoffLabel =
    formatMealSelectionCutoffLabel(effectiveDeliveryDate) ??
    "la date limite indiquée dans votre espace client";

  return {
    customerName: customerName?.trim() || null,
    cutoffLabel,
    deliveryDateLabel,
    mealsCount,
    portalUrl: buildSubscriptionPortalUrl({ shop, portalUrl }),
  };
};

export const buildMealSelectionConfirmedEmailDataFromSelection = ({
  customerName,
  portalUrl,
  selection,
}: {
  customerName?: string | null;
  portalUrl?: string | null;
  selection: MealSelectionEmailSelectionSource;
  now?: Date;
}): MealSelectionConfirmedEmailData | null => {
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection);

  if (!effectiveDeliveryDate) {
    return null;
  }

  const mealsCount = selection.mealsCount ?? 0;
  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);

  if (mealsCount <= 0) {
    return null;
  }

  return buildMealSelectionConfirmedEmailData({
    customerName,
    effectiveDeliveryDate,
    mealsCount,
    portalUrl,
    selectedMeals,
    shop: selection.shop,
  });
};

export const buildMealSelectionReminderEmailDataFromSelection = ({
  customerName,
  portalUrl,
  selection,
}: {
  customerName?: string | null;
  portalUrl?: string | null;
  selection: MealSelectionEmailSelectionSource;
  now?: Date;
}): MealSelectionReminderEmailData | null => {
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection);

  if (!effectiveDeliveryDate) {
    return null;
  }

  const mealsCount = selection.mealsCount ?? 0;

  if (mealsCount <= 0) {
    return null;
  }

  return buildMealSelectionReminderEmailData({
    customerName,
    effectiveDeliveryDate,
    mealsCount,
    portalUrl,
    shop: selection.shop,
  });
};

export const evaluateMealSelectionConfirmedEligibility = ({
  now = new Date(),
  order,
  selection,
  transactionalEmailsEnabled,
}: {
  now?: Date;
  order?: MealSelectionEmailOrderSource | null;
  selection: MealSelectionEmailSelectionSource;
  transactionalEmailsEnabled: boolean;
}) => {
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection, now);
  const { recipient } = resolveSubscriptionEmailRecipient(selection, order);
  const hasExplicitSelection = hasExplicitMealSelectionForDelivery({
    effectiveDeliveryDate,
    mealSelectionLastExplicitDeliveryDate:
      selection.mealSelectionLastExplicitDeliveryDate,
  });

  return {
    effectiveDeliveryDate,
    eligible: shouldSendMealSelectionConfirmedEmail({
      active: selection.active,
      effectiveDeliveryDate,
      hasExplicitSelection,
      hasRecipient: Boolean(recipient),
      mealSelectionConfirmedDeliveryDate:
        selection.mealSelectionConfirmedDeliveryDate,
      status: selection.status,
      transactionalEmailsEnabled,
    }),
    hasExplicitSelection,
    recipient,
  };
};

export const evaluateMealSelectionReminderEligibility = ({
  now = new Date(),
  order,
  selection,
  transactionalEmailsEnabled,
}: {
  now?: Date;
  order?: MealSelectionEmailOrderSource | null;
  selection: MealSelectionEmailSelectionSource;
  transactionalEmailsEnabled: boolean;
}) => {
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection, now);
  const { recipient } = resolveSubscriptionEmailRecipient(selection, order);
  const hasExplicitSelection = hasExplicitMealSelectionForDelivery({
    effectiveDeliveryDate,
    mealSelectionLastExplicitDeliveryDate:
      selection.mealSelectionLastExplicitDeliveryDate,
  });

  return {
    effectiveDeliveryDate,
    eligible: shouldSendMealSelectionReminderEmail({
      active: selection.active,
      effectiveDeliveryDate,
      hasExplicitSelection,
      hasRecipient: Boolean(recipient),
      mealSelectionReminderDeliveryDate:
        selection.mealSelectionReminderDeliveryDate,
      now,
      status: selection.status,
      subscriptionContractId: selection.subscriptionContractId,
      transactionalEmailsEnabled,
    }),
    hasExplicitSelection,
    recipient,
  };
};

/**
 * Send MealSelectionConfirmedEmail once per effectiveDeliveryDate.
 * Idempotent via mealSelectionConfirmedDeliveryDate on SubscriptionMealSelection.
 */
export const trySendMealSelectionConfirmedEmail = async ({
  selectionId,
}: {
  selectionId: string;
}) => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[mealSelectionEmail] meal-selection-confirmed email skipped", {
      reason: "selection_missing",
      selectionId,
    });
    return;
  }

  const order = await db.boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolveSubscriptionEmailRecipient(
    selection,
    order,
  );
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection);
  const hasExplicitSelection = hasExplicitMealSelectionForDelivery({
    effectiveDeliveryDate,
    mealSelectionLastExplicitDeliveryDate:
      selection.mealSelectionLastExplicitDeliveryDate,
  });

  const eligible = shouldSendMealSelectionConfirmedEmail({
    active: selection.active,
    effectiveDeliveryDate,
    hasExplicitSelection,
    hasRecipient: Boolean(recipient),
    mealSelectionConfirmedDeliveryDate:
      selection.mealSelectionConfirmedDeliveryDate,
    status: selection.status,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient || !effectiveDeliveryDate) {
    console.log("[mealSelectionEmail] meal-selection-confirmed email skipped", {
      alreadySent: isMealSelectionConfirmedAlreadySentForDelivery({
        effectiveDeliveryDate,
        mealSelectionConfirmedDeliveryDate:
          selection.mealSelectionConfirmedDeliveryDate,
      }),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasExplicitSelection,
      hasRecipient: Boolean(recipient),
      selectionId: selection.id,
      status: selection.status,
    });
    return;
  }

  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
  const mealsCount = selection.mealsCount ?? 0;

  if (mealsCount <= 0) {
    console.log("[mealSelectionEmail] meal-selection-confirmed email skipped", {
      reason: "invalid_meals_count",
      selectionId: selection.id,
    });
    return;
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail({
    data: buildMealSelectionConfirmedEmailData({
      customerName,
      effectiveDeliveryDate,
      mealsCount,
      selectedMeals,
      shop: selection.shop,
    }),
    subject: "Votre sélection de repas est confirmée",
    template: "meal-selection-confirmed",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[mealSelectionEmail] meal-selection-confirmed email send failed", {
      message: result.message,
      reason: result.reason,
      selectionId: selection.id,
    });
    return;
  }

  const sentAt = new Date();

  const updateResult = await db.subscriptionMealSelection.updateMany({
    data: {
      mealSelectionConfirmedDeliveryDate: effectiveDeliveryDate,
      mealSelectionConfirmedEmailSentAt: sentAt,
    },
    where: {
      id: selection.id,
      OR: [
        { mealSelectionConfirmedDeliveryDate: null },
        { mealSelectionConfirmedDeliveryDate: { not: effectiveDeliveryDate } },
      ],
    },
  });

  if (updateResult.count === 0) {
    console.log("[mealSelectionEmail] meal-selection-confirmed email idempotence skip", {
      effectiveDeliveryDate,
      emailId: result.id,
      reason: "already_sent_for_delivery",
      selectionId: selection.id,
    });
    return;
  }

  console.log("[mealSelectionEmail] meal-selection-confirmed email sent", {
    effectiveDeliveryDate,
    emailId: result.id,
    selectionId: selection.id,
    to: recipient.email,
  });
};

export type TrySendMealSelectionReminderResult =
  | {
      effectiveDeliveryDate: string;
      emailId: string;
      status: "sent";
    }
  | {
      reason: string;
      status: "skipped";
    }
  | {
      message: string;
      reason: string;
      status: "failed";
    };

/**
 * Send MealSelectionReminderEmail once per effectiveDeliveryDate.
 * Idempotent via mealSelectionReminderDeliveryDate on SubscriptionMealSelection.
 */
export const trySendMealSelectionReminderEmail = async ({
  selectionId,
}: {
  selectionId: string;
}): Promise<TrySendMealSelectionReminderResult> => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[mealSelectionEmail] meal-selection-reminder email skipped", {
      reason: "selection_missing",
      selectionId,
    });
    return { reason: "selection_missing", status: "skipped" };
  }

  const order = await db.boxOrder.findUnique({
    select: { customerEmail: true, customerName: true },
    where: {
      shop_shopifyOrderId: {
        shop: selection.shop,
        shopifyOrderId: selection.shopifyOrderId,
      },
    },
  });

  const { customerName, recipient } = resolveSubscriptionEmailRecipient(
    selection,
    order,
  );
  const { effectiveDeliveryDate } = resolveMealSelectionCycle(selection);
  const hasExplicitSelection = hasExplicitMealSelectionForDelivery({
    effectiveDeliveryDate,
    mealSelectionLastExplicitDeliveryDate:
      selection.mealSelectionLastExplicitDeliveryDate,
  });

  const eligible = shouldSendMealSelectionReminderEmail({
    active: selection.active,
    effectiveDeliveryDate,
    hasExplicitSelection,
    hasRecipient: Boolean(recipient),
    mealSelectionReminderDeliveryDate: selection.mealSelectionReminderDeliveryDate,
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient || !effectiveDeliveryDate) {
    console.log("[mealSelectionEmail] meal-selection-reminder email skipped", {
      alreadySent: isMealSelectionReminderAlreadySentForDelivery({
        effectiveDeliveryDate,
        mealSelectionReminderDeliveryDate:
          selection.mealSelectionReminderDeliveryDate,
      }),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasExplicitSelection,
      hasRecipient: Boolean(recipient),
      selectionId: selection.id,
      status: selection.status,
    });
    return { reason: "not_eligible", status: "skipped" };
  }

  const mealsCount = selection.mealsCount ?? 0;

  if (mealsCount <= 0) {
    console.log("[mealSelectionEmail] meal-selection-reminder email skipped", {
      reason: "invalid_meals_count",
      selectionId: selection.id,
    });
    return { reason: "invalid_meals_count", status: "skipped" };
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail({
    data: buildMealSelectionReminderEmailData({
      customerName,
      effectiveDeliveryDate,
      mealsCount,
      shop: selection.shop,
    }),
    subject: "N'oubliez pas de choisir vos repas",
    template: "meal-selection-reminder",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[mealSelectionEmail] meal-selection-reminder email send failed", {
      message: result.message,
      reason: result.reason,
      selectionId: selection.id,
    });
    return {
      message: result.message,
      reason: result.reason,
      status: "failed",
    };
  }

  const sentAt = new Date();

  const updateResult = await db.subscriptionMealSelection.updateMany({
    data: {
      mealSelectionReminderDeliveryDate: effectiveDeliveryDate,
      mealSelectionReminderEmailSentAt: sentAt,
    },
    where: {
      id: selection.id,
      OR: [
        { mealSelectionReminderDeliveryDate: null },
        { mealSelectionReminderDeliveryDate: { not: effectiveDeliveryDate } },
      ],
    },
  });

  if (updateResult.count === 0) {
    console.log("[mealSelectionEmail] meal-selection-reminder email idempotence skip", {
      effectiveDeliveryDate,
      emailId: result.id,
      reason: "already_sent_for_delivery",
      selectionId: selection.id,
    });
    return { reason: "already_sent_for_delivery", status: "skipped" };
  }

  console.log("[mealSelectionEmail] meal-selection-reminder email sent", {
    effectiveDeliveryDate,
    emailId: result.id,
    selectionId: selection.id,
    to: recipient.email,
  });

  return {
    effectiveDeliveryDate,
    emailId: result.id,
    status: "sent",
  };
};

export { resolveSubscriptionEmailRecipient };
