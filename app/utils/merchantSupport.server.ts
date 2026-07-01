export type MerchantSupportContact = {
  href: string;
  isConfigured: boolean;
  label: string;
};

/** Set MILEYO_SUPPORT_CONTACT_URL in .env / Vercel (mailto: or https://). */
export const getMerchantSupportContact = (): MerchantSupportContact => {
  const configuredUrl = process.env.MILEYO_SUPPORT_CONTACT_URL?.trim();

  if (configuredUrl) {
    return {
      href: configuredUrl,
      isConfigured: true,
      label: "Nous contacter",
    };
  }

  return {
    href: "mailto:contact@mileyo.fr",
    isConfigured: false,
    label: "Nous contacter",
  };
};
