import type { LoaderFunctionArgs } from "react-router";

import { loadShopifyNotificationsPageData } from "../features/shopify-notifications/shopify-notifications-data.server";

export { default } from "../features/shopify-notifications/shopify-notifications-render";

export const loader = async ({ request }: LoaderFunctionArgs) =>
  loadShopifyNotificationsPageData(request);
