/**
 * Official Mileyo wordmark (violet on white).
 * Served from /public so app-proxy HTML can load it via absolute app URL.
 */

export const MILEYO_LOGO_ALT = "Mileyo" as const;

export const getMileyoLogoSrc = (): string => {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/mileyo-logo.png` : "/mileyo-logo.png";
};

export const renderMileyoLogoImg = (className: string): string =>
  `<img alt="${MILEYO_LOGO_ALT}" class="${className}" decoding="async" height="40" src="${getMileyoLogoSrc()}" width="130" />`;
