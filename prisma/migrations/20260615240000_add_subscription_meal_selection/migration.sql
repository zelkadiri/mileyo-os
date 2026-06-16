-- CreateTable
CREATE TABLE "SubscriptionMealSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerShopifyId" TEXT,
    "customerEmail" TEXT,
    "subscriptionContractId" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "boxTitle" TEXT,
    "mealsCount" INTEGER,
    "selectedMeals" JSON,
    "status" TEXT NOT NULL DEFAULT 'active',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionMealSelection_shop_shopifyOrderId_key" ON "SubscriptionMealSelection"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "SubscriptionMealSelection_shop_customerShopifyId_idx" ON "SubscriptionMealSelection"("shop", "customerShopifyId");

-- CreateIndex
CREATE INDEX "SubscriptionMealSelection_shop_subscriptionContractId_idx" ON "SubscriptionMealSelection"("shop", "subscriptionContractId");
