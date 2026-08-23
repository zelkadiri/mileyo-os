/**
 * Pure helpers for upcoming-delivery transactional emails.
 *
 * Timing: after meal cutoff, on J-2 / J-1 from 09:00 Europe/Paris.
 * Cycle key is always effectiveDeliveryDate (never raw nextScheduledDeliveryDate).
 *
 * Eligibility helpers are pure (no Resend / no DB). Transport in trySendUpcomingDeliveryEmail.
 */

import {
  SUBSCRIPTION_CYCLE_TIMEZONE,
  UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR,
  UPCOMING_DELIVERY_EMAIL_WINDOW_START_MINUTE,
} from "../../constants/subscriptionCycle";
import {
  addCalendarDays,
  getDeliveryCutoffStatus,
  getWeekday,
  parseDeliveryDate,
  projectActiveScheduledDeliveryDate,
  referenceDateFromInstant,
} from "../../utils/deliveryDate";
import { getSelectedMealsFromJson } from "../../utils/mealSelection";
import {
  getMerchantSupportContact,
  MERCHANT_SUPPORT_LABEL,
  resolveMerchantSupportContact,
} from "../../utils/merchantSupport.server";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type { UpcomingDeliveryEmailData } from "./email.types";
import {
  buildSubscriptionPortalUrl,
  formatSubscriptionEmailDeliveryDate,
  resolveSubscriptionEmailRecipient,
  type SubscriptionEmailOrderSource,
  type SubscriptionEmailSelectionSource,
} from "./subscription-email.server";

export type UpcomingDeliveryEmailSelectionSource = SubscriptionEmailSelectionSource & {
  active?: boolean | null;
  status?: string | null;
  preferredDeliveryWeekday?: number | null;
  selectedMeals?: unknown;
  upcomingDeliveryEmailSentAt?: Date | string | null;
  upcomingDeliveryEmailDeliveryDate?: string | null;
};

export type UpcomingDeliveryEmailOrderSource = SubscriptionEmailOrderSource;

export type UpcomingDeliveryCycle = {
  effectiveDeliveryDate: string | null;
  projectedFromStoredDate: string | null;
  wasProjected: boolean;
};

/**
 * Resolve the active delivery cycle key (`YYYY-MM-DD`) from stored selection fields.
 * Never recalculates the cycle manually — delegates to projectActiveScheduledDeliveryDate.
 */
