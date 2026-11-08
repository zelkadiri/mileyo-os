-- Complimentary kitchen deliveries (no Shopify billing).
-- Independent from SubscriptionPromotion.

CREATE TABLE "ComplimentaryDelivery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subscriptionContractId" TEXT NOT NULL,
    "subscriptionMealSelectionId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "scheduledDeliveryDate" VARCHAR(10) NOT NULL,
    "mealCutoffAt" TIMESTAMP(3) NOT NULL,
    "commercialReason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "boxOrderId" TEXT,
    "boxShopifyOrderId" TEXT,
    "mealsSnapshotJson" JSONB,
    "failureReason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "historyJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplimentaryDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplimentaryDelivery_shop_operationId_key" ON "ComplimentaryDelivery"("shop", "operationId");

CREATE UNIQUE INDEX "ComplimentaryDelivery_subscriptionMealSelectionId_scheduledDeliveryDate_key" ON "ComplimentaryDelivery"("subscriptionMealSelectionId", "scheduledDeliveryDate");

CREATE INDEX "ComplimentaryDelivery_shop_status_mealCutoffAt_idx" ON "ComplimentaryDelivery"("shop", "status", "mealCutoffAt");

CREATE INDEX "ComplimentaryDelivery_subscriptionContractId_status_idx" ON "ComplimentaryDelivery"("subscriptionContractId", "status");

ALTER TABLE "ComplimentaryDelivery" ADD CONSTRAINT "ComplimentaryDelivery_subscriptionMealSelectionId_fkey" FOREIGN KEY ("subscriptionMealSelectionId") REFERENCES "SubscriptionMealSelection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
