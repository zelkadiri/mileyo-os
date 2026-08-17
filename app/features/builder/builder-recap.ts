/**
 * Pure recap helpers — derived from existing builder state, not a second store.
 */

export type RecapMealLine = {
  quantity: number;
  title: string;
};

export const formatRecapMealLabel = (
  title: string,
  quantity: number,
): string => (quantity > 1 ? `${title} ×${quantity}` : title);

export const getRecapMealLines = (
  meals: readonly {
    objective?: string;
    title: string;
    variantId: string;
  }[],
  selectedMeals: Readonly<Record<string, number>>,
  objective?: string | null,
): RecapMealLine[] => {
  const lines: RecapMealLine[] = [];

  for (const meal of meals) {
    if (objective && meal.objective && meal.objective !== objective) {
      continue;
    }
    const quantity = selectedMeals[meal.variantId] ?? 0;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      continue;
    }
    lines.push({ quantity, title: meal.title });
  }

  return lines;
};

export const findObjectiveLabel = (
  objectives: readonly { label: string; value: string }[],
  value: string | null | undefined,
): string => {
  if (!value) {
    return "";
  }
  return (
    objectives.find((option) => option.value === value)?.label ?? ""
  );
};

export const buildCheckoutLeadKey = ({
  boxVariantId,
  email,
  mealCount,
  objective,
  scheduledDeliveryDate,
}: {
  boxVariantId: string | null | undefined;
  email: string | null | undefined;
  mealCount: number | string | null | undefined;
  objective: string | null | undefined;
  scheduledDeliveryDate: string | null | undefined;
}): string => {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (
    !trimmedEmail ||
    !objective ||
    !boxVariantId ||
    mealCount == null ||
    mealCount === "" ||
    !scheduledDeliveryDate
  ) {
    return "";
  }

  return [
    trimmedEmail,
    objective,
    boxVariantId,
    String(mealCount),
    scheduledDeliveryDate,
  ].join("|");
};
