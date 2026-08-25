import { authenticate } from "../../shopify.server";
import {
  SHOPIFY_NOTIFICATION_TEMPLATES,
  buildShopifyNotificationProgress,
  findShopifyNotificationById,
} from "./shopify-notifications-catalog";
import {
  loadMileyoTemplatePayload,
  loadOriginalTemplatePayload,
} from "./shopify-notifications-templates.server";
import type { ShopifyNotificationsPageData } from "./shopify-notifications-types";

const buildNotificationsAdminUrl = (shop: string): string =>
  `https://${shop}/admin/settings/notifications`;

export const loadShopifyNotificationsPageData = async (
  request: Request,
): Promise<ShopifyNotificationsPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const selectedId = url.searchParams.get("template");
  const showOriginal = url.searchParams.get("view") === "original";

  const selectedDef =
    selectedId != null ? findShopifyNotificationById(selectedId) : undefined;

  let selectedTemplate = null;
  let selectedOriginal = null;

  if (selectedDef?.status === "ready" && selectedDef.mileyoTemplateFile) {
    if (!showOriginal) {
      selectedTemplate = loadMileyoTemplatePayload(
        selectedDef.mileyoTemplateFile,
      );
    }
    if (selectedDef.originalTemplateFile) {
      selectedOriginal = showOriginal
        ? loadOriginalTemplatePayload(selectedDef.originalTemplateFile)
        : {
            content: "",
            fileName: selectedDef.originalTemplateFile,
            kind: "original" as const,
          };
    }
  }

  return {
    notificationsAdminUrl: buildNotificationsAdminUrl(shop),
    progress: buildShopifyNotificationProgress(SHOPIFY_NOTIFICATION_TEMPLATES),
    selectedId: selectedDef?.id ?? null,
    selectedOriginal,
    selectedTemplate,
    shop,
    templates: SHOPIFY_NOTIFICATION_TEMPLATES,
  };
};
