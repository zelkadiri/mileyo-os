import { RECOVERY_STATUS } from "../constants/subscriptionPaymentRecovery";
import {
  derivePortalSubscriptionState,
  isRecentBillingAttempt,
  isResumeAttemptInFlight,
  RESUME_LOCK_STATUS,
} from "./subscriptionBillingWorker.server";
import {
  getDeliveryCutoffBlockMessage,
  getDeliveryCutoffBlockReason,
  type DeliveryCutoffBlockReason,
} from "./deliveryCutoff.server";

export type SubscriptionModificationBlockReason =
  | "billing_processing"
  | "missing_contract"
  | "recovery_processing"
  | "resume_processing";

export type PortalModificationBlockReason =
  | SubscriptionModificationBlockReason
  | DeliveryCutoffBlockReason;

export type PortalModificationActionKind =
  | "modification"
  | "subscription_control";

/** Billing attempt statuses that mean an order may still be created. */
export const IN_FLIGHT_BILLING_ATTEMPT_STATUSES = new Set([
  "submitted",
  "challenged",
  "processing",
  "unknown",
  RESUME_LOCK_STATUS.PROCESSING,
]);

export const isInFlightBillingAttemptStatus = (status: string | null) =>
  status !== null && IN_FLIGHT_BILLING_ATTEMPT_STATUSES.has(status);

export const getSubscriptionModificationBlockReason = (
  selection: {
    active: boolean;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStatus: string | null;
    status: string;
    subscriptionContractId: string | null;
  },
  recovery?: {
    status: string;
  } | null,
): SubscriptionModificationBlockReason | null => {
  if (!selection.subscriptionContractId) {
    return "missing_contract";
  }

  if (
    isResumeAttemptInFlight(selection) ||
    derivePortalSubscriptionState(selection) === "resume_processing"
  ) {
    return "resume_processing";
  }

  if (recovery?.status === RECOVERY_STATUS.PROCESSING) {
    return "recovery_processing";
  }

  if (isRecentBillingAttempt(selection.lastBillingAttemptAt)) {
    if (isInFlightBillingAttemptStatus(selection.lastBillingAttemptStatus)) {
      return "billing_processing";
    }
  }

  return null;
};

export const getPortalModificationBlockReason = (
  selection: {
    active: boolean;
    lastBillingAttemptAt: Date | null;
    lastBillingAttemptStatus: string | null;
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday?: number | null;
    resumeAttemptOrderId: string | null;
    resumeAttemptStatus: string | null;
    status: string;
    subscriptionContractId: string | null;
  },
  recovery?: {
    status: string;
  } | null,
  now: Date = new Date(),
): PortalModificationBlockReason | null => {
  const billingBlockReason = getSubscriptionModificationBlockReason(
    selection,
    recovery,
  );

  if (billingBlockReason) {
    return billingBlockReason;
  }

  return getDeliveryCutoffBlockReason(selection, now);
};

export const getSubscriptionModificationBlockMessage = (
  reason: SubscriptionModificationBlockReason,
) => {
  switch (reason) {
    case "resume_processing":
      return "Un paiement de reprise est en cours. Réessayez une fois la confirmation terminée.";
    case "billing_processing":
      return "Un prélèvement est en cours de traitement. Réessayez dans quelques minutes.";
    case "recovery_processing":
      return "Une tentative de paiement automatique est en cours. Réessayez dans quelques minutes.";
    case "missing_contract":
      return "Contrat d’abonnement Shopify manquant.";
    default:
      return "Modification indisponible pour le moment.";
  }
};

export const getPortalModificationBlockMessage = (
  reason: PortalModificationBlockReason,
  actionKind: PortalModificationActionKind = "modification",
) => {
  if (reason === "cutoff_passed") {
    return getDeliveryCutoffBlockMessage(reason, actionKind);
  }

  return getSubscriptionModificationBlockMessage(reason);
};
