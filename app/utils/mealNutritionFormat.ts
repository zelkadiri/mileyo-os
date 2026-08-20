/**
 * Null-safe meal nutrition display labels (French).
 *
 * Pure data transform — no HTML, CSS, or DOM.
 * Aligns with BuilderMealOption / MealCatalogVariant macro fields.
 */

export type MealNutritionValues = {
  calories: number | null;
  carbs: number | null;
  fat: number | null;
  portionGrams: number | null;
  proteins: number | null;
};

export type MealNutritionLabels = {
  calories: string | null;
  carbs: string | null;
  fat: string | null;
  /** Non-null labels in display order: calories → proteins → carbs → fat → portion. */
  lines: string[];
  portionGrams: string | null;
  proteins: string | null;
};

const AMOUNT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const isDisplayableAmount = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const formatAmount = (value: number): string => AMOUNT_FORMATTER.format(value);

export const formatMealCaloriesLabel = (
  calories: number | null | undefined,
): string | null =>
  isDisplayableAmount(calories) ? `${formatAmount(calories)} kcal` : null;

export const formatMealProteinsLabel = (
  proteins: number | null | undefined,
): string | null =>
  isDisplayableAmount(proteins)
    ? `${formatAmount(proteins)} g protéines`
    : null;

export const formatMealCarbsLabel = (
  carbs: number | null | undefined,
): string | null =>
  isDisplayableAmount(carbs) ? `${formatAmount(carbs)} g glucides` : null;

export const formatMealFatLabel = (
  fat: number | null | undefined,
): string | null =>
  isDisplayableAmount(fat) ? `${formatAmount(fat)} g lipides` : null;

export const formatMealPortionGramsLabel = (
  portionGrams: number | null | undefined,
): string | null =>
  isDisplayableAmount(portionGrams)
    ? `${formatAmount(portionGrams)} g`
    : null;

export const formatMealNutrition = (
  values: MealNutritionValues,
): MealNutritionLabels => {
  const calories = formatMealCaloriesLabel(values.calories);
  const proteins = formatMealProteinsLabel(values.proteins);
  const carbs = formatMealCarbsLabel(values.carbs);
  const fat = formatMealFatLabel(values.fat);
  const portionGrams = formatMealPortionGramsLabel(values.portionGrams);

  return {
    calories,
    proteins,
    carbs,
    fat,
    portionGrams,
    lines: [calories, proteins, carbs, fat, portionGrams].filter(
      (label): label is string => label !== null,
    ),
  };
};

/** Browser runtime — keep in sync with the typed helpers above. */
export const mealNutritionFormatRuntimeScript = `
  var MEAL_NUTRITION_AMOUNT_FORMATTER = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

  function isDisplayableMealNutritionAmount(value) {
    return typeof value === "number" && isFinite(value) && value > 0;
  }

  function formatMealNutritionAmount(value) {
    return MEAL_NUTRITION_AMOUNT_FORMATTER.format(value);
  }

  function formatMealCaloriesLabel(calories) {
    return isDisplayableMealNutritionAmount(calories)
      ? formatMealNutritionAmount(calories) + " kcal"
      : null;
  }

  function formatMealProteinsLabel(proteins) {
    return isDisplayableMealNutritionAmount(proteins)
      ? formatMealNutritionAmount(proteins) + " g protéines"
      : null;
  }

  function formatMealCarbsLabel(carbs) {
    return isDisplayableMealNutritionAmount(carbs)
      ? formatMealNutritionAmount(carbs) + " g glucides"
      : null;
  }

  function formatMealFatLabel(fat) {
    return isDisplayableMealNutritionAmount(fat)
      ? formatMealNutritionAmount(fat) + " g lipides"
      : null;
  }

  function formatMealPortionGramsLabel(portionGrams) {
    return isDisplayableMealNutritionAmount(portionGrams)
      ? formatMealNutritionAmount(portionGrams) + " g"
      : null;
  }

  function formatMealNutrition(values) {
    var calories = formatMealCaloriesLabel(values.calories);
    var proteins = formatMealProteinsLabel(values.proteins);
    var carbs = formatMealCarbsLabel(values.carbs);
    var fat = formatMealFatLabel(values.fat);
    var portionGrams = formatMealPortionGramsLabel(values.portionGrams);
    var lines = [];
    if (calories) lines.push(calories);
    if (proteins) lines.push(proteins);
    if (carbs) lines.push(carbs);
    if (fat) lines.push(fat);
    if (portionGrams) lines.push(portionGrams);
    return {
      calories: calories,
      proteins: proteins,
      carbs: carbs,
      fat: fat,
      portionGrams: portionGrams,
      lines: lines,
    };
  }
`;
