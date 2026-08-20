/**
 * Settings meal nutrition CSV import — preview + apply.
 *
 * Preview: format + catalog validation only (no Shopify writes).
 * Apply: revalidates the same CSV server-side, then applyMealNutritionMetafields.
 */

import prisma from "../../db.server";
import { applyMealNutritionMetafields } from "../../services/mealNutritionImport.server";
import { fetchMealCatalogProducts } from "../../services/subscriptionMealCatalog.server";
import {
  MEAL_NUTRITION_CSV_MAX_BYTES,
  enrichMealNutritionImportPreviewWithCatalog,
  indexMealNutritionCatalogVariants,
  previewMealNutritionImportCsv,
  type MealNutritionImportPreview,
} from "../../utils/mealNutritionCsv";
import { getFormString } from "./settings-catalog.server";
import type { SettingsActionData } from "./settings-types";

export const PREVIEW_MEAL_NUTRITION_IMPORT_INTENT =
  "previewMealNutritionImport" as const;

export const APPLY_MEAL_NUTRITION_IMPORT_INTENT =
  "applyMealNutritionImport" as const;

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type BusinessPreviewOk = {
  csvText: string;
  ok: true;
  preview: MealNutritionImportPreview;
};

type BusinessPreviewFail = {
  ok: false;
  result: SettingsActionData;
};

const formatPreviewIssueLines = (preview: MealNutritionImportPreview) =>
  preview.issues.map(
    (issue) =>
      `Ligne ${issue.rowIndex < 0 ? "—" : issue.rowIndex + 1} : ${issue.code} — ${issue.message}`,
  );

const runMealNutritionBusinessPreview = async (
  csvText: string,
  admin: ShopifyAdmin,
  shop: string,
): Promise<BusinessPreviewOk | BusinessPreviewFail> => {
  const formatPreview = previewMealNutritionImportCsv(csvText);

  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  const mealCollectionId = settings?.mealCollectionId?.trim() ?? "";

  if (!mealCollectionId) {
    return {
      ok: false,
      result: {
        errors: [
          "Aucune collection de plats n’est configurée. Impossible de valider les variantId contre le catalogue.",
          ...formatPreviewIssueLines(formatPreview),
        ],
        message: "Import nutrition — catalogue repas manquant.",
        nutritionImportCsvText: csvText,
        nutritionImportPreview: {
          ...formatPreview,
          diffs: [],
          ok: false,
          validEntries: [],
          validRowCount: 0,
          validRows: [],
        },
        ok: false,
      },
    };
  }

  let products;
  try {
    products = await fetchMealCatalogProducts(admin, mealCollectionId);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Erreur inattendue Shopify.";
    return {
      ok: false,
      result: {
        errors: [detail],
        message: "Import nutrition — impossible de charger le catalogue repas.",
        nutritionImportCsvText: csvText,
        nutritionImportPreview: {
          ...formatPreview,
          diffs: [],
          ok: false,
        },
        ok: false,
      },
    };
  }

  const preview = enrichMealNutritionImportPreviewWithCatalog(
    formatPreview,
    indexMealNutritionCatalogVariants(products),
  );

  return {
    csvText,
    ok: true,
    preview,
  };
};

const readNutritionCsvTextFromForm = async (
  formData: FormData,
): Promise<{ error?: string; text?: string }> => {
  const hiddenText = getFormString(formData, "nutritionCsvText");
  if (hiddenText) {
    if (hiddenText.length > MEAL_NUTRITION_CSV_MAX_BYTES) {
      return {
        error: `Fichier trop volumineux (max ${Math.floor(MEAL_NUTRITION_CSV_MAX_BYTES / (1024 * 1024))} Mo).`,
      };
    }
    return { text: hiddenText };
  }

  const file = formData.get("nutritionCsv");
  if (!(file instanceof File)) {
    return { error: "Sélectionnez un fichier CSV nutrition." };
  }
  if (file.size === 0) {
    return { error: "Le fichier CSV est vide." };
  }
  if (file.size > MEAL_NUTRITION_CSV_MAX_BYTES) {
    return {
      error: `Fichier trop volumineux (max ${Math.floor(MEAL_NUTRITION_CSV_MAX_BYTES / (1024 * 1024))} Mo).`,
    };
  }

  return { text: await file.text() };
};

export const buildMealNutritionImportPreviewActionResult = async (
  formData: FormData,
  admin: ShopifyAdmin,
  shop: string,
): Promise<SettingsActionData> => {
  const loaded = await readNutritionCsvTextFromForm(formData);
  if (loaded.error || !loaded.text) {
    return {
      errors: [loaded.error ?? "CSV introuvable."],
      message: "Import nutrition — analyse impossible.",
      ok: false,
    };
  }

  const business = await runMealNutritionBusinessPreview(
    loaded.text,
    admin,
    shop,
  );
  if (!business.ok) {
    return business.result;
  }

  const { preview, csvText } = business;
  const errorMessages = formatPreviewIssueLines(preview);

  return {
    message: preview.ok
      ? `Analyse métier OK — ${preview.validRowCount} modification(s) prête(s).`
      : `Analyse métier — ${preview.validRowCount}/${preview.rowCount} modification(s) valide(s), ${preview.issues.length} problème(s).`,
    nutritionImportCsvText: csvText,
    nutritionImportPreview: preview,
    ok: preview.ok,
    errors: errorMessages.length > 0 ? errorMessages : undefined,
  };
};

export const buildMealNutritionImportApplyActionResult = async (
  formData: FormData,
  admin: ShopifyAdmin,
  shop: string,
): Promise<SettingsActionData> => {
  const loaded = await readNutritionCsvTextFromForm(formData);
  if (loaded.error || !loaded.text) {
    return {
      errors: [
        loaded.error ??
          "CSV manquant pour l’application. Relancez d’abord une analyse.",
      ],
      message: "Import nutrition — application impossible.",
      ok: false,
    };
  }

  const business = await runMealNutritionBusinessPreview(
    loaded.text,
    admin,
    shop,
  );
  if (!business.ok) {
    return {
      ...business.result,
      message: "Import nutrition — validation refusée avant écriture.",
    };
  }

  const { preview, csvText } = business;

  if (preview.validRows.length === 0) {
    return {
      errors: formatPreviewIssueLines(preview).concat([
        "Aucune ligne valide à écrire.",
      ]),
      message: "Import nutrition — validation refusée avant écriture.",
      nutritionImportCsvText: csvText,
      nutritionImportPreview: preview,
      ok: false,
    };
  }

  const writeResult = await applyMealNutritionMetafields(
    admin,
    preview.validRows,
  );

  if (writeResult.errors.length > 0) {
    return {
      errors: writeResult.errors,
      message: "Import nutrition — erreurs Shopify lors de l’écriture.",
      nutritionImportAppliedCount: writeResult.appliedVariantCount,
      nutritionImportCsvText: csvText,
      nutritionImportPreview: preview,
      ok: false,
    };
  }

  return {
    message: `Import terminé — ${writeResult.appliedVariantCount} variante(s) mise(s) à jour.`,
    nutritionImportAppliedCount: writeResult.appliedVariantCount,
    ok: true,
  };
};
