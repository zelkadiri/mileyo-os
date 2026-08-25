/**
 * Pure helpers to build subscription-email recipient + display fields
 * from SubscriptionMealSelection (+ optional BoxOrder name).
 *
 * Eligibility helpers are pure (no Resend / no DB). Transport stays in sendEmail.
 */

import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../constants/subscriptionCycle";
import db from "../../db.server";
import { isMileyoTransactionalEmailEnabled } from "./email-client.server";
import type {
  EmailRecipient,
  SubscriptionCreatedEmailData,
  SubscriptionPauseCause,
  SubscriptionPausedEmailData,
} from "./email.types";
import {
  resolvePaymentEmailRecipient,
  type PaymentEmailOrderSource,
  type PaymentEmailSelectionSource,
  type ResolvedPaymentEmailRecipient,
} from "./payment-email.server";

/** App proxy path for the customer portal (relative to shop domain). */
export const SUBSCRIPTION_PORTAL_PATH = "/apps/box-builder/portal";

export const SUBSCRIPTION_PAUSE_CAUSES_V1 = [
  "user_voluntary",
  "payment_final_failure",
] as const satisfies readonly SubscriptionPauseCause[];

export type SubscriptionEmailSelectionSource = PaymentEmailSelectionSource & {
  mealsCount?: number | null;
  nextScheduledDeliveryDate?: string | null;
  shop?: string | null;
  subscriptionCreatedEmailSentAt?: Date | string | null;
  subscriptionPausedEmailSentAt?: Date | string | null;
};

export type SubscriptionEmailOrderSource = PaymentEmailOrderSource;

export type ResolvedSubscriptionEmailRecipient = ResolvedPaymentEmailRecipient;

/**
 * Prefer selection email; fall back to box-order email.
 * customerName comes from the order when available.
 */
export const resolveSubscriptionEmailRecipient = (
  selection: SubscriptionEmailSelectionSource,
  order?: SubscriptionEmailOrderSource | null,
): ResolvedSubscriptionEmailRecipient =>
  resolvePaymentEmailRecipient(selection, order);

export const isAllowedSubscriptionPauseCause = (
  pauseCause: string,
): pauseCause is SubscriptionPauseCause =>
  (SUBSCRIPTION_PAUSE_CAUSES_V1 as readonly string[]).includes(pauseCause);

/**
 * Build an absolute portal URL from the shop domain, or use a caller override.
 * Returns null when neither shop nor override is available.
 */
export const buildSubscriptionPortalUrl = ({
  shop,
  portalUrl,
}: {
  shop?: string | null;
  portalUrl?: string | null;
} = {}): string | null => {
  const override = portalUrl?.trim();
  if (override) {
    return override;
  }

  const normalizedShop = shop?.trim();
  if (!normalizedShop) {
    return null;
  }

  return `https://${normalizedShop}${SUBSCRIPTION_PORTAL_PATH}`;
};

