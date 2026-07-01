export {
  formatMealSelectionStatusLabel,
  formatRecoveryStatusLabel,
} from "../../constants/subscriptionStatus";
export { getSelectedMealsFromJson } from "../../utils/mealSelection";

export const formatAdminDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR");

export const shopifyBillingConfirmMessage =
  "Confirmer le déclenchement d’une prochaine commande Shopify pour cet abonnement ?";
