import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Compatibility shim for Shopify Admin deep links that open `/subscriptions`
 * (e.g. Customer → Subscriptions) instead of `/app/subscriptions`.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  throw redirect(`/app/subscriptions${url.search}`);
};
