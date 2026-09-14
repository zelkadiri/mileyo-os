/**
 * Official Mileyo wordmark (violet on white).
 * Served from /public so app-proxy HTML can load it via absolute app URL.
 */

export const MILEYO_LOGO_ALT = "Mileyo" as const;

export const getMileyoPublicAssetUrl = (pathname: string): string => {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return base ? `${base}${path}` : path;
};

export const getMileyoLogoSrc = (): string => getMileyoPublicAssetUrl("/mileyo-logo.png");

export const renderMileyoLogoImg = (className: string): string =>
  `<img alt="${MILEYO_LOGO_ALT}" class="${className}" decoding="async" height="40" src="${getMileyoLogoSrc()}" width="130" />`;
