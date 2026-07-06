import {
  getTerminalStatusBadgeClass,
  type PortalSubscriptionState,
} from "../../constants/subscriptionStatus";
import type { PortalMeal } from "./portal-types";
import { escapeHtml, scriptJson } from "../../utils/html";
import {
  getSelectedMealsFromJson,
  quantitiesToTitles as quantitiesToTitlesFromCatalog,
  titlesToQuantities as titlesToQuantitiesFromCatalog,
} from "../../utils/mealSelection";

export { escapeHtml, scriptJson };
export { getSelectedMealsFromJson as getSelectedMeals };

export const formatFrenchDateTime = (isoDate: string) =>
  new Date(isoDate).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

export const formatFrenchDate = (isoDate: string) =>
  new Date(isoDate).toLocaleDateString("fr-FR", { dateStyle: "long" });

export const formatOrderPrice = (price: string | null) => {
  if (!price) {
    return "Prix indisponible";
  }

  const amount = Number.parseFloat(price.replace(",", "."));

  if (!Number.isFinite(amount)) {
    return `${price} €`;
  }

  return `${amount.toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  })} €`;
};

export const formatSubscriptionPrice = (price: string | null) => {
  if (!price) {
    return "Prix indisponible";
  }

  const amount = Number.parseFloat(price.replace(",", "."));

  if (!Number.isFinite(amount)) {
    return `${price} €`;
  }

  return `${amount.toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  })} € / semaine`;
};

export const extractOrderPrice = (rawOrder: unknown): string | null => {
  const order = rawOrder as {
    current_total_price?: string | null;
    total_price?: string | null;
  };

  return order.current_total_price ?? order.total_price ?? null;
};

export const extractOrderStatusUrl = (rawOrder: unknown): string | null => {
  const url = (rawOrder as { order_status_url?: string | null })
    ?.order_status_url;

  if (!url || typeof url !== "string") {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol === "https:") {
      return url;
    }
  } catch {
    return null;
  }

  return null;
};

export const formatFinancialStatus = (status: string | null) => {
  switch (status) {
    case "paid":
      return "Payée";
    case "pending":
      return "En attente de paiement";
    case "refunded":
      return "Remboursée";
    case "partially_refunded":
      return "Partiellement remboursée";
    case "voided":
      return "Annulée";
    case "authorized":
      return "Autorisée";
    default:
      return status ?? "Non renseigné";
  }
};

export const formatFulfillmentStatus = (status: string | null) => {
  switch (status) {
    case "fulfilled":
      return "Expédiée";
    case "partial":
      return "Partiellement expédiée";
    case "unfulfilled":
      return "En préparation";
    case null:
      return null;
    default:
      return status;
  }
};

export const titlesToQuantities = (
  titles: string[],
  meals: PortalMeal[],
): Record<string, number> => titlesToQuantitiesFromCatalog(titles, meals);

export const quantitiesToTitles = (
  quantities: Record<string, number>,
  meals: PortalMeal[],
) => quantitiesToTitlesFromCatalog(quantities, meals);

export const parseMealQuantities = (
  selectedMealsRaw: string,
):
  | { error: string }
  | { quantities: Record<string, number> } => {
  if (!selectedMealsRaw) {
    return { error: "Données de sélection invalides." };
  }

  try {
    const parsed = JSON.parse(selectedMealsRaw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Format de sélection invalide." };
    }

    const quantities = Object.fromEntries(
      Object.entries(parsed).map(([mealId, quantity]) => [
        mealId,
        Number(quantity),
      ]),
    );

    return { quantities };
  } catch {
    return { error: "Format de sélection invalide." };
  }
};

export const validateMealSelection = ({
  meals,
  mealsCount,
  quantities,
}: {
  meals: PortalMeal[];
  mealsCount: number;
  quantities: Record<string, number>;
}): { error: string } | { titles: string[] } => {
  const totalSelected = Object.values(quantities).reduce(
    (total, quantity) => total + (Number.isFinite(quantity) ? quantity : 0),
    0,
  );

  if (totalSelected !== mealsCount) {
    return {
      error: `Tu dois sélectionner exactement ${mealsCount} plats.`,
    };
  }

  const titles = quantitiesToTitles(quantities, meals);

  if (!titles || titles.length !== mealsCount) {
    return { error: "Un ou plusieurs plats sélectionnés ne sont pas valides." };
  }

  return { titles };
};

export const isPortalForecastEligible = (
  portalState: PortalSubscriptionState,
) => portalState === "active";

export const getUpcomingTabEmptyMessage = (
  selections: { portalState: PortalSubscriptionState }[],
  forecastCardCount: number,
) => {
  if (forecastCardCount > 0) {
    return null;
  }

  const hasActiveSubscription = selections.some((selection) =>
    isPortalForecastEligible(selection.portalState),
  );

  if (hasActiveSubscription) {
    return "Aucune prévision disponible pour le moment.";
  }

  return "Aucune box à venir pour le moment. Votre abonnement est en pause.";
};

export { getTerminalStatusBadgeClass };
