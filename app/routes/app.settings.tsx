import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handleSettingsAction } from "../features/settings/settings-actions.server";
import { loadSettingsPageData } from "../features/settings/settings-catalog.server";
import { hasWritePublicationsScope } from "../services/mealOnlineStoreUnpublish.server";
import { authenticate } from "../shopify.server";

export { default } from "../features/settings/settings-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, scopes, session } = await authenticate.admin(request);
  const scopesDetail = await scopes.query();

  return loadSettingsPageData(admin, session.shop, {
    hasWritePublications: hasWritePublicationsScope(scopesDetail.granted),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, scopes, session } = await authenticate.admin(request);

  return handleSettingsAction({
    admin,
    request,
    scopes,
    shop: session.shop,
  });
};
