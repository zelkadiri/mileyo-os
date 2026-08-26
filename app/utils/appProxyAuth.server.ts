import { authenticate } from "../shopify.server";
import { normalizeShopifyId } from "./shopifyIds.server";

export type MileyoAppProxyIdentity = {
  /** Trusted only after Shopify App Proxy HMAC validation. */
  loggedInCustomerId: string | null;
  /** Trusted shop domain after Shopify App Proxy HMAC validation. */
  shop: string;
};

/**
 * Authenticate a storefront App Proxy request before trusting shop /
 * logged_in_customer_id query params.
 *
 * On invalid / missing signature, the Shopify SDK throws Response(400).
 * Anonymous visitors (empty logged_in_customer_id) remain valid for the builder.
 */
export const authenticateMileyoAppProxy = async (
  request: Request,
): Promise<MileyoAppProxyIdentity> => {
  const context = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop =
    context.session?.shop?.trim() ||
    url.searchParams.get("shop")?.trim() ||
    "";

  if (!shop) {
    throw new Response(undefined, {
      status: 400,
      statusText: "Bad Request",
    });
  }

  return {
    loggedInCustomerId: normalizeShopifyId(
      url.searchParams.get("logged_in_customer_id"),
    ),
    shop,
  };
};
