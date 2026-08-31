/**
 * Null-safe meal nutrition display labels + Mileyo nutrition table.
 *
 * Pure data transform — no HTML/CSS/DOM in typed helpers.
 * Values are always PER PORTION. Per-100g is display-only.
 */

export type MealNutritionValues = {
  calories: number | null;
  carbs: number | null;
  fat: number | null;
  fiber?: number | null;
  portionGrams: number | null;
  proteins: number | null;
  salt?: number | null;
  saturatedFat?: number | null;
  sugars?: number | null;
};

export type MealNutritionLabels = {
  calories: string | null;
  carbs: string | null;
  fat: string | null;
  fiber: string | null;
  /** Compact badge/list labels (historical order). */
  lines: string[];
  portionGrams: string | null;
  proteins: string | null;
  salt: string | null;
  saturatedFat: string | null;
  sugars: string | null;
};

export type MealNutritionTableRow = {
  key: string;
  label: string;
  per100g: string | null;
  perPortion: string | null;
  secondary: boolean;
  unit: "g" | "kcal";
};

export type MealNutritionTable = {
  hasRows: boolean;
  portionLabel: string | null;
  rows: MealNutritionTableRow[];
};

const AMOUNT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** Historical macros / badge: strictly > 0. */
const isPositiveDisplayable = (
  value: number | null | undefined,
): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** New optional macros: 0 is a real value. */
const isNonNegativeDisplayable = (
  value: number | null | undefined,
): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const formatAmount = (value: number): string => AMOUNT_FORMATTER.format(value);

export const computeMealNutritionPer100g = (
  valuePerPortion: number | null | undefined,
  portionGrams: number | null | undefined,
): number | null => {
  if (
    typeof valuePerPortion !== "number" ||
    !Number.isFinite(valuePerPortion)
  ) {
    return null;
  }
  if (
    typeof portionGrams !== "number" ||
    !Number.isFinite(portionGrams) ||
    portionGrams <= 0
  ) {
    return null;
  }
  return (valuePerPortion / portionGrams) * 100;
};

const formatGramCell = (value: number | null): string | null =>
  value === null ? null : `${formatAmount(value)} g`;

const formatKcalCell = (value: number | null): string | null =>
  value === null ? null : `${formatAmount(value)} kcal`;

export const formatMealCaloriesLabel = (
  calories: number | null | undefined,
): string | null =>
  isPositiveDisplayable(calories) ? `${formatAmount(calories)} kcal` : null;

export const formatMealProteinsLabel = (
  proteins: number | null | undefined,
): string | null =>
  isPositiveDisplayable(proteins)
    ? `${formatAmount(proteins)} g protéines`
    : null;

export const formatMealCarbsLabel = (
  carbs: number | null | undefined,
): string | null =>
  isPositiveDisplayable(carbs) ? `${formatAmount(carbs)} g glucides` : null;

export const formatMealFatLabel = (
  fat: number | null | undefined,
): string | null =>
  isPositiveDisplayable(fat) ? `${formatAmount(fat)} g lipides` : null;

export const formatMealSaturatedFatLabel = (
  saturatedFat: number | null | undefined,
): string | null =>
  isNonNegativeDisplayable(saturatedFat)
    ? `${formatAmount(saturatedFat)} g`
    : null;

export const formatMealSugarsLabel = (
  sugars: number | null | undefined,
): string | null =>
  isNonNegativeDisplayable(sugars) ? `${formatAmount(sugars)} g` : null;

export const formatMealFiberLabel = (
  fiber: number | null | undefined,
): string | null =>
  isNonNegativeDisplayable(fiber) ? `${formatAmount(fiber)} g` : null;

export const formatMealSaltLabel = (
  salt: number | null | undefined,
): string | null =>
  isNonNegativeDisplayable(salt) ? `${formatAmount(salt)} g` : null;

export const formatMealPortionGramsLabel = (
  portionGrams: number | null | undefined,
): string | null =>
  isPositiveDisplayable(portionGrams)
    ? `${formatAmount(portionGrams)} g`
    : null;

