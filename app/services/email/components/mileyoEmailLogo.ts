/**
 * Official Mileyo logo for transactional emails.
 * Public Shopify CDN — no app tunnel / local public asset dependency.
 *
 * Portal/builder keep using app/utils/mileyoLogo.ts (local public asset).
 */

export const MILEYO_EMAIL_LOGO_URL =
  "https://cdn.shopify.com/s/files/1/0965/8512/2120/files/Mileyo_Mileyo_violet_sur_Blanc_1.png?v=1779889306" as const;

export const MILEYO_LOGO_ALT = "Mileyo" as const;

/** Email logo display size (≈ portal 28px height, slightly larger). */
export const MILEYO_EMAIL_LOGO_WIDTH = 120;
export const MILEYO_EMAIL_LOGO_HEIGHT = 37;

/**
 * Stable absolute logo URL for all transactional emails.
 * Always returns the Shopify CDN source.
 */
export const getMileyoEmailLogoSrc = (): string => MILEYO_EMAIL_LOGO_URL;
