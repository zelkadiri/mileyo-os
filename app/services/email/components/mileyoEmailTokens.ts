import type * as React from "react";

/**
 * Email visual tokens — derived from Mileyo portal/builder CSS variables.
 * Sources:
 * - app/features/portal/portal-styles.ts (:root)
 * - app/features/builder/builder-styles.ts (:root)
 * - app/utils/mileyoLogo.ts (logo asset)
 *
 * Email-safe solid equivalents (no rgba text where clients are flaky).
 */

export const MILEYO_EMAIL_SUPPORT_FALLBACK_HREF =
  "mailto:contact@mileyo.fr" as const;
export const MILEYO_EMAIL_SUPPORT_LABEL = "Nous contacter" as const;

/** Official palette (portal/builder). */
export const mileyoEmailColors = {
  /** --mileyo-cream */
  background: "#FCF8F6",
  /** soft lilac border ≈ rgba(185,138,215,0.22) on cream */
  border: "#E8D9F2",
  /** --mileyo-purple-black (primary CTA) */
  button: "#5A1B69",
  /** --mileyo-white */
  buttonText: "#FFFFFF",
  /** --mileyo-white */
  card: "#FFFFFF",
  /** hero-kicker / muted labels */
  eyebrow: "#6F5A7D",
  /** cream panel for info cards */
  infoCardBg: "#FCF8F6",
  /** solid stand-in for --mileyo-muted */
  muted: "#6F5A7D",
  /** --mileyo-lilac accent (subtle) */
  lilac: "#DCC2F0",
  /** --mileyo-purple */
  purple: "#B98AD7",
  /** --mileyo-text */
  text: "#3A2C45",
  /** --mileyo-purple-black (titles) */
  title: "#5A1B69",
} as const;

/** Body + titles: modern sans only (no empattement). */
export const mileyoEmailFontFamily =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

/**
 * Title stack — same sans family as body.
 * Premium feel via weight / size / letter-spacing / color, not empattement.
 */
export const mileyoEmailDisplayFontFamily = mileyoEmailFontFamily;

export const mileyoEmailBodyStyle: React.CSSProperties = {
  backgroundColor: mileyoEmailColors.background,
  fontFamily: mileyoEmailFontFamily,
  margin: 0,
  padding: "20px 12px",
};

export const mileyoEmailOuterStyle: React.CSSProperties = {
  margin: "0 auto",
  maxWidth: "560px",
  width: "100%",
};

export const mileyoEmailCardStyle: React.CSSProperties = {
  backgroundColor: mileyoEmailColors.card,
  borderRadius: "16px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "24px 20px",
  width: "100%",
};

export const mileyoEmailEyebrowStyle: React.CSSProperties = {
  color: mileyoEmailColors.eyebrow,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  lineHeight: "14px",
  margin: "0 0 8px",
  textTransform: "uppercase",
};

export const mileyoEmailTitleStyle: React.CSSProperties = {
  color: mileyoEmailColors.title,
  fontFamily: mileyoEmailDisplayFontFamily,
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: "28px",
  margin: "0 0 14px",
};

export const mileyoEmailTextStyle: React.CSSProperties = {
  color: mileyoEmailColors.text,
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

export const mileyoEmailMutedStyle: React.CSSProperties = {
  color: mileyoEmailColors.muted,
  fontSize: "13px",
  lineHeight: "18px",
  margin: "0 0 10px",
};

export const mileyoEmailLinkStyle: React.CSSProperties = {
  color: mileyoEmailColors.title,
  textDecoration: "underline",
};
