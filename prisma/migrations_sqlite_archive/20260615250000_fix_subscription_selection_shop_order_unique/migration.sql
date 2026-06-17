-- Align indexes with current schema (shop + shopifyOrderId unique)
DROP INDEX IF EXISTS "SubscriptionMealSelection_shop_subscriptionContractId_key";
DROP INDEX IF EXISTS "SubscriptionMealSelection_shop_customerShopifyId_shopifyOrderId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionMealSelection_shop_shopifyOrderId_key" ON "SubscriptionMealSelection"("shop", "shopifyOrderId");