export const resolveUpcomingDeliveryCycle = (
  selection: {
    nextScheduledDeliveryDate?: string | null;
    preferredDeliveryWeekday?: number | null;
  },
  now: Date = new Date(),
): UpcomingDeliveryCycle => {
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

export const isUpcomingDeliveryEmailAlreadySentForDelivery = ({
  effectiveDeliveryDate,
  upcomingDeliveryEmailDeliveryDate,
}: {
  effectiveDeliveryDate?: string | null;
  upcomingDeliveryEmailDeliveryDate?: string | null;
}): boolean => {
  const delivery = effectiveDeliveryDate?.trim();
  const sentFor = upcomingDeliveryEmailDeliveryDate?.trim();

  if (!delivery || !sentFor) {
    return false;
  }

  return sentFor === delivery;
};

/**
 * True when meal cutoff is known and already passed for this delivery date.
 * Never invents cutoff from "delivery - 3 days" — uses getDeliveryCutoffStatus.
 */
export const isUpcomingDeliveryCutoffSatisfied = (
  effectiveDeliveryDate: string | null | undefined,
  now: Date = new Date(),
): boolean => {
  const cutoff = getDeliveryCutoffStatus(effectiveDeliveryDate, now);
  return cutoff.isKnown === true && cutoff.isPassed === true;
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

const isParisWindowStartReached = (
  now: Date,
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): boolean => {
  const { hour, minute } = getParisWallClockParts(now, timezone);

  return (
    hour > UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR ||
    (hour === UPCOMING_DELIVERY_EMAIL_WINDOW_START_HOUR &&
      minute >= UPCOMING_DELIVERY_EMAIL_WINDOW_START_MINUTE)
  );
};

/**
 * Upcoming delivery send window V1:
 * - only J-2 and J-1 relative to effectiveDeliveryDate
 * - from 09:00 Europe/Paris on those days
 * - never day J or after; never before J-2
 */
export const isUpcomingDeliveryEmailSendWindowOpen = ({
  effectiveDeliveryDate,
  now = new Date(),
  timezone = SUBSCRIPTION_CYCLE_TIMEZONE,
}: {
  effectiveDeliveryDate?: string | null;
  now?: Date;
  timezone?: string;
}): boolean => {
  const delivery = parseDeliveryDate(effectiveDeliveryDate?.trim());

  if (!delivery) {
    return false;
  }

  const todayParis = referenceDateFromInstant(now, timezone);
  const jMinus2 = addCalendarDays(delivery, -2);
  const jMinus1 = addCalendarDays(delivery, -1);

  if (todayParis !== jMinus2 && todayParis !== jMinus1) {
    return false;
  }

  return isParisWindowStartReached(now, timezone);
};

/** Tue / Wed / Thu from 09:00 Paris — only days that can be J-2/J-1 for Thu/Fri deliveries. */
const UPCOMING_DELIVERY_RUNNER_WEEKDAYS = [2, 3, 4] as const;

/**
 * Global runner gate before scanning selections.
 * Does not assume all boxes share the same delivery weekday.
 */
export const isUpcomingDeliveryRunnerWindowPotentiallyOpen = (
  now: Date = new Date(),
  timezone: string = SUBSCRIPTION_CYCLE_TIMEZONE,
): boolean => {
  if (!isParisWindowStartReached(now, timezone)) {
    return false;
  }

  const todayParis = referenceDateFromInstant(now, timezone);
  const weekday = getWeekday(todayParis);

  return (UPCOMING_DELIVERY_RUNNER_WEEKDAYS as readonly number[]).includes(
    weekday,
  );
};

export const hasUsableUpcomingDeliveryMeals = ({
  mealsCount,
  selectedMeals,
}: {
  mealsCount?: number | null;
  selectedMeals?: unknown;
}): boolean => {
  if ((mealsCount ?? 0) <= 0) {
    return false;
  }

  return getSelectedMealsFromJson(selectedMeals).length > 0;
};

export const shouldSendUpcomingDeliveryEmail = ({
  active,
  effectiveDeliveryDate,
  hasRecipient,
  hasUsableMeals,
  now = new Date(),
  status,
  subscriptionContractId,
  transactionalEmailsEnabled,
  upcomingDeliveryEmailDeliveryDate,
}: {
  active?: boolean | null;
  effectiveDeliveryDate?: string | null;
  hasRecipient: boolean;
  hasUsableMeals: boolean;
  now?: Date;
  status?: string | null;
  subscriptionContractId?: string | null;
  transactionalEmailsEnabled: boolean;
  upcomingDeliveryEmailDeliveryDate?: string | null;
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

  if (!hasUsableMeals) {
    return false;
  }

  if (!isUpcomingDeliveryCutoffSatisfied(effectiveDeliveryDate, now)) {
    return false;
  }

  if (
    !isUpcomingDeliveryEmailSendWindowOpen({
      effectiveDeliveryDate,
      now,
    })
  ) {
    return false;
  }

  if (
    isUpcomingDeliveryEmailAlreadySentForDelivery({
      effectiveDeliveryDate,
      upcomingDeliveryEmailDeliveryDate,
    })
  ) {
    return false;
  }

  return true;
};

export const formatUpcomingDeliveryDateLabel = (
  effectiveDeliveryDate: string | null | undefined,
): string | null => formatSubscriptionEmailDeliveryDate(effectiveDeliveryDate);

export const buildUpcomingDeliveryEmailData = ({
  customerName,
  effectiveDeliveryDate,
  mealsCount,
  portalUrl,
  selectedMeals,
  shop,
  supportHref,
  supportLabel,
}: {
  customerName?: string | null;
  effectiveDeliveryDate: string;
  mealsCount: number;
  portalUrl?: string | null;
  selectedMeals: string[];
  shop?: string | null;
  supportHref?: string | null;
  supportLabel?: string | null;
}): UpcomingDeliveryEmailData | null => {
  const resolvedPortalUrl = buildSubscriptionPortalUrl({ shop, portalUrl });

  if (!resolvedPortalUrl) {
    return null;
  }

  if (mealsCount <= 0 || selectedMeals.length === 0) {
    return null;
  }

  const deliveryDateLabel =
    formatUpcomingDeliveryDateLabel(effectiveDeliveryDate) ??
    effectiveDeliveryDate;

  const support =
    supportHref?.trim() || supportLabel?.trim()
      ? {
          supportHref: supportHref?.trim() || null,
          supportLabel: supportLabel?.trim() || MERCHANT_SUPPORT_LABEL,
        }
      : (() => {
          const contact = resolveMerchantSupportContact();
          return {
            supportHref: contact.href,
            supportLabel: contact.label,
          };
        })();

  return {
    customerName: customerName?.trim() || null,
    deliveryDateLabel,
    mealsCount,
    portalUrl: resolvedPortalUrl,
    selectedMeals,
    supportHref: support.supportHref,
    supportLabel: support.supportLabel,
  };
};

export const buildUpcomingDeliveryEmailDataFromSelection = ({
  customerName,
  now = new Date(),
  portalUrl,
  selection,
  supportHref,
  supportLabel,
}: {
  customerName?: string | null;
  now?: Date;
  portalUrl?: string | null;
  selection: UpcomingDeliveryEmailSelectionSource;
  supportHref?: string | null;
  supportLabel?: string | null;
}): UpcomingDeliveryEmailData | null => {
  const { effectiveDeliveryDate } = resolveUpcomingDeliveryCycle(selection, now);

  if (!effectiveDeliveryDate) {
    return null;
  }

  const mealsCount = selection.mealsCount ?? 0;
  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);

  return buildUpcomingDeliveryEmailData({
    customerName,
    effectiveDeliveryDate,
    mealsCount,
    portalUrl,
    selectedMeals,
    shop: selection.shop,
    supportHref,
    supportLabel,
  });
};

export const evaluateUpcomingDeliveryEligibility = ({
  now = new Date(),
  order,
  selection,
  transactionalEmailsEnabled,
}: {
  now?: Date;
  order?: UpcomingDeliveryEmailOrderSource | null;
  selection: UpcomingDeliveryEmailSelectionSource;
  transactionalEmailsEnabled: boolean;
}) => {
  const { effectiveDeliveryDate } = resolveUpcomingDeliveryCycle(selection, now);
  const { recipient } = resolveSubscriptionEmailRecipient(selection, order);
  const hasUsableMeals = hasUsableUpcomingDeliveryMeals({
    mealsCount: selection.mealsCount,
    selectedMeals: selection.selectedMeals,
  });

  return {
    effectiveDeliveryDate,
    eligible: shouldSendUpcomingDeliveryEmail({
      active: selection.active,
      effectiveDeliveryDate,
      hasRecipient: Boolean(recipient),
      hasUsableMeals,
      now,
      status: selection.status,
      subscriptionContractId: selection.subscriptionContractId,
      transactionalEmailsEnabled,
      upcomingDeliveryEmailDeliveryDate:
        selection.upcomingDeliveryEmailDeliveryDate,
    }),
    hasUsableMeals,
    recipient,
  };
};

export type TrySendUpcomingDeliveryEmailResult =
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
 * Send UpcomingDeliveryEmail once per effectiveDeliveryDate.
 * Idempotent via upcomingDeliveryEmailDeliveryDate on SubscriptionMealSelection.
 */
export const trySendUpcomingDeliveryEmail = async ({
  now = new Date(),
  selectionId,
}: {
  now?: Date;
  selectionId: string;
}): Promise<TrySendUpcomingDeliveryEmailResult> => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[upcomingDeliveryEmail] upcoming-delivery email skipped", {
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
  const { effectiveDeliveryDate } = resolveUpcomingDeliveryCycle(selection, now);
  const hasUsableMeals = hasUsableUpcomingDeliveryMeals({
    mealsCount: selection.mealsCount,
    selectedMeals: selection.selectedMeals,
  });

  const eligible = shouldSendUpcomingDeliveryEmail({
    active: selection.active,
    effectiveDeliveryDate,
    hasRecipient: Boolean(recipient),
    hasUsableMeals,
    now,
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
    upcomingDeliveryEmailDeliveryDate:
      selection.upcomingDeliveryEmailDeliveryDate,
  });

  if (!eligible || !recipient || !effectiveDeliveryDate) {
    console.log("[upcomingDeliveryEmail] upcoming-delivery email skipped", {
      alreadySent: isUpcomingDeliveryEmailAlreadySentForDelivery({
        effectiveDeliveryDate,
        upcomingDeliveryEmailDeliveryDate:
          selection.upcomingDeliveryEmailDeliveryDate,
      }),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasRecipient: Boolean(recipient),
      hasUsableMeals,
      selectionId: selection.id,
      status: selection.status,
    });
    return { reason: "not_eligible", status: "skipped" };
  }

  const merchantSupport = await getMerchantSupportContact(selection.shop);
  const selectedMeals = getSelectedMealsFromJson(selection.selectedMeals);
  const mealsCount = selection.mealsCount ?? 0;

  const emailData = buildUpcomingDeliveryEmailData({
    customerName,
    effectiveDeliveryDate,
    mealsCount,
    selectedMeals,
    shop: selection.shop,
    supportHref: merchantSupport.href,
    supportLabel: merchantSupport.label,
  });

  if (!emailData) {
    console.log("[upcomingDeliveryEmail] upcoming-delivery email skipped", {
      reason: "invalid_email_data",
      selectionId: selection.id,
    });
    return { reason: "invalid_email_data", status: "skipped" };
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail({
    data: emailData,
    subject: "Votre prochaine box Mileyo arrive bientôt",
    template: "upcoming-delivery",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[upcomingDeliveryEmail] upcoming-delivery email send failed", {
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
      upcomingDeliveryEmailDeliveryDate: effectiveDeliveryDate,
      upcomingDeliveryEmailSentAt: sentAt,
    },
    where: {
      id: selection.id,
      OR: [
        { upcomingDeliveryEmailDeliveryDate: null },
        { upcomingDeliveryEmailDeliveryDate: { not: effectiveDeliveryDate } },
      ],
    },
  });

  if (updateResult.count === 0) {
    console.log("[upcomingDeliveryEmail] upcoming-delivery email idempotence skip", {
      effectiveDeliveryDate,
      emailId: result.id,
      reason: "already_sent_for_delivery",
      selectionId: selection.id,
    });
    return { reason: "already_sent_for_delivery", status: "skipped" };
  }

  console.log("[upcomingDeliveryEmail] upcoming-delivery email sent", {
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
