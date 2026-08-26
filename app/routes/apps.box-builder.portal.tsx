import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handlePortalAction } from "../features/portal/portal-actions.server";
import {
  getCustomerIdFromRequest,
  getShopFromRequest,
  loadPortalData,
} from "../features/portal/portal-data.server";
import { getRequestedSubscriptionIdFromRequest } from "../features/portal/portal-multi-subscription";
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

  const portalData = await loadPortalData({
    customerShopifyId,
    requestedSubscriptionId: getRequestedSubscriptionIdFromRequest(request),
    shop,
  });

  if (!portalData) {
    return renderMessage(
      "Configuration incomplète. La collection de plats doit être configurée.",
    );
  }

  return renderPortal({
    ...portalData,
    portalRequestUrl: request.url,
    successMessage: null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return handlePortalAction(request);
};
