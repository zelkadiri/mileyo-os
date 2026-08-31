export {
  formatMealSelectionStatusLabel,
  formatRecoveryStatusLabel,
} from "../../constants/subscriptionStatus";
export { getSelectedMealsFromJson } from "../../utils/mealSelection";

export const formatAdminDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR");

export const shopifyBillingConfirmMessage =
  "Confirmer le déclenchement d’une prochaine commande Shopify pour cet abonnement ?";

export const recoveryRetryConfirmMessage =
  "DEV uniquement : déclencher le VRAI worker recovery (pas le billing samedi). Un billing attempt Shopify de retry sera créé. Continuer ?";

export const cancelSubscriptionConfirmMessage =
  "Annuler définitivement cet abonnement ? Les prochaines facturations seront arrêtées. Les commandes déjà créées ne seront pas annulées automatiquement.";

/** Default test clock for the next Sunday 00:05 Europe/Paris slot (CEST). */
export const DEV_RECOVERY_RETRY_DEFAULT_NOW = "2026-08-22T22:05:00.000Z";
