import * as React from "react";
import { Img, Section } from "react-email";

import {
  getMileyoEmailLogoSrc,
  MILEYO_EMAIL_LOGO_HEIGHT,
  MILEYO_EMAIL_LOGO_WIDTH,
  MILEYO_LOGO_ALT,
} from "./mileyoEmailLogo";

/**
 * Centered Mileyo logo header for all transactional emails.
 * Uses the official violet-on-white PNG from Shopify CDN.
 */
export const MileyoEmailHeader = () => {
  const logoSrc = getMileyoEmailLogoSrc();

  return (
    <Section style={header}>
      <Img
        src={logoSrc}
        alt={MILEYO_LOGO_ALT}
        width={MILEYO_EMAIL_LOGO_WIDTH}
        height={MILEYO_EMAIL_LOGO_HEIGHT}
        style={logo}
      />
    </Section>
  );
};

const header: React.CSSProperties = {
  margin: "0 0 16px",
  padding: "8px 0 4px",
  textAlign: "center" as const,
  width: "100%",
};

const logo: React.CSSProperties = {
  display: "block",
  height: `${MILEYO_EMAIL_LOGO_HEIGHT}px`,
  margin: "0 auto",
  maxWidth: `${MILEYO_EMAIL_LOGO_WIDTH}px`,
  objectFit: "contain" as const,
  width: `${MILEYO_EMAIL_LOGO_WIDTH}px`,
};

export default MileyoEmailHeader;
