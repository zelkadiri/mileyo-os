/**
 * Scheduled complimentary (free) kitchen deliveries — no Shopify billing.
 * Distinct from SubscriptionPromotion (Shopify discount engine).
 */

export const COMPLIMENTARY_DELIVERY_STATUS = {
  SCHEDULED: "scheduled",
  PROCESSING: "processing",
  FULFILLED: "fulfilled",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type ComplimentaryDeliveryStatus =
  (typeof COMPLIMENTARY_DELIVERY_STATUS)[keyof typeof COMPLIMENTARY_DELIVERY_STATUS];

export const OPEN_COMPLIMENTARY_DELIVERY_STATUSES = [
  COMPLIMENTARY_DELIVERY_STATUS.SCHEDULED,
  COMPLIMENTARY_DELIVERY_STATUS.PROCESSING,
  COMPLIMENTARY_DELIVERY_STATUS.FAILED,
] as const;

export const COMPLIMENTARY_DELIVERY_HISTORY_EVENT = {
  SCHEDULED: "scheduled",
  PROCESSING: "processing",
  FULFILLED: "fulfilled",
  FAILED: "failed",
  CANCELLED: "cancelled",
  RETRY: "retry",
} as const;

/** Honest financial marker — never "paid". Kitchen includes non-simulated rows. */
export const COMPLIMENTARY_BOX_FINANCIAL_STATUS = "complimentary";

export const COMPLIMENTARY_BOX_ORDER_TYPE = "Box offerte — sans prélèvement";

/** Prefix for kitchen-local BoxOrder.shopifyOrderId (not a Shopify GID). */
export const COMPLIMENTARY_SHOPIFY_ORDER_ID_PREFIX = "complimentary_";

export const buildComplimentaryShopifyOrderId = (operationId: string) =>
  `${COMPLIMENTARY_SHOPIFY_ORDER_ID_PREFIX}${operationId}`;

export const isComplimentaryShopifyOrderId = (shopifyOrderId: string) =>
  shopifyOrderId.startsWith(COMPLIMENTARY_SHOPIFY_ORDER_ID_PREFIX);
