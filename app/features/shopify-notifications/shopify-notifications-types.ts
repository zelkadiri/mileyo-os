/**
 * Shopify customer notification templates — provisioning catalog types.
 *
 * Ready in Mileyo ≠ installed in Shopify (API cannot verify liquid content).
 */

export type ShopifyNotificationOwner =
  | "shopify"
  | "resend"
  | "shopify_and_mileyo";

export type ShopifyNotificationStatus =
  | "ready"
  | "todo"
  | "needs_source"
  | "shopify_system"
  | "not_editable";

export type ShopifyNotificationRoadmapGroup =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F";

export type ShopifyNotificationOriginalSnapshotProvenance =
  | "store_dump_locked"
  | "unverified_provisional";

export type ShopifyNotificationTemplateDefinition = {
  adminPathHint: string;
  description: string;
  /** Filename under templates/ for the Mileyo liquid (when ready). */
  mileyoTemplateFile: string | null;
  name: string;
  notes?: string;
  /**
   * Provenance of *.shopify-original.liquid.
   * store_dump_locked = exact paste from merchant Shopify Admin.
   * unverified_provisional = temporary / community / gist — do not apply to stores.
   */
  originalSnapshotProvenance?: ShopifyNotificationOriginalSnapshotProvenance;
  /** Filename under templates/ for the Shopify original liquid (rollback). */
  originalTemplateFile: string | null;
  owner: ShopifyNotificationOwner;
  /** Recommended email subject (Shopify Admin subject field) — not applied automatically. */
  recommendedSubject?: string;
  roadmapGroup: ShopifyNotificationRoadmapGroup;
  role: string;
  /** Catalog id — stable key. */
  id: string;
  shopifyAdminLabel: string;
  /** Hint of Shopify’s default / current subject (for distinction vs Resend). */
  shopifySubjectHint?: string;
  status: ShopifyNotificationStatus;
};

export type ShopifyNotificationProgressSummary = {
  needsSource: number;
  ready: number;
  shopifySystem: number;
  todo: number;
  total: number;
};

export type ShopifyNotificationTemplatePayload = {
  content: string;
  fileName: string;
  kind: "mileyo" | "original";
};

export type ShopifyNotificationsPageData = {
  notificationsAdminUrl: string;
  progress: ShopifyNotificationProgressSummary;
  selectedId: string | null;
  selectedOriginal: ShopifyNotificationTemplatePayload | null;
  selectedTemplate: ShopifyNotificationTemplatePayload | null;
  shop: string;
  templates: ShopifyNotificationTemplateDefinition[];
};