export const formatSubscriptionEmailDeliveryDate = (
  value: string | null | undefined,
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(`${trimmed}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("fr-FR", {
    dateStyle: "long",
    timeZone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });
};

export const formatSubscriptionEmailDateTime = (
  value: Date | string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("fr-FR", {
    timeZone: SUBSCRIPTION_CYCLE_TIMEZONE,
  });
};

export const shouldSendSubscriptionCreatedEmail = ({
  hasRecipient,
  status,
  subscriptionContractId,
  subscriptionCreatedEmailSentAt,
  transactionalEmailsEnabled,
}: {
  hasRecipient: boolean;
  status?: string | null;
  subscriptionContractId?: string | null;
  subscriptionCreatedEmailSentAt?: Date | string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (status !== "active") {
    return false;
  }

  if (!subscriptionContractId?.trim()) {
    return false;
  }

  if (subscriptionCreatedEmailSentAt) {
    return false;
  }

  return hasRecipient;
};

export const shouldSendSubscriptionPausedEmail = ({
  hasRecipient,
  pauseCause,
  status,
  subscriptionPausedEmailSentAt,
  transactionalEmailsEnabled,
}: {
  hasRecipient: boolean;
  pauseCause: string;
  status?: string | null;
  subscriptionPausedEmailSentAt?: Date | string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (status !== "paused") {
    return false;
  }

  if (!isAllowedSubscriptionPauseCause(pauseCause)) {
    return false;
  }

  if (subscriptionPausedEmailSentAt) {
    return false;
  }

  return hasRecipient;
};

export const buildSubscriptionCreatedEmailData = ({
  customerName,
  mealsCount,
  nextScheduledDeliveryDate,
  portalUrl,
  shop,
}: {
  customerName?: string | null;
  mealsCount?: number | null;
  nextScheduledDeliveryDate?: string | null;
  portalUrl?: string | null;
  shop?: string | null;
}): SubscriptionCreatedEmailData => ({
  customerName: customerName?.trim() || null,
  mealsCount: mealsCount ?? null,
  nextDelivery: formatSubscriptionEmailDeliveryDate(nextScheduledDeliveryDate),
  portalUrl: buildSubscriptionPortalUrl({ shop, portalUrl }),
});

export const buildSubscriptionPausedEmailData = ({
  customerName,
  pauseCause,
  portalUrl,
  shop,
}: {
  customerName?: string | null;
  pauseCause: SubscriptionPauseCause;
  portalUrl?: string | null;
  shop?: string | null;
}): SubscriptionPausedEmailData => ({
  customerName: customerName?.trim() || null,
  pauseCause,
  portalUrl: buildSubscriptionPortalUrl({ shop, portalUrl }),
});

/**
 * Send SubscriptionCreatedEmail once when a first subscription is fully linked.
 * Idempotent via subscriptionCreatedEmailSentAt on SubscriptionMealSelection.
 */
export const trySendSubscriptionCreatedEmail = async ({
  selectionId,
}: {
  selectionId: string;
}) => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[subscriptionEmail] subscription-created email skipped", {
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

  const eligible = shouldSendSubscriptionCreatedEmail({
    hasRecipient: Boolean(recipient),
    status: selection.status,
    subscriptionContractId: selection.subscriptionContractId,
    subscriptionCreatedEmailSentAt: selection.subscriptionCreatedEmailSentAt,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient) {
    console.log("[subscriptionEmail] subscription-created email skipped", {
      alreadySent: Boolean(selection.subscriptionCreatedEmailSentAt),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasContract: Boolean(selection.subscriptionContractId?.trim()),
      hasRecipient: Boolean(recipient),
      selectionId: selection.id,
      status: selection.status,
    });
    return;
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail({
    data: buildSubscriptionCreatedEmailData({
      customerName,
      mealsCount: selection.mealsCount,
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
      shop: selection.shop,
    }),
    subject: "Votre abonnement Mileyo est confirmé",
    template: "subscription-created",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[subscriptionEmail] subscription-created email send failed", {
      message: result.message,
      reason: result.reason,
      selectionId: selection.id,
    });
    return;
  }

  const sentAt = new Date();

  const updateResult = await db.subscriptionMealSelection.updateMany({
    data: { subscriptionCreatedEmailSentAt: sentAt },
    where: {
      id: selection.id,
      subscriptionCreatedEmailSentAt: null,
    },
  });

  if (updateResult.count === 0) {
    console.log("[subscriptionEmail] subscription-created email idempotence skip", {
      emailId: result.id,
      reason: "already_sent",
      selectionId: selection.id,
    });
    return;
  }

  console.log("[subscriptionEmail] subscription-created email sent", {
    emailId: result.id,
    selectionId: selection.id,
    to: recipient.email,
  });
};

const SUBSCRIPTION_PAUSED_EMAIL_SUBJECTS: Record<SubscriptionPauseCause, string> =
  {
    payment_final_failure: "Votre abonnement a été suspendu",
    user_voluntary: "Votre abonnement est en pause",
  };

/**
 * Send SubscriptionPausedEmail once per pause cycle.
 * Idempotent via subscriptionPausedEmailSentAt on SubscriptionMealSelection.
 */
export const trySendSubscriptionPausedEmail = async ({
  pauseCause,
  selectionId,
}: {
  pauseCause: SubscriptionPauseCause;
  selectionId: string;
}) => {
  const selection = await db.subscriptionMealSelection.findUnique({
    where: { id: selectionId },
  });

  if (!selection) {
    console.log("[subscriptionEmail] subscription-paused email skipped", {
      pauseCause,
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

  const eligible = shouldSendSubscriptionPausedEmail({
    hasRecipient: Boolean(recipient),
    pauseCause,
    status: selection.status,
    subscriptionPausedEmailSentAt: selection.subscriptionPausedEmailSentAt,
    transactionalEmailsEnabled: isMileyoTransactionalEmailEnabled(),
  });

  if (!eligible || !recipient) {
    console.log("[subscriptionEmail] subscription-paused email skipped", {
      alreadySent: Boolean(selection.subscriptionPausedEmailSentAt),
      flagEnabled: isMileyoTransactionalEmailEnabled(),
      hasRecipient: Boolean(recipient),
      pauseCause,
      selectionId: selection.id,
      status: selection.status,
    });
    return;
  }

  const { sendEmail } = await import("./email.server");

  const result = await sendEmail({
    data: buildSubscriptionPausedEmailData({
      customerName,
      pauseCause,
      shop: selection.shop,
    }),
    subject: SUBSCRIPTION_PAUSED_EMAIL_SUBJECTS[pauseCause],
    template: "subscription-paused",
    to: recipient,
  });

  if (!result.ok) {
    console.log("[subscriptionEmail] subscription-paused email send failed", {
      message: result.message,
      pauseCause,
      reason: result.reason,
      selectionId: selection.id,
    });
    return;
  }

  const sentAt = new Date();

  const updateResult = await db.subscriptionMealSelection.updateMany({
    data: { subscriptionPausedEmailSentAt: sentAt },
    where: {
      id: selection.id,
      subscriptionPausedEmailSentAt: null,
    },
  });

  if (updateResult.count === 0) {
    console.log("[subscriptionEmail] subscription-paused email idempotence skip", {
      emailId: result.id,
      pauseCause,
      reason: "already_sent",
      selectionId: selection.id,
    });
    return;
  }

  console.log("[subscriptionEmail] subscription-paused email sent", {
    emailId: result.id,
    pauseCause,
    selectionId: selection.id,
    to: recipient.email,
  });
};

/**
 * Clear pause-email idempotence after a resume is persisted locally as active.
 * Enables a future pause to send a fresh confirmation email (new episode).
 */
export const resetSubscriptionPausedEmailSentAt = async ({
  selectionId,
}: {
  selectionId: string;
}) => {
  const updateResult = await db.subscriptionMealSelection.updateMany({
    data: {
      subscriptionPauseEmailEpisodeId: null,
      subscriptionPausedEmailSentAt: null,
    },
    where: {
      active: true,
      id: selectionId,
      status: "active",
      OR: [
        { subscriptionPausedEmailSentAt: { not: null } },
        { subscriptionPauseEmailEpisodeId: { not: null } },
      ],
    },
  });

  if (updateResult.count === 0) {
    return;
  }

  console.log("[subscriptionEmail] subscription-paused email reset after resume", {
    selectionId,
  });
};
