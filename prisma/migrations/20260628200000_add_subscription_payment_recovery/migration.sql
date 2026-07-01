-- Dunning / failed payment recovery for automatic subscription renewals.
CREATE TABLE "SubscriptionPaymentRecovery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subscriptionMealSelectionId" TEXT NOT NULL,
    "billingCycleKey" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "nextRetryAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastBillingAttemptId" TEXT,
    "paymentUpdateEmailSentAt" TIMESTAMP(3),
    "finalPausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPaymentRecovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPaymentRecovery_subscriptionMealSelectionId_billingCycleKey_key" ON "SubscriptionPaymentRecovery"("subscriptionMealSelectionId", "billingCycleKey");
CREATE INDEX "SubscriptionPaymentRecovery_shop_status_nextRetryAt_idx" ON "SubscriptionPaymentRecovery"("shop", "status", "nextRetryAt");

ALTER TABLE "SubscriptionPaymentRecovery" ADD CONSTRAINT "SubscriptionPaymentRecovery_subscriptionMealSelectionId_fkey" FOREIGN KEY ("subscriptionMealSelectionId") REFERENCES "SubscriptionMealSelection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
