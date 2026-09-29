import { DELIVERY_RESCHEDULE_REASON_LABELS } from "../../constants/deliverySchedule";
import { isActiveKitchenBoxOrder } from "../../constants/boxOrder";

const MEAL_OBJECT_TITLE_KEYS = ["title", "name", "mealTitle", "label"] as const;

const extractMealTitle = (item: unknown): string | null => {
  if (typeof item === "string") {
    const trimmed = item.trim();

    return trimmed || null;
  }

  if (item && typeof item === "object" && !Array.isArray(item)) {
    for (const key of MEAL_OBJECT_TITLE_KEYS) {
      const value = (item as Record<string, unknown>)[key];

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return null;
};

export const normalizeSelectedMealsForPreparation = (
  rawSelectedMeals: unknown,
): string[] => {
  try {
    if (rawSelectedMeals == null) {
      return [];
    }

    if (typeof rawSelectedMeals === "string") {
      const trimmed = rawSelectedMeals.trim();

      if (!trimmed) {
        return [];
      }

      if (trimmed.startsWith("[")) {
        try {
          return normalizeSelectedMealsForPreparation(JSON.parse(trimmed));
        } catch {
          return [trimmed];
        }
      }

      return [trimmed];
    }

    if (!Array.isArray(rawSelectedMeals)) {
      return [];
    }

    const meals: string[] = [];

    for (const item of rawSelectedMeals) {
      const title = extractMealTitle(item);

      if (title) {
        meals.push(title);
      }
    }

    return meals;
  } catch {
    return [];
  }
};

export const isSubscriptionPreparationOrder = ({
  isSubscriptionRenewal = false,
  orderType,
}: {
  isSubscriptionRenewal?: boolean;
  orderType: string | null;
}) =>
  isSubscriptionRenewal || Boolean(orderType?.toLowerCase().includes("abonnement"));

/** Kitchen preparation ignores simulated and cancelled BoxOrders. */
export const isKitchenPreparationBoxOrder = (order: {
  cancelledAt?: Date | string | null;
  simulated: boolean;
}) => isActiveKitchenBoxOrder(order);

export const formatSelectedMealsForCsv = (selectedMeals: string[]) =>
  selectedMeals.join(" | ");

export const formatPreparationOrderTypeLabel = (orderType: string | null) => {
  if (orderType?.toLowerCase().includes("abonnement")) {
    return "Abonnement";
  }

  if (orderType?.toLowerCase().includes("unique")) {
    return "Commande unique";
  }

  return orderType ?? "Non renseigné";
};

export const formatPreparationRescheduleReason = (reason: string | null) => {
  if (!reason) {
    return null;
  }

  return (
    DELIVERY_RESCHEDULE_REASON_LABELS[
      reason as keyof typeof DELIVERY_RESCHEDULE_REASON_LABELS
    ] ?? reason
  );
};

/**
 * Shipping label from BoxOrder.rawOrder.shipping_address.
 * Fail-soft: returns null when address fields are missing or unusable.
 */
export const extractShippingAddressLabel = (
  rawOrder: unknown,
): string | null => {
  try {
    if (!rawOrder || typeof rawOrder !== "object" || Array.isArray(rawOrder)) {
      return null;
    }

    const shipping = (rawOrder as { shipping_address?: unknown }).shipping_address;

    if (!shipping || typeof shipping !== "object" || Array.isArray(shipping)) {
      return null;
    }

    const read = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : "";

    const address = shipping as {
      address1?: unknown;
      address2?: unknown;
      city?: unknown;
      zip?: unknown;
    };
    const address1 = read(address.address1);
    const address2 = read(address.address2);
    const zip = read(address.zip);
    const city = read(address.city);

    if (!address1 && !zip && !city) {
      return null;
    }

    const parts: string[] = [];

    if (address1) {
      parts.push(address1);
    }

    if (address2) {
      parts.push(address2);
    }

    const zipCity = [zip, city].filter(Boolean).join(" ");

    if (zipCity) {
      parts.push(zipCity);
    }

    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
};
