import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ShopifyNotificationTemplatePayload } from "./shopify-notifications-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "templates");

/**
 * Load a versioned .liquid notification template from disk.
 * Templates live next to this module so Vite/SSR and tsx tests can both read them.
 */
export const readShopifyNotificationLiquid = (
  fileName: string,
): string => {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "");
  if (safeName !== fileName || !safeName.endsWith(".liquid")) {
    throw new Error(`Invalid Shopify notification template file: ${fileName}`);
  }

  return readFileSync(join(TEMPLATES_DIR, safeName), "utf8");
};

export const loadMileyoTemplatePayload = (
  fileName: string,
): ShopifyNotificationTemplatePayload => ({
  content: readShopifyNotificationLiquid(fileName),
  fileName,
  kind: "mileyo",
});

export const loadOriginalTemplatePayload = (
  fileName: string,
): ShopifyNotificationTemplatePayload => ({
  content: readShopifyNotificationLiquid(fileName),
  fileName,
  kind: "original",
});

export const shopifyNotificationsTemplatesDir = TEMPLATES_DIR;
