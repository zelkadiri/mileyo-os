export const getSelectedMealsFromJson = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((meal) => String(meal));
};

export type MealCatalogItem = {
  id: string;
  title: string;
};

export const titlesToQuantities = (
  titles: string[],
  meals: MealCatalogItem[],
): Record<string, number> => {
  const titleToId = new Map(meals.map((meal) => [meal.title, meal.id]));
  const quantities: Record<string, number> = {};

  for (const title of titles) {
    const mealId = titleToId.get(title);
    if (!mealId) continue;
    quantities[mealId] = (quantities[mealId] ?? 0) + 1;
  }

  return quantities;
};

export const quantitiesToTitles = (
  quantities: Record<string, number>,
  meals: MealCatalogItem[],
) => {
  const mealById = new Map(meals.map((meal) => [meal.id, meal.title]));
  const titles: string[] = [];

  for (const [mealId, quantity] of Object.entries(quantities)) {
    const title = mealById.get(mealId);
    if (!title) {
      return null;
    }

    for (let index = 0; index < quantity; index += 1) {
      titles.push(title);
    }
  }

  return titles;
};
