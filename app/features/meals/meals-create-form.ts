/**
 * Pure form parsing / validation for « Créer un plat ».
 * No Shopify I/O — safe for client-side mirrors and unit tests.
 */

import {
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import {
  validateMealNutritionImportRows,
  type MealNutritionImportRow,
} from "../../utils/mealNutritionImport";

export const CREATE_MEAL_INTENT = "createMeal" as const;

/** Optional write_files consent CTA — client-safe constant (must not live in .server). */
export const REQUEST_MEAL_IMAGE_SCOPES_INTENT =
  "requestMealImageScopes" as const;

/**
 * Image remains gated until write_files is granted (optional scope).
 * Ingredients / allergènes / badges are confirmed on DEV and written.
 */
export const MEAL_CREATE_IMAGE_SCOPE_MESSAGE =
  "L’ajout de photo nécessite une autorisation boutique supplémentaire. Cliquez sur « Autoriser l’ajout de photos » ci-dessous. Sans cette autorisation, le champ photo n’est pas proposé.";

export type MealCreateBlockedProductField = "image";

export const MEAL_CREATE_BLOCKED_FIELD_MESSAGES: Record<
  MealCreateBlockedProductField,
  string
> = {
  image: MEAL_CREATE_IMAGE_SCOPE_MESSAGE,
};

export type MealCreateNutritionFields = {
  calories: string;
  proteins: string;
  carbs: string;
  fat: string;
  portionGrams: string;
  saturatedFat: string;
  sugars: string;
  fiber: string;
  salt: string;
};

export type MealCreateFormValues = {
  title: string;
  description: string;
  ingredients: string;
  allergenes: string;
  badge1: string;
  badge2: string;
  badge3: string;
  /**
   * Stable client/server attempt id — written on the Shopify product as
   * mileyo.create_attempt_id. Required to resume without adopting a foreign product.
   */
  createAttemptId: string;
  /** Present when resuming a previous partial create (product owned by this attempt). */
  resumeProductId: string;
  nutrition: Record<SubscriptionObjective, MealCreateNutritionFields>;
};

/** UUID v4-ish generator (Node + browser). */
export const generateMealCreateAttemptId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `meal-create-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

export const isValidMealCreateAttemptId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 80) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) || /^[0-9a-f-]{36}$/i.test(trimmed);
};

export type MealCreateFieldError = {
  field: string;
  message: string;
};

export type MealCreateFormValidationResult = {
  errors: MealCreateFieldError[];
  ok: boolean;
  values: MealCreateFormValues;
  nutritionRows: Omit<MealNutritionImportRow, "variantId">[];
};

const emptyNutrition = (): MealCreateNutritionFields => ({
  calories: "",
  proteins: "",
  carbs: "",
  fat: "",
  portionGrams: "",
  saturatedFat: "",
  sugars: "",
  fiber: "",
  salt: "",
});

export const createEmptyMealCreateFormValues = (
  createAttemptId: string = generateMealCreateAttemptId(),
): MealCreateFormValues => ({
  title: "",
  description: "",
  ingredients: "",
  allergenes: "",
  badge1: "",
  badge2: "",
  badge3: "",
  createAttemptId,
  resumeProductId: "",
  nutrition: {
    weight_loss: emptyNutrition(),
    balanced: emptyNutrition(),
    bulk: emptyNutrition(),
  },
});

const getFormString = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const nutritionFieldName = (
  objective: SubscriptionObjective,
  key: keyof MealCreateNutritionFields,
): string => `nutrition_${objective}_${key}`;

export const parseMealCreateFormData = (
  formData: FormData,
): MealCreateFormValues => {
  const nutrition = {} as Record<SubscriptionObjective, MealCreateNutritionFields>;

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    nutrition[objective] = {
      calories: getFormString(formData, nutritionFieldName(objective, "calories")),
      proteins: getFormString(formData, nutritionFieldName(objective, "proteins")),
      carbs: getFormString(formData, nutritionFieldName(objective, "carbs")),
      fat: getFormString(formData, nutritionFieldName(objective, "fat")),
      portionGrams: getFormString(
        formData,
        nutritionFieldName(objective, "portionGrams"),
      ),
      saturatedFat: getFormString(
        formData,
        nutritionFieldName(objective, "saturatedFat"),
      ),
      sugars: getFormString(formData, nutritionFieldName(objective, "sugars")),
      fiber: getFormString(formData, nutritionFieldName(objective, "fiber")),
      salt: getFormString(formData, nutritionFieldName(objective, "salt")),
    };
  }

  const rawAttemptId = getFormString(formData, "createAttemptId").trim();
  return {
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    ingredients: getFormString(formData, "ingredients"),
    allergenes: getFormString(formData, "allergenes"),
    badge1: getFormString(formData, "badge1"),
    badge2: getFormString(formData, "badge2"),
    badge3: getFormString(formData, "badge3"),
    createAttemptId: isValidMealCreateAttemptId(rawAttemptId)
      ? rawAttemptId
      : generateMealCreateAttemptId(),
    resumeProductId: getFormString(formData, "resumeProductId").trim(),
    nutrition,
  };
};

const parseRequiredPositiveInteger = (
  raw: string,
): number | null => {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseRequiredPositiveDecimal = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalNonNegativeDecimal = (
  raw: string,
): number | null | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return undefined;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
};

const objectiveLabel = (objective: SubscriptionObjective): string => {
  switch (objective) {
    case "weight_loss":
      return "Perte de poids";
    case "balanced":
      return "Équilibré";
    case "bulk":
      return "Prise de masse";
    default:
      return objective;
  }
};

/**
 * Validates general + nutrition fields.
 * Reuses validateMealNutritionImportRows for nutrition semantics
 * (placeholder variantIds — replaced after productSet).
 */
export const validateMealCreateFormValues = (
  values: MealCreateFormValues,
): MealCreateFormValidationResult => {
  const errors: MealCreateFieldError[] = [];
  const title = values.title.trim();

  if (!title) {
    errors.push({
      field: "title",
      message: "Le nom du plat est obligatoire.",
    });
  }

  if (!isValidMealCreateAttemptId(values.createAttemptId)) {
    errors.push({
      field: "createAttemptId",
      message: "Identifiant de création invalide. Rechargez la page.",
    });
  }

  const nutritionRows: Omit<MealNutritionImportRow, "variantId">[] = [];
  const importRows: MealNutritionImportRow[] = [];

  for (const objective of SUBSCRIPTION_OBJECTIVES) {
    const fields = values.nutrition[objective];
    const label = objectiveLabel(objective);
    const calories = parseRequiredPositiveInteger(fields.calories);
    const proteins = parseRequiredPositiveDecimal(fields.proteins);
    const carbs = parseRequiredPositiveDecimal(fields.carbs);
    const fat = parseRequiredPositiveDecimal(fields.fat);
    const portionGrams = parseRequiredPositiveInteger(fields.portionGrams);
    const saturatedFat = parseOptionalNonNegativeDecimal(fields.saturatedFat);
    const sugars = parseOptionalNonNegativeDecimal(fields.sugars);
    const fiber = parseOptionalNonNegativeDecimal(fields.fiber);
    const salt = parseOptionalNonNegativeDecimal(fields.salt);

    if (calories === null) {
      errors.push({
        field: nutritionFieldName(objective, "calories"),
        message: `${label} : calories doit être un entier > 0.`,
      });
    }
    if (proteins === null) {
      errors.push({
        field: nutritionFieldName(objective, "proteins"),
        message: `${label} : protéines doit être un nombre > 0.`,
      });
    }
    if (carbs === null) {
      errors.push({
        field: nutritionFieldName(objective, "carbs"),
        message: `${label} : glucides doit être un nombre > 0.`,
      });
    }
    if (fat === null) {
      errors.push({
        field: nutritionFieldName(objective, "fat"),
        message: `${label} : lipides doit être un nombre > 0.`,
      });
    }
    if (portionGrams === null) {
      errors.push({
        field: nutritionFieldName(objective, "portionGrams"),
        message: `${label} : poids de portion doit être un entier > 0.`,
      });
    }
    if (saturatedFat === undefined) {
      errors.push({
        field: nutritionFieldName(objective, "saturatedFat"),
        message: `${label} : graisses saturées doit être un nombre ≥ 0 ou vide.`,
      });
    }
    if (sugars === undefined) {
      errors.push({
        field: nutritionFieldName(objective, "sugars"),
        message: `${label} : sucres doit être un nombre ≥ 0 ou vide.`,
      });
    }
    if (fiber === undefined) {
      errors.push({
        field: nutritionFieldName(objective, "fiber"),
        message: `${label} : fibres doit être un nombre ≥ 0 ou vide.`,
      });
    }
    if (salt === undefined) {
      errors.push({
        field: nutritionFieldName(objective, "salt"),
        message: `${label} : sel doit être un nombre ≥ 0 ou vide.`,
      });
    }

    if (
      calories !== null &&
      proteins !== null &&
      carbs !== null &&
      fat !== null &&
      portionGrams !== null &&
      saturatedFat !== undefined &&
      sugars !== undefined &&
      fiber !== undefined &&
      salt !== undefined
    ) {
      const row: Omit<MealNutritionImportRow, "variantId"> = {
        productTitle: title,
        objective,
        calories,
        proteins,
        carbs,
        fat,
        saturatedFat,
        sugars,
        fiber,
        salt,
        portionGrams,
      };
      nutritionRows.push(row);
      importRows.push({
        ...row,
        variantId: `pending:${objective}`,
      });
    }
  }

  if (importRows.length === SUBSCRIPTION_OBJECTIVES.length) {
    const shared = validateMealNutritionImportRows(importRows);
    if (!shared.ok) {
      for (const issue of shared.issues) {
        errors.push({
          field: `nutrition_row_${issue.rowIndex}`,
          message: issue.message,
        });
      }
    }
  }

  return {
    errors,
    ok: errors.length === 0,
    values: {
      ...values,
      title,
      description: values.description.trim(),
      ingredients: values.ingredients.trim(),
      allergenes: values.allergenes.trim(),
      badge1: values.badge1.trim(),
      badge2: values.badge2.trim(),
      badge3: values.badge3.trim(),
    },
    nutritionRows,
  };
};

/** True when an image file is present but write_files is not granted. */
export const mealCreateHasBlockedImageInput = (
  imageFile: File | null | undefined,
  hasWriteFiles: boolean,
): boolean => Boolean(imageFile && imageFile.size > 0 && !hasWriteFiles);

/** @deprecated Prefer mealCreateHasBlockedImageInput — product text fields are writable. */
export const mealCreateHasBlockedProductInput = (
  values: MealCreateFormValues,
  imageFile?: File | null,
  hasWriteFiles = false,
): boolean => mealCreateHasBlockedImageInput(imageFile, hasWriteFiles);

export { nutritionFieldName, objectiveLabel };
