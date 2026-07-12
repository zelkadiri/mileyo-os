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

export const formatSelectedMealsForCsv = (selectedMeals: string[]) =>
  selectedMeals.join(" | ");
