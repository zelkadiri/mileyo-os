-- BOX-CHANGE-2: pending subscription box-size change intent (future cycle).
-- Shopify variant.price remains runtime financial SoT — no billed price column.

CREATE TABLE "SubscriptionBoxChange" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subscriptionMealSelectionId" TEXT NOT NULL,
    "subscriptionContractId" TEXT NOT NULL,
    "fromProductVariantId" TEXT NOT NULL,
    "toProductVariantId" TEXT NOT NULL,
    "toMealsCount" INTEGER NOT NULL,
    "toSelectedMeals" JSONB NOT NULL,
    "toSellingPlanId" TEXT,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveBillingDate" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBoxChange_pkey" PRIMARY KEY ("id")
);

-- At most one active pending intent per selection (replace = cancel + create).
CREATE UNIQUE INDEX "SubscriptionBoxChange_one_pending_per_selection"
ON "SubscriptionBoxChange"("subscriptionMealSelectionId")
WHERE "status" = 'pending';

CREATE INDEX "SubscriptionBoxChange_shop_status_idx"
ON "SubscriptionBoxChange"("shop", "status");

CREATE INDEX "SubscriptionBoxChange_subscriptionMealSelectionId_status_idx"
ON "SubscriptionBoxChange"("subscriptionMealSelectionId", "status");

CREATE INDEX "SubscriptionBoxChange_selection_billing_status_idx"
ON "SubscriptionBoxChange"("subscriptionMealSelectionId", "effectiveBillingDate", "status");

CREATE INDEX "SubscriptionBoxChange_subscriptionContractId_status_idx"
ON "SubscriptionBoxChange"("subscriptionContractId", "status");

ALTER TABLE "SubscriptionBoxChange"
ADD CONSTRAINT "SubscriptionBoxChange_subscriptionMealSelectionId_fkey"
FOREIGN KEY ("subscriptionMealSelectionId") REFERENCES "SubscriptionMealSelection"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