export const formatMealNutrition = (
  values: MealNutritionValues,
): MealNutritionLabels => {
  const calories = formatMealCaloriesLabel(values.calories);
  const proteins = formatMealProteinsLabel(values.proteins);
  const carbs = formatMealCarbsLabel(values.carbs);
  const fat = formatMealFatLabel(values.fat);
  const saturatedFat = formatMealSaturatedFatLabel(values.saturatedFat);
  const sugars = formatMealSugarsLabel(values.sugars);
  const fiber = formatMealFiberLabel(values.fiber);
  const salt = formatMealSaltLabel(values.salt);
  const portionGrams = formatMealPortionGramsLabel(values.portionGrams);

  return {
    calories,
    proteins,
    carbs,
    fat,
    saturatedFat,
    sugars,
    fiber,
    salt,
    portionGrams,
    lines: [calories, proteins, carbs, fat, portionGrams].filter(
      (label): label is string => label !== null,
    ),
  };
};

type TableRowSpec = {
  key: MealNutritionTableRow["key"];
  label: string;
  secondary: boolean;
  unit: "g" | "kcal";
  /** Historical macros omit 0; optional macros keep 0. */
  allowZero: boolean;
  value: number | null | undefined;
};

const toTableAmount = (
  value: number | null | undefined,
  allowZero: boolean,
): number | null => {
  if (allowZero) {
    return isNonNegativeDisplayable(value) ? value : null;
  }
  return isPositiveDisplayable(value) ? value : null;
};

/**
 * Display-only nutrition table rows.
 * Order: fat → saturatedFat → carbs → sugars → proteins → fiber → salt → calories.
 */
export const formatMealNutritionTable = (
  values: MealNutritionValues,
): MealNutritionTable => {
  const portionGrams = values.portionGrams;
  const specs: TableRowSpec[] = [
    {
      key: "fat",
      label: "Lipides",
      secondary: false,
      unit: "g",
      allowZero: false,
      value: values.fat,
    },
    {
      key: "saturatedFat",
      label: "dont graisses saturées",
      secondary: true,
      unit: "g",
      allowZero: true,
      value: values.saturatedFat,
    },
    {
      key: "carbs",
      label: "Glucides",
      secondary: false,
      unit: "g",
      allowZero: false,
      value: values.carbs,
    },
    {
      key: "sugars",
      label: "dont sucres",
      secondary: true,
      unit: "g",
      allowZero: true,
      value: values.sugars,
    },
    {
      key: "proteins",
      label: "Protéines",
      secondary: false,
      unit: "g",
      allowZero: false,
      value: values.proteins,
    },
    {
      key: "fiber",
      label: "Fibres",
      secondary: false,
      unit: "g",
      allowZero: true,
      value: values.fiber,
    },
    {
      key: "salt",
      label: "Sel",
      secondary: false,
      unit: "g",
      allowZero: true,
      value: values.salt,
    },
    {
      key: "calories",
      label: "Énergie",
      secondary: false,
      unit: "kcal",
      allowZero: false,
      value: values.calories,
    },
  ];

  const rows: MealNutritionTableRow[] = [];

  for (const spec of specs) {
    const perPortionValue = toTableAmount(spec.value, spec.allowZero);
    if (perPortionValue === null) {
      continue;
    }

    const per100gValue = computeMealNutritionPer100g(
      perPortionValue,
      portionGrams,
    );
    const formatCell = spec.unit === "kcal" ? formatKcalCell : formatGramCell;

    rows.push({
      key: spec.key,
      label: spec.label,
      secondary: spec.secondary,
      unit: spec.unit,
      perPortion: formatCell(perPortionValue),
      per100g: formatCell(per100gValue),
    });
  }

  return {
    hasRows: rows.length > 0,
    portionLabel: formatMealPortionGramsLabel(portionGrams),
    rows,
  };
};

