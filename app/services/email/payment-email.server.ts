/**
 * Pure helpers to build payment-email recipient + display fields
 * from SubscriptionMealSelection (+ optional BoxOrder name).
 *
 * Eligibility helpers are pure (no Resend / no DB). Transport stays in sendEmail.
 */

import { SUBSCRIPTION_CYCLE_TIMEZONE } from "../../constants/subscriptionCycle";
import type {
  EmailRecipient,
  PaymentFailedEmailData,
  PaymentRecoveredEmailData,
} from "./email.types";

export type PaymentEmailSelectionSource = {
  customerEmail: string | null;
  subscriptionContractId: string | null;
};

export type PaymentEmailOrderSource = {
  customerEmail?: string | null;
  customerName?: string | null;
};

export type ResolvedPaymentEmailRecipient = {
  customerName: string | null;
  recipient: EmailRecipient | null;
};

/**
 * Prefer selection email; fall back to box-order email.
 * customerName comes from the order when available.
 */
export const resolvePaymentEmailRecipient = (
  selection: PaymentEmailSelectionSource,
  order?: PaymentEmailOrderSource | null,
): ResolvedPaymentEmailRecipient => {
  const email =
    selection.customerEmail?.trim() ||
    order?.customerEmail?.trim() ||
    null;

  const customerName = order?.customerName?.trim() || null;

  if (!email) {
    return { customerName, recipient: null };
  }

  return {
    customerName,
    recipient: {
      email,
      ...(customerName ? { name: customerName } : {}),
    },
  };
};

export const formatPaymentEmailDateTime = (
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

/**
 * First payment-failure Mileyo email only.
 * Retries, duplicates (already sent), and flag-off never qualify.
 */
export const shouldSendPaymentFailedEmail = ({
  failureCount,
  hasRecipient,
  paymentFailedEmailSentAt,
  transactionalEmailsEnabled,
}: {
  failureCount: number;
  hasRecipient: boolean;
  paymentFailedEmailSentAt?: Date | string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (failureCount !== 1) {
    return false;
  }

  if (paymentFailedEmailSentAt) {
    return false;
  }

  return hasRecipient;
};

/**
 * Payment recovered Mileyo email only after a real open→recovered transition.
 * Clean success without recovery, duplicates, and flag-off never qualify.
 */
export const shouldSendPaymentRecoveredEmail = ({
  hasRealTransition,
  hasRecipient,
  paymentRecoveredEmailSentAt,
  transactionalEmailsEnabled,
}: {
  hasRealTransition: boolean;
  hasRecipient: boolean;
  paymentRecoveredEmailSentAt?: Date | string | null;
  transactionalEmailsEnabled: boolean;
}): boolean => {
  if (!transactionalEmailsEnabled) {
    return false;
  }

  if (!hasRealTransition) {
    return false;
  }

  if (paymentRecoveredEmailSentAt) {
    return false;
  }

  return hasRecipient;
};

export const buildPaymentFailedEmailData = ({
  customerName,
  failureCount,
  nextRetryAt,
  recoveryId,
  subscriptionContractId,
}: {
  customerName?: string | null;
  failureCount?: number | null;
  nextRetryAt?: string | Date | null;
  recoveryId?: string | null;
  subscriptionContractId?: string | null;
}): PaymentFailedEmailData => ({
  customerName: customerName?.trim() || null,
  failureCount: failureCount ?? null,
  nextRetryAt:
    nextRetryAt instanceof Date
      ? nextRetryAt.toISOString()
      : (nextRetryAt ?? null),
  recoveryId: recoveryId ?? null,
  subscriptionContractId: subscriptionContractId ?? null,
});

export const buildPaymentRecoveredEmailData = ({
  customerName,
  orderId,
  recoveryId,
  subscriptionContractId,
}: {
  customerName?: string | null;
  orderId?: string | null;
  recoveryId?: string | null;
  subscriptionContractId?: string | null;
}): PaymentRecoveredEmailData => ({
  customerName: customerName?.trim() || null,
  orderId: orderId ?? null,
  recoveryId: recoveryId ?? null,
  subscriptionContractId: subscriptionContractId ?? null,
});
