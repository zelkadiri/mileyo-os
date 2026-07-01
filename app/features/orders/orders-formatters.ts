import { getSelectedMealsFromJson } from "../../utils/mealSelection";

export { getSelectedMealsFromJson };

export const formatAdminDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("fr-FR");

export const formatCsvDateTime = (value: Date | string) =>
  new Date(value).toISOString();

export const usesFutureSelectionSource = (selectedMealsSource: string | null) =>
  selectedMealsSource === "subscription_future_selection";

export const hasFutureSubscriptionConfig = ({
  boxTitle,
  futureBoxTitle,
  futureMealsCount,
  futureSelectedMeals,
  mealsCount,
}: {
  boxTitle: string | null;
  futureBoxTitle: string | null;
  futureMealsCount: number | null;
  futureSelectedMeals: unknown;
  mealsCount: number | null;
}) => {
  const futureMeals = getSelectedMealsFromJson(futureSelectedMeals);

  return (
    Boolean(futureBoxTitle) &&
    (futureBoxTitle !== boxTitle ||
      futureMealsCount !== mealsCount ||
      futureMeals.length > 0)
  );
};