/** Browser runtime — keep in sync with the typed helpers above. */
export const mealNutritionFormatRuntimeScript = `
  var MEAL_NUTRITION_AMOUNT_FORMATTER = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

  function isPositiveMealNutritionAmount(value) {
    return typeof value === "number" && isFinite(value) && value > 0;
  }

  function isNonNegativeMealNutritionAmount(value) {
    return typeof value === "number" && isFinite(value) && value >= 0;
  }

  function formatMealNutritionAmount(value) {
    return MEAL_NUTRITION_AMOUNT_FORMATTER.format(value);
  }

  function computeMealNutritionPer100g(valuePerPortion, portionGrams) {
    if (typeof valuePerPortion !== "number" || !isFinite(valuePerPortion)) {
      return null;
    }
    if (
      typeof portionGrams !== "number" ||
      !isFinite(portionGrams) ||
      portionGrams <= 0
    ) {
      return null;
    }
    return (valuePerPortion / portionGrams) * 100;
  }

  function formatMealCaloriesLabel(calories) {
    return isPositiveMealNutritionAmount(calories)
      ? formatMealNutritionAmount(calories) + " kcal"
      : null;
  }

  function formatMealProteinsLabel(proteins) {
    return isPositiveMealNutritionAmount(proteins)
      ? formatMealNutritionAmount(proteins) + " g protéines"
      : null;
  }

  function formatMealCarbsLabel(carbs) {
    return isPositiveMealNutritionAmount(carbs)
      ? formatMealNutritionAmount(carbs) + " g glucides"
      : null;
  }

  function formatMealFatLabel(fat) {
    return isPositiveMealNutritionAmount(fat)
      ? formatMealNutritionAmount(fat) + " g lipides"
      : null;
  }

  function formatMealSaturatedFatLabel(saturatedFat) {
    return isNonNegativeMealNutritionAmount(saturatedFat)
      ? formatMealNutritionAmount(saturatedFat) + " g"
      : null;
  }

  function formatMealSugarsLabel(sugars) {
    return isNonNegativeMealNutritionAmount(sugars)
      ? formatMealNutritionAmount(sugars) + " g"
      : null;
  }

  function formatMealFiberLabel(fiber) {
    return isNonNegativeMealNutritionAmount(fiber)
      ? formatMealNutritionAmount(fiber) + " g"
      : null;
  }

  function formatMealSaltLabel(salt) {
    return isNonNegativeMealNutritionAmount(salt)
      ? formatMealNutritionAmount(salt) + " g"
      : null;
  }

  function formatMealPortionGramsLabel(portionGrams) {
    return isPositiveMealNutritionAmount(portionGrams)
      ? formatMealNutritionAmount(portionGrams) + " g"
      : null;
  }

  function formatMealNutrition(values) {
    var calories = formatMealCaloriesLabel(values.calories);
    var proteins = formatMealProteinsLabel(values.proteins);
    var carbs = formatMealCarbsLabel(values.carbs);
    var fat = formatMealFatLabel(values.fat);
    var saturatedFat = formatMealSaturatedFatLabel(values.saturatedFat);
    var sugars = formatMealSugarsLabel(values.sugars);
    var fiber = formatMealFiberLabel(values.fiber);
    var salt = formatMealSaltLabel(values.salt);
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
      saturatedFat: saturatedFat,
      sugars: sugars,
      fiber: fiber,
      salt: salt,
      portionGrams: portionGrams,
      lines: lines,
    };
  }

  function formatMealNutritionGramCell(value) {
    return value === null ? null : formatMealNutritionAmount(value) + " g";
  }

  function formatMealNutritionKcalCell(value) {
    return value === null ? null : formatMealNutritionAmount(value) + " kcal";
  }

  function toMealNutritionTableAmount(value, allowZero) {
    if (allowZero) {
      return isNonNegativeMealNutritionAmount(value) ? value : null;
    }
    return isPositiveMealNutritionAmount(value) ? value : null;
  }

  function formatMealNutritionTable(values) {
    var portionGrams = values.portionGrams;
    var specs = [
      { key: "fat", label: "Lipides", secondary: false, unit: "g", allowZero: false, value: values.fat },
      { key: "saturatedFat", label: "dont graisses saturées", secondary: true, unit: "g", allowZero: true, value: values.saturatedFat },
      { key: "carbs", label: "Glucides", secondary: false, unit: "g", allowZero: false, value: values.carbs },
      { key: "sugars", label: "dont sucres", secondary: true, unit: "g", allowZero: true, value: values.sugars },
      { key: "proteins", label: "Protéines", secondary: false, unit: "g", allowZero: false, value: values.proteins },
      { key: "fiber", label: "Fibres", secondary: false, unit: "g", allowZero: true, value: values.fiber },
      { key: "salt", label: "Sel", secondary: false, unit: "g", allowZero: true, value: values.salt },
      { key: "calories", label: "Énergie", secondary: false, unit: "kcal", allowZero: false, value: values.calories },
    ];
    var rows = [];
    for (var i = 0; i < specs.length; i += 1) {
      var spec = specs[i];
      var perPortionValue = toMealNutritionTableAmount(spec.value, spec.allowZero);
      if (perPortionValue === null) continue;
      var per100gValue = computeMealNutritionPer100g(perPortionValue, portionGrams);
      var formatCell =
        spec.unit === "kcal"
          ? formatMealNutritionKcalCell
          : formatMealNutritionGramCell;
      rows.push({
        key: spec.key,
        label: spec.label,
        secondary: spec.secondary,
        unit: spec.unit,
        perPortion: formatCell(perPortionValue),
        per100g: formatCell(per100gValue),
      });
    }
    return {
      hasRows: rows.length > 0,
      portionLabel: formatMealPortionGramsLabel(portionGrams),
      rows: rows,
    };
  }

  function appendMealNutritionTable(container, values) {
    if (!container) return false;
    var table = formatMealNutritionTable(values);
    if (!table.hasRows) return false;

    var root = document.createElement("div");
    root.className = "meal-nutrition-table";

    var head = document.createElement("div");
    head.className = "meal-nutrition-table-head";
    var title = document.createElement("p");
    title.className = "meal-nutrition-table-title";
    title.textContent = "Valeurs nutritionnelles";
    head.appendChild(title);
    if (table.portionLabel) {
      var portion = document.createElement("p");
      portion.className = "meal-nutrition-table-portion";
      portion.textContent = "Portion : " + table.portionLabel;
      head.appendChild(portion);
    }
    root.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "meal-nutrition-table-grid";
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", "Valeurs nutritionnelles");

    var header = document.createElement("div");
    header.className = "meal-nutrition-table-row meal-nutrition-table-row--header";
    header.setAttribute("role", "row");
    header.innerHTML =
      '<span class="meal-nutrition-table-cell meal-nutrition-table-cell--label" role="columnheader"></span>' +
      '<span class="meal-nutrition-table-cell meal-nutrition-table-cell--value" role="columnheader">Pour 100 g</span>' +
      '<span class="meal-nutrition-table-cell meal-nutrition-table-cell--value" role="columnheader">Votre portion</span>';
    grid.appendChild(header);

    for (var r = 0; r < table.rows.length; r += 1) {
      var rowData = table.rows[r];
      var row = document.createElement("div");
      row.className =
        "meal-nutrition-table-row" +
        (rowData.secondary ? " meal-nutrition-table-row--secondary" : "") +
        (rowData.key === "calories" ? " meal-nutrition-table-row--energy" : "");
      row.setAttribute("role", "row");

      var label = document.createElement("span");
      label.className = "meal-nutrition-table-cell meal-nutrition-table-cell--label";
      label.setAttribute("role", "rowheader");
      label.textContent = rowData.label;

      var per100 = document.createElement("span");
      per100.className = "meal-nutrition-table-cell meal-nutrition-table-cell--value";
      per100.setAttribute("role", "cell");
      per100.textContent = rowData.per100g || "—";

      var perPortion = document.createElement("span");
      perPortion.className =
        "meal-nutrition-table-cell meal-nutrition-table-cell--value meal-nutrition-table-cell--portion";
      perPortion.setAttribute("role", "cell");
      perPortion.textContent = rowData.perPortion || "—";

      row.appendChild(label);
      row.appendChild(per100);
      row.appendChild(perPortion);
      grid.appendChild(row);
    }

    root.appendChild(grid);
    container.appendChild(root);
    return true;
  }
`;
