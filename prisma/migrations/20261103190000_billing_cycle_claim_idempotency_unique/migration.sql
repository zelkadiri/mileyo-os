-- One Shopify idempotency key maps to at most one cycle claim row.
BEGIN;

CREATE UNIQUE INDEX "SubscriptionBillingCycleClaim_idempotencyKey_key"
  ON "SubscriptionBillingCycleClaim"("idempotencyKey");

COMMIT;
