import prisma from "../db.server";

export type MerchantSupportContact = {
  href: string;
  isConfigured: boolean;
  label: string;
};

export const MERCHANT_SUPPORT_FALLBACK_HREF = "mailto:contact@mileyo.fr";
export const MERCHANT_SUPPORT_LABEL = "Nous contacter";

/** Allowed schemes for support / dietitian chat URLs. */
export const isAllowedSupportChatUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("mailto:")
  );
};

/**
 * Resolve contact URL priority:
 * 1. AppSettings.supportChatUrl
 * 2. MILEYO_SUPPORT_CONTACT_URL
 * 3. mailto fallback
 */
export const resolveMerchantSupportContact = ({
  envUrl = process.env.MILEYO_SUPPORT_CONTACT_URL,
  supportChatUrl,
}: {
  envUrl?: string | null;
  supportChatUrl?: string | null;
} = {}): MerchantSupportContact => {
  const fromSettings = supportChatUrl?.trim();
  if (fromSettings && isAllowedSupportChatUrl(fromSettings)) {
    return {
      href: fromSettings,
      isConfigured: true,
      label: MERCHANT_SUPPORT_LABEL,
    };
  }

  const fromEnv = envUrl?.trim();
  if (fromEnv && isAllowedSupportChatUrl(fromEnv)) {
    return {
      href: fromEnv,
      isConfigured: true,
      label: MERCHANT_SUPPORT_LABEL,
    };
  }

  return {
    href: MERCHANT_SUPPORT_FALLBACK_HREF,
    isConfigured: false,
    label: MERCHANT_SUPPORT_LABEL,
  };
};

/** Set AppSettings.supportChatUrl and/or MILEYO_SUPPORT_CONTACT_URL (mailto: or https://). */
export const getMerchantSupportContact = async (
  shop: string,
): Promise<MerchantSupportContact> => {
  const settings = await prisma.appSettings.findUnique({
    select: { supportChatUrl: true },
    where: { shop },
  });

  return resolveMerchantSupportContact({
    supportChatUrl: settings?.supportChatUrl,
  });
};
