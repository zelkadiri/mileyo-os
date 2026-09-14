import { authenticate } from "../shopify.server";
import { normalizeShopifyId } from "./shopifyIds.server";

/** Admin GraphQL client already built by Shopify App Proxy auth when a session exists. */
export type MileyoAppProxyAdmin = NonNullable<
  Awaited<ReturnType<typeof authenticate.public.appProxy>>["admin"]
>;

export type MileyoAppProxyIdentity = {
  /**
   * Admin API client from `authenticate.public.appProxy` when an offline
   * session exists. Undefined only if HMAC is valid but no shop session is
   * stored yet (app not installed / session missing).
   */
  admin: MileyoAppProxyAdmin | undefined;
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
 *
 * When a session exists, the SDK already loads the offline session (and may
 * refresh an expiring token) and returns a ready `admin` client — callers
 * should reuse it instead of calling `unauthenticated.admin(shop)` again.
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
    admin: context.admin,
    loggedInCustomerId: normalizeShopifyId(
      url.searchParams.get("logged_in_customer_id"),
    ),
    shop,
  };
};
