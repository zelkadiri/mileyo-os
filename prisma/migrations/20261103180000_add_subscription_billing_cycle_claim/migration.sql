-- P0 durable per-cycle billing reservation. Apply in PROD only after review.
-- Does NOT charge anyone; blocks concurrent / replay double-billing.

BEGIN;

CREATE TABLE "SubscriptionBillingCycleClaim" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subscriptionMealSelectionId" TEXT NOT NULL,
    "subscriptionContractId" TEXT,
    "billingCycleKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "billingAttemptId" TEXT,
    "shopifyOrderId" TEXT,
    "lastErrorMessage" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBillingCycleClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionBillingCycleClaim_subscriptionMealSelectionId_billingCycleKey_key"
  ON "SubscriptionBillingCycleClaim"("subscriptionMealSelectionId", "billingCycleKey");

CREATE INDEX "SubscriptionBillingCycleClaim_shop_status_idx"
  ON "SubscriptionBillingCycleClaim"("shop", "status");

CREATE INDEX "SubscriptionBillingCycleClaim_idempotencyKey_idx"
  ON "SubscriptionBillingCycleClaim"("idempotencyKey");

ALTER TABLE "SubscriptionBillingCycleClaim"
  ADD CONSTRAINT "SubscriptionBillingCycleClaim_subscriptionMealSelectionId_fkey"
  FOREIGN KEY ("subscriptionMealSelectionId") REFERENCES "SubscriptionMealSelection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
