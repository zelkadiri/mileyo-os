/**
 * Settings meal nutrition CSV export — fetch catalog + action result.
 *
 * Returns CSV text for an embedded-safe Blob download (no document navigation).
 */

import prisma from "../../db.server";
import { fetchMealCatalogProducts } from "../../services/subscriptionMealCatalog.server";
import {
  buildMealNutritionExportCsvContent,
  MEAL_NUTRITION_EXPORT_FILENAME,
} from "../../utils/mealNutritionExport";
import type { SettingsActionData } from "./settings-types";

export const EXPORT_MEAL_NUTRITION_TEMPLATE_INTENT =
  "exportMealNutritionTemplate" as const;

export const MEAL_NUTRITION_EXPORT_MISSING_COLLECTION_MESSAGE =
  "Aucune collection de plats n’est configurée. Sélectionnez une collection de plats dans Réglages avant d’exporter le template nutrition.";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: { id: string } },
  ) => Promise<Response>;
};

export const buildMealNutritionExportActionResult = async (
  admin: ShopifyAdmin,
  shop: string,
): Promise<SettingsActionData> => {
  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  const mealCollectionId = settings?.mealCollectionId?.trim() ?? "";

  if (!mealCollectionId) {
    return {
      errors: [MEAL_NUTRITION_EXPORT_MISSING_COLLECTION_MESSAGE],
      message: "Export nutrition impossible.",
      ok: false,
    };
  }

  try {
    const products = await fetchMealCatalogProducts(admin, mealCollectionId);
    const csv = buildMealNutritionExportCsvContent(products);

    return {
      csv,
      downloadToken: `${Date.now()}-${products.length}`,
      filename: MEAL_NUTRITION_EXPORT_FILENAME,
      message: "Template nutrition prêt au téléchargement.",
      ok: true,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Erreur inattendue Shopify.";

    return {
      errors: [detail],
      message: "Impossible d’exporter le template nutrition.",
      ok: false,
    };
  }
};
