import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { handleSettingsAction } from "../features/settings/settings-actions.server";
import { loadSettingsPageData } from "../features/settings/settings-catalog.server";
import { authenticate } from "../shopify.server";

export { default } from "../features/settings/settings-render";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  return loadSettingsPageData(admin, session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  return handleSettingsAction({ admin, request, shop: session.shop });
};
