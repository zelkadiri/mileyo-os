/**
 * Canonical customer portal (App Proxy) path and URL helpers.
 *
 * Public storefront URL: https://{shopDomain}/apps/box-builder/portal
 * Backend route after proxy: /apps/box-builder/portal
 *
 * Emails and Liquid must use the shop domain (never app tunnels, loopback hosts, or app backend hosts).
 */

/** App Proxy path relative to the shop domain. */
export const MILEYO_PORTAL_PATH = "/apps/box-builder/portal";

/**
 * Shopify Customer Accounts (new) login path.
 * Classic `/account/login` does not reliably accept a return destination.
 * @see https://shopify.dev/docs/storefronts/themes/sign-in
 */
export const MILEYO_CUSTOMER_LOGIN_PATH = "/customer_authentication/login";

/**
 * Shopify Customer Accounts logout (storefront route).
 * With New Customer Accounts, Shopify redirects through the hosted auth flow.
 * Fixed path only — no client-controlled return_to (avoid open redirect / re-login loop).
 * @see https://shopify.dev/docs/api/liquid/objects/routes#routes-account_logout_url
 */
export const MILEYO_CUSTOMER_LOGOUT_PATH = "/account/logout";

/** Preferred generic CTA label when linking to the portal from emails. */
export const MILEYO_PORTAL_CTA_LABEL = "Accéder à mon espace Mileyo";

/**
 * Liquid href fragment for Shopify notification templates.
 * Must stay in sync with MILEYO_PORTAL_PATH.
 */
export const MILEYO_PORTAL_LIQUID_HREF = `{{ shop.url }}${MILEYO_PORTAL_PATH}`;

const APP_PROXY_PREFIX = "/apps/box-builder";

/**
 * Allowlist for post-login return paths (open-redirect protection).
 * Only same-origin relative paths under the box-builder app proxy.
 */
export const isAllowedMileyoPortalReturnPath = (path: string): boolean => {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.includes("\\") || trimmed.includes("@")) {
    return false;
  }
  // Reject query/hash injection that escapes the path (defense in depth).
  const pathOnly = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  return (
    pathOnly === MILEYO_PORTAL_PATH || pathOnly.startsWith(`${APP_PROXY_PREFIX}/`)
  );
};

/**
 * Login URL that returns the customer to the portal after authentication.
 * Destination is constant / allowlisted — never taken from untrusted query input.
 */
export const buildMileyoPortalLoginUrl = (
  returnPath: string = MILEYO_PORTAL_PATH,
): string => {
  const safePath = isAllowedMileyoPortalReturnPath(returnPath)
    ? returnPath.trim().split(/[?#]/, 1)[0]!
    : MILEYO_PORTAL_PATH;

  return `${MILEYO_CUSTOMER_LOGIN_PATH}?return_to=${encodeURIComponent(safePath)}`;
};

/**
 * Absolute portal URL for transactional emails.
 * Prefer shop myshopify / primary domain; never hardcode tunnels or stores.
 */
export const getMileyoPortalUrl = ({
  shop,
  portalUrl,
}: {
  shop?: string | null;
  portalUrl?: string | null;
} = {}): string | null => {
  const override = portalUrl?.trim();
  if (override) {
    return override;
  }

  const normalizedShop = shop?.trim();
  if (!normalizedShop) {
    return null;
  }

  const host = normalizedShop.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!host) {
    return null;
  }

  return `https://${host}${MILEYO_PORTAL_PATH}`;
};
