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
import {
  CONFIRM_UNPUBLISH_MEALS_ONLINE_STORE_FIELD,
  MEAL_PUBLICATION_OPTIONAL_SCOPE,
  PUBLICATION_SCOPES_MISSING_MESSAGE,
  REQUEST_MEAL_PUBLICATION_SCOPES_INTENT,
  UNPUBLISH_MEALS_ONLINE_STORE_INTENT,
  hasWritePublicationsScope,
  mergeMealCatalogSetupWithOnlineStoreProtection,
  unpublishMealsFromOnlineStore,
} from "../../services/mealOnlineStoreUnpublish.server";
import type { SettingsActionData } from "./settings-types";

type SettingsScopesApi = {
  query: () => Promise<{ granted: string[] }>;
  request: (scopes: string[]) => Promise<void>;
};

const ensureWritePublicationsOrExplain = async (
  scopes: SettingsScopesApi | undefined,
): Promise<SettingsActionData | null> => {
  if (!scopes) {
    return {
      errors: [PUBLICATION_SCOPES_MISSING_MESSAGE],
      message: "Protection Online Store indisponible.",
      needsPublicationScopes: true,
      ok: false,
    };
  }

  const detail = await scopes.query();
  if (hasWritePublicationsScope(detail.granted)) {
    return null;
  }

  return {
    errors: [PUBLICATION_SCOPES_MISSING_MESSAGE],
    message: "Protection Online Store indisponible.",
    needsPublicationScopes: true,
    ok: false,
  };
};

export const handleSettingsAction = async ({
  admin,
  request,
  scopes,
  shop,
}: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  request: Request;
  scopes?: SettingsScopesApi;
  shop: string;
}): Promise<SettingsActionData> => {
  const formData = await request.formData();
  const intent = getFormString(formData, "intent");

  if (intent === REQUEST_MEAL_PUBLICATION_SCOPES_INTENT) {
    if (!scopes) {
      return {
        errors: [PUBLICATION_SCOPES_MISSING_MESSAGE],
        message: "Impossible de demander le scope publications.",
        needsPublicationScopes: true,
        ok: false,
      };
    }

    // Server-side redirect when consent is still required (Shopify Scopes API).
    await scopes.request([MEAL_PUBLICATION_OPTIONAL_SCOPE]);
    return {
      message: "Accès publications déjà accordé.",
      ok: true,
    };
  }

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
      const mealCollectionId = settings?.mealCollectionId;

      const scopeGate = await ensureWritePublicationsOrExplain(scopes);
      if (scopeGate) {
        return {
          ...scopeGate,
          message:
            "Protection Online Store requise avant le provisioning Repas V2 — " +
            "aucune conversion effectuée.",
        };
      }

      // Real fail-closed: protect Online Store BEFORE any productSet conversion.
      const unpublishResult = await unpublishMealsFromOnlineStore(
        admin,
        mealCollectionId,
      );
      if (!unpublishResult.ok) {
        return {
          errors: unpublishResult.errors,
          mealOnlineStoreUnpublish: {
            alreadyUnpublished: unpublishResult.alreadyUnpublished,
            failed: unpublishResult.failed,
            totalMeals: unpublishResult.totalMeals,
            unpublished: unpublishResult.unpublished,
          },
          message:
            `${unpublishResult.message} Provisioning Repas V2 annulé — ` +
            "aucune conversion effectuée tant que la protection Online Store échoue.",
          ok: false,
        };
      }

      const catalogResult = await setupV2MealCatalog(admin, mealCollectionId);
      const merged = mergeMealCatalogSetupWithOnlineStoreProtection({
        catalogErrors: catalogResult.errors,
        catalogMessage: formatV2MealCatalogSetupMessage(catalogResult),
        catalogOk: catalogResult.ok,
        unpublish: unpublishResult,
      });

      return {
        errors: merged.errors,
        mealOnlineStoreUnpublish: merged.mealOnlineStoreUnpublish,
        message: merged.message,
        ok: merged.ok,
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

  if (intent === UNPUBLISH_MEALS_ONLINE_STORE_INTENT) {
    const confirmed =
      getFormString(formData, CONFIRM_UNPUBLISH_MEALS_ONLINE_STORE_FIELD) ===
      "1";

    if (!confirmed) {
      return {
        errors: [
          "Confirmation requise : cochez la case avant de dépublier les repas.",
        ],
        message: "Protection Online Store non lancée.",
        ok: false,
      };
    }

    const scopeGate = await ensureWritePublicationsOrExplain(scopes);
    if (scopeGate) {
      return scopeGate;
    }

    try {
      const settings = await prisma.appSettings.findUnique({ where: { shop } });
      const result = await unpublishMealsFromOnlineStore(
        admin,
        settings?.mealCollectionId,
      );

      return {
        errors: result.errors,
        mealOnlineStoreUnpublish: {
          alreadyUnpublished: result.alreadyUnpublished,
          failed: result.failed,
          totalMeals: result.totalMeals,
          unpublished: result.unpublished,
        },
        message: result.message,
        ok: result.ok,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur inattendue Shopify.";

      return {
        errors: [message],
        message: "Impossible de dépublier les repas de la boutique en ligne.",
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
