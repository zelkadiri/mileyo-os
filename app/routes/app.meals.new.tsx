import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { createEmptyMealCreateFormValues } from "../features/meals/meals-create-form";
import {
  CREATE_MEAL_INTENT,
  REQUEST_MEAL_IMAGE_SCOPES_INTENT,
  createMealProduct,
  loadMealCreatePageData,
} from "../features/meals/meals-create.server";
import { hasWriteFilesScope } from "../services/mealProductImage.server";
import { hasWritePublicationsScope } from "../services/mealOnlineStoreUnpublish.server";
import { authenticate } from "../shopify.server";

export { default } from "../features/meals/meals-create-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, scopes, session } = await authenticate.admin(request);
  const scopesDetail = await scopes.query();

  return loadMealCreatePageData(admin, session.shop, {
    hasWritePublications: hasWritePublicationsScope(scopesDetail.granted),
    hasWriteFiles: hasWriteFilesScope(scopesDetail.granted),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, scopes, session } = await authenticate.admin(request);
  const scopesDetail = await scopes.query();
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === REQUEST_MEAL_IMAGE_SCOPES_INTENT) {
    // Photo consent is App Bridge client-side only (shopify.scopes.request).
    // Server scopes.request redirects full-page and yields "Handling response"
    // inside the embedded admin iframe — never use it here.
    return {
      errors: [
        "Utilisez le bouton « Autoriser l’ajout de photos » (autorisation App Bridge).",
      ],
      fieldErrors: [],
      message:
        "Utilisez le bouton « Autoriser l’ajout de photos » (autorisation App Bridge).",
      ok: false,
      trackingProductId: null,
      productTitle: null,
      blockedFieldNotices: [],
      values: createEmptyMealCreateFormValues(),
    };
  }

  if (intent !== CREATE_MEAL_INTENT) {
    return {
      errors: ["Action non reconnue."],
      fieldErrors: [],
      message: "Action non reconnue.",
      ok: false,
      trackingProductId: null,
      productTitle: null,
      blockedFieldNotices: [],
      values: createEmptyMealCreateFormValues(),
    };
  }

  return createMealProduct({
    admin,
    formData,
    grantedScopes: scopesDetail.granted,
    shop: session.shop,
  });
};
