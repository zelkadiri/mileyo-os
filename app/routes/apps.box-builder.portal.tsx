import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handlePortalAction } from "../features/portal/portal-actions.server";
import {
  getCustomerIdFromRequest,
  getShopFromRequest,
  loadPortalData,
} from "../features/portal/portal-data.server";
import { renderMessage, renderPortal } from "../features/portal/portal-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = getShopFromRequest(request);
  const customerShopifyId = getCustomerIdFromRequest(request);

  if (!shop) {
    return renderMessage(
      "Boutique introuvable. Ouvrez ce portail via le proxy d’application Shopify.",
    );
  }

  if (!customerShopifyId) {
    return renderMessage(
      "Connecte-toi à ton compte pour modifier tes prochaines box.",
      { loginLink: true },
    );
  }

  const portalData = await loadPortalData({ customerShopifyId, shop });

  if (!portalData) {
    return renderMessage(
      "Configuration incomplète. Les collections box et plats doivent être configurées.",
    );
  }

  return renderPortal({ ...portalData, successMessage: null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return handlePortalAction(request);
};
