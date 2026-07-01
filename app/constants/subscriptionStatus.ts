import { RECOVERY_STATUS } from "./subscriptionPaymentRecovery";

export type PortalSubscriptionState = "active" | "paused" | "resume_processing";

export const formatRecoveryStatusLabel = (status: string) => {
  switch (status) {
    case RECOVERY_STATUS.PROCESSING:
      return "Traitement en cours";
    case RECOVERY_STATUS.RETRY_SCHEDULED:
      return "Nouvelle tentative planifiée";
    case RECOVERY_STATUS.PAYMENT_METHOD_UPDATE_NEEDED:
      return "Mise à jour du paiement requise";
    case RECOVERY_STATUS.EMAIL_SEND_FAILED:
      return "Email de mise à jour en échec";
    case RECOVERY_STATUS.FINAL_FAILED:
      return "Échec final — abonnement en pause";
    case RECOVERY_STATUS.RECOVERED:
      return "Régularisé";
    default:
      return status;
  }
};

export const formatMealSelectionStatusLabel = (status: string) => {
  switch (status) {
    case "active":
      return "Actif";
    case "paused":
      return "En pause";
    default:
      return status;
  }
};
