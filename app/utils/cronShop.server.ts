export type CronShopConfigResult =
  | { ok: true; shop: string }
  | { ok: false; error: string };

/** Shopify myshopify.com hostname only — no path, query, or suffix tricks. */
export const MYSHOPIFY_HOST_REGEX =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/;

export const normalizeCronShop = (raw: string | undefined): string => {
  let value = (raw ?? "").trim().toLowerCase();

  if (value.startsWith("https://")) {
    value = value.slice("https://".length);
  } else if (value.startsWith("http://")) {
    value = value.slice("http://".length);
  }

  while (value.endsWith("/")) {
    value = value.slice(0, -1);
  }

  return value;
};

export const isValidMyshopifyDomain = (shop: string): boolean => {
  if (!shop) {
    return false;
  }

  if (/[?#]/.test(shop) || shop.includes("/")) {
    return false;
  }

  return MYSHOPIFY_HOST_REGEX.test(shop);
};

export const resolveCronShop = (
  raw: string | undefined,
): CronShopConfigResult => {
  const shop = normalizeCronShop(raw);

  if (!shop) {
    return {
      error: "CRON_SHOP environment variable is not configured.",
      ok: false,
    };
  }

  if (!isValidMyshopifyDomain(shop)) {
    return {
      error: "CRON_SHOP must be a valid *.myshopify.com domain.",
      ok: false,
    };
  }

  return { ok: true, shop };
};
