import { shopifyIdsMatch } from "../../utils/shopifyIds.server";

/**
 * Cycle classification for orders/create.
 *
 * Identity rule: one Shopify order ID ⇒ one logical cycle treatment.
 * A selection match alone must never imply renewal — the incoming order ID
 * must differ from the selection's attached checkout/first order ID.
 */
export type OrdersCreateCycleClassification = {
  /** Selection.shopifyOrderId matches the incoming webhook order. */
  isAttachedToIncomingOrder: boolean;
  /**
   * Same-order replay of the checkout / first subscription order.
   * Kept for email + CheckoutLead wiring (idempotent side effects).
   */
  isFirstOrderReplay: boolean;
  /**
   * Genuine renewal: existing contract selection + a NEW Shopify order ID.
   */
  isRenewal: boolean;
  /**
   * Genuine renewal path re-entered for an order already upserted as BoxOrder.
   * Must not advance the cycle a second time.
   */
  isRenewalOrderReplay: boolean;
  /** Any replay of the same Shopify order ID (first or renewal). */
  isSameOrderReplay: boolean;
};

export const classifyOrdersCreateCycle = ({
  hasExistingBoxOrder,
  isSubscription,
  matchedSelectionShopifyOrderId,
  shopifyOrderId,
}: {
  hasExistingBoxOrder: boolean;
  isSubscription: boolean;
  matchedSelectionShopifyOrderId: string | null | undefined;
  shopifyOrderId: string;
}): OrdersCreateCycleClassification => {
  const isAttachedToIncomingOrder = Boolean(
    matchedSelectionShopifyOrderId &&
      shopifyIdsMatch(matchedSelectionShopifyOrderId, shopifyOrderId),
  );

  const hasMatchedSelection = Boolean(matchedSelectionShopifyOrderId);
  const isSameOrderReplay = hasExistingBoxOrder || isAttachedToIncomingOrder;

  // Genuine renewal only when the selection belongs to another (prior) order.
  const isRenewal = Boolean(
    isSubscription && hasMatchedSelection && !isAttachedToIncomingOrder,
  );

  const isRenewalOrderReplay = Boolean(isRenewal && hasExistingBoxOrder);
  const isFirstOrderReplay = isAttachedToIncomingOrder;

  return {
    isAttachedToIncomingOrder,
    isFirstOrderReplay,
    isRenewal,
    isRenewalOrderReplay,
    isSameOrderReplay,
  };
};
