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

const readTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

/**
 * Shipping label from BoxOrder.rawOrder.shipping_address.
 * Fail-soft: returns null when address fields are missing or unusable.
 */
export const extractShippingAddressLabel = (
  rawOrder: unknown,
): string | null => {
  try {
    const order = asRecord(rawOrder);

    if (!order) {
      return null;
    }

    const shipping = asRecord(order.shipping_address);

    if (!shipping) {
      return null;
    }

    const address1 = readTrimmedString(shipping.address1) ?? "";
    const address2 = readTrimmedString(shipping.address2) ?? "";
    const zip = readTrimmedString(shipping.zip) ?? "";
    const city = readTrimmedString(shipping.city) ?? "";

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

/**
 * Customer phone from BoxOrder.rawOrder (Shopify webhook payload).
 * Priority: shipping_address.phone → order.phone → customer.phone → billing_address.phone.
 * Fail-soft: never throws; returns null when no usable phone is found.
 */
export const extractCustomerPhoneFromRawOrder = (
  rawOrder: unknown,
): string | null => {
  try {
    const order = asRecord(rawOrder);

    if (!order) {
      return null;
    }

    const shippingPhone = readTrimmedString(
      asRecord(order.shipping_address)?.phone,
    );

    if (shippingPhone) {
      return shippingPhone;
    }

    const orderPhone = readTrimmedString(order.phone);

    if (orderPhone) {
      return orderPhone;
    }

    const customerPhone = readTrimmedString(asRecord(order.customer)?.phone);

    if (customerPhone) {
      return customerPhone;
    }

    return readTrimmedString(asRecord(order.billing_address)?.phone);
  } catch {
    return null;
  }
};
