-- Normalize Shopify GID contract IDs to numeric form before adding uniqueness.
UPDATE "SubscriptionMealSelection"
SET "subscriptionContractId" = regexp_replace(
  "subscriptionContractId",
  '^gid://shopify/SubscriptionContract/',
  ''
)
WHERE "subscriptionContractId" LIKE 'gid://shopify/SubscriptionContract/%';

-- Enforce one canonical row per shop + contract. Multiple NULL contract IDs remain allowed.
CREATE UNIQUE INDEX "SubscriptionMealSelection_shop_subscriptionContractId_key"
ON "SubscriptionMealSelection" ("shop", "subscriptionContractId");
