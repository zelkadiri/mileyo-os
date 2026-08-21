import prisma from "../../db.server";
import { isAllowedSupportChatUrl } from "../../utils/merchantSupport.server";
import {
  parseBoxMealCountFormEntries,
  saveBoxMealCountMetafields,
} from "./settings-box-meal-counts.server";
import {
  getCollectionProducts,
  getFormString,
  getSelectedCollection,
} from "./settings-catalog.server";
import {
  CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT,
  CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT,
  SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT,
  createMealCountMetafieldDefinition,
  createSubscriptionPriceMetafieldDefinition,
  createVariantMealCountMetafieldDefinition,
  createVariantObjectiveMetafieldDefinition,
  setupMealV2MetafieldDefinitions,
} from "./settings-metafields.server";
import {
  SETUP_V2_BOX_CATALOG_INTENT,
  formatV2BoxCatalogSetupMessage,
  setupV2BoxCatalog,
} from "./settings-box-catalog-v2.server";
import {
  SETUP_V2_MEAL_CATALOG_INTENT,
  formatV2MealCatalogSetupMessage,
  setupV2MealCatalog,
} from "./settings-meal-catalog-v2.server";
import {
  EXPORT_MEAL_NUTRITION_TEMPLATE_INTENT,
  buildMealNutritionExportActionResult,
} from "./settings-meal-nutrition-export.server";
import {
  APPLY_MEAL_NUTRITION_IMPORT_INTENT,
  PREVIEW_MEAL_NUTRITION_IMPORT_INTENT,
  buildMealNutritionImportApplyActionResult,
  buildMealNutritionImportPreviewActionResult,
} from "./settings-meal-nutrition-import.server";
import { createOrUpdateWeeklySellingPlans } from "./settings-selling-plans.server";
import {
  SETUP_V2_WEEKLY_SELLING_PLANS_INTENT,
  formatV2SellingPlanSetupMessage,
  setupV2WeeklySellingPlans,
} from "./settings-selling-plans-v2.server";
import type { SettingsActionData } from "./settings-types";

export const handleSettingsAction = async ({
  admin,
  request,
  shop,
}: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  request: Request;
  shop: string;
}): Promise<SettingsActionData> => {
  const formData = await request.formData();
  const intent = getFormString(formData, "intent");

  if (intent === "createSubscriptionPriceMetafieldDefinition") {
    const errors = await createSubscriptionPriceMetafieldDefinition(admin);

    return {
      errors,
      message:
        errors.length === 0
          ? "Définition de metafield Prix abonnement créée."
          : "La définition existe peut-être déjà ou Shopify a retourné un avertissement.",
      ok: errors.length === 0,
    };
  }

  if (intent === "createMealCountMetafieldDefinition") {
    const errors = await createMealCountMetafieldDefinition(admin);

    return {
      errors,
      message:
        errors.length === 0
          ? "Définition de metafield Nombre de repas créée."
          : "La définition existe peut-être déjà ou Shopify a retourné un avertissement.",
      ok: errors.length === 0,
    };
  }

  if (intent === CREATE_VARIANT_OBJECTIVE_METAFIELD_DEFINITION_INTENT) {
    const result = await createVariantObjectiveMetafieldDefinition(admin);

    return {
      errors: result.errors,
      message:
        result.errors.length === 0
          ? result.alreadyExisted
            ? "Définition mileyo.objective (variante) déjà présente."
            : "Définition de metafield Objectif (variante) créée."
          : "Impossible de créer la définition Objectif (variante).",
      ok: result.errors.length === 0,
    };
  }

  if (intent === CREATE_VARIANT_MEAL_COUNT_METAFIELD_DEFINITION_INTENT) {
    const result = await createVariantMealCountMetafieldDefinition(admin);

    return {
      errors: result.errors,
      message:
        result.errors.length === 0
          ? result.alreadyExisted
            ? "Définition mileyo.meal_count (variante) déjà présente."
            : "Définition de metafield Nombre de repas (variante) créée."
          : "Impossible de créer la définition Nombre de repas (variante).",
      ok: result.errors.length === 0,
    };
  }

  if (intent === "saveBoxMealCounts") {
    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    if (!settings?.boxCollectionId) {
      return {
        errors: ["Sélectionnez une collection de box avant d’enregistrer les tailles."],
        ok: false,
      };
    }

    const boxProducts = await getCollectionProducts(admin, settings.boxCollectionId);
    const { entries, errors: validationErrors } = parseBoxMealCountFormEntries(
      formData,
      boxProducts,
    );

    if (validationErrors.length > 0) {
      return {
        errors: validationErrors,
        ok: false,
      };
    }

    if (entries.length === 0) {
      return {
        errors: ["Aucune taille de box valide à enregistrer."],
        ok: false,
      };
    }

    const shopifyErrors = await saveBoxMealCountMetafields(admin, entries);

    return {
      errors: shopifyErrors,
      message:
        shopifyErrors.length === 0
          ? `${entries.length} taille(s) de box enregistrée(s).`
          : "Certaines tailles de box n’ont pas pu être enregistrées.",
      ok: shopifyErrors.length === 0,
    };
  }

  if (intent === "setupWeeklySellingPlans") {
    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    if (!settings?.boxCollectionId) {
      return {
        errors: [
          "Sélectionnez une collection de box avant de créer les abonnements.",
        ],
        ok: false,
      };
    }

    const result = await createOrUpdateWeeklySellingPlans(
      admin,
      settings.boxCollectionId,
    );

    return {
      errors: result.errors,
      message: `${result.processedCount} produit(s) box traité(s).`,
      ok: result.errors.length === 0,
    };
  }

  if (intent === SETUP_V2_BOX_CATALOG_INTENT) {
    const result = await setupV2BoxCatalog(admin);

    return {
      errors: result.errors,
      message: formatV2BoxCatalogSetupMessage(result),
      ok: result.ok,
    };
  }

  if (intent === SETUP_MEAL_V2_METAFIELD_DEFINITIONS_INTENT) {
    try {
      const result = await setupMealV2MetafieldDefinitions(admin);

      return {
        errors: result.errors,
        message: result.message,
        ok: result.ok,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue Shopify.";

      return {
        errors: [message],
        message: "Impossible de créer / vérifier les définitions Repas V2.",
        ok: false,
      };
    }
  }

  if (intent === SETUP_V2_MEAL_CATALOG_INTENT) {
    try {
      const settings = await prisma.appSettings.findUnique({ where: { shop } });
      const result = await setupV2MealCatalog(admin, settings?.mealCollectionId);

      return {
        errors: result.errors,
        message: formatV2MealCatalogSetupMessage(result),
        ok: result.ok,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue Shopify.";

      return {
        errors: [message],
        message: "Impossible de préparer le catalogue Repas V2.",
        ok: false,
      };
    }
  }

  if (intent === EXPORT_MEAL_NUTRITION_TEMPLATE_INTENT) {
    return buildMealNutritionExportActionResult(admin, shop);
  }

  if (intent === PREVIEW_MEAL_NUTRITION_IMPORT_INTENT) {
    return buildMealNutritionImportPreviewActionResult(formData, admin, shop);
  }

  if (intent === APPLY_MEAL_NUTRITION_IMPORT_INTENT) {
    return buildMealNutritionImportApplyActionResult(formData, admin, shop);
  }

  if (intent === SETUP_V2_WEEKLY_SELLING_PLANS_INTENT) {
    try {
      const result = await setupV2WeeklySellingPlans(admin);

      return {
        errors: result.errors,
        message: formatV2SellingPlanSetupMessage(result),
        ok: result.errors.length === 0,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue Shopify.";

      return {
        errors: [message],
        message: "Impossible de configurer les abonnements Box V2.",
        ok: false,
      };
    }
  }

  if (intent === "saveSupportChatUrl") {
    const rawUrl = getFormString(formData, "supportChatUrl").trim();

    if (rawUrl && !isAllowedSupportChatUrl(rawUrl)) {
      return {
        errors: [
          "URL invalide. Utilisez https://, http:// ou mailto: uniquement.",
        ],
        message: "Impossible d’enregistrer l’URL du chat.",
        ok: false,
      };
    }

    const supportChatUrl = rawUrl || null;

    await prisma.appSettings.upsert({
      create: {
        shop,
        supportChatUrl,
      },
      update: { supportChatUrl },
      where: { shop },
    });

    return {
      message: supportChatUrl
        ? "URL du chat diététicien enregistrée."
        : "URL du chat diététicien effacée.",
      ok: true,
    };
  }

  const boxCollectionId = getFormString(formData, "boxCollectionId");
  const mealCollectionId = getFormString(formData, "mealCollectionId");
  const [boxCollection, mealCollection] = await Promise.all([
    getSelectedCollection(admin, boxCollectionId),
    getSelectedCollection(admin, mealCollectionId),
  ]);

  await prisma.appSettings.upsert({
    create: {
      boxCollectionHandle: boxCollection?.handle ?? null,
      boxCollectionId: boxCollection?.id ?? null,
      boxCollectionTitle: boxCollection?.title ?? null,
      mealCollectionHandle: mealCollection?.handle ?? null,
      mealCollectionId: mealCollection?.id ?? null,
      mealCollectionTitle: mealCollection?.title ?? null,
      shop,
    },
    update: {
      boxCollectionHandle: boxCollection?.handle ?? null,
      boxCollectionId: boxCollection?.id ?? null,
      boxCollectionTitle: boxCollection?.title ?? null,
      mealCollectionHandle: mealCollection?.handle ?? null,
      mealCollectionId: mealCollection?.id ?? null,
      mealCollectionTitle: mealCollection?.title ?? null,
    },
    where: { shop },
  });

  return { ok: true };
};
