/*
  Warnings:

  - You are about to alter the column `rawOrder` on the `BoxOrder` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.
  - You are about to alter the column `selectedMeals` on the `BoxOrder` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.
  - You are about to alter the column `selectedMeals` on the `SubscriptionMealSelection` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BoxOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "orderType" TEXT,
    "boxTitle" TEXT,
    "mealsCount" INTEGER,
    "selectedMeals" JSONB,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "rawOrder" JSONB,
    "selectedMealsSource" TEXT DEFAULT 'line_item_properties',
    "isSubscriptionRenewal" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionSelectionId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BoxOrder" ("boxTitle", "createdAt", "customerEmail", "customerName", "financialStatus", "fulfillmentStatus", "id", "mealsCount", "orderType", "rawOrder", "selectedMeals", "shop", "shopifyOrderId", "shopifyOrderName", "simulated", "subscriptionSelectionId", "updatedAt") SELECT "boxTitle", "createdAt", "customerEmail", "customerName", "financialStatus", "fulfillmentStatus", "id", "mealsCount", "orderType", "rawOrder", "selectedMeals", "shop", "shopifyOrderId", "shopifyOrderName", "simulated", "subscriptionSelectionId", "updatedAt" FROM "BoxOrder";
DROP TABLE "BoxOrder";
ALTER TABLE "new_BoxOrder" RENAME TO "BoxOrder";
CREATE UNIQUE INDEX "BoxOrder_shop_shopifyOrderId_key" ON "BoxOrder"("shop", "shopifyOrderId");
CREATE TABLE "new_SubscriptionMealSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerShopifyId" TEXT,
    "customerEmail" TEXT,
    "subscriptionContractId" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "boxTitle" TEXT,
    "mealsCount" INTEGER,
    "selectedMeals" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SubscriptionMealSelection" ("active", "boxTitle", "createdAt", "customerEmail", "customerShopifyId", "id", "mealsCount", "selectedMeals", "shop", "shopifyOrderId", "shopifyOrderName", "status", "subscriptionContractId", "updatedAt") SELECT "active", "boxTitle", "createdAt", "customerEmail", "customerShopifyId", "id", "mealsCount", "selectedMeals", "shop", "shopifyOrderId", "shopifyOrderName", "status", "subscriptionContractId", "updatedAt" FROM "SubscriptionMealSelection";
DROP TABLE "SubscriptionMealSelection";
ALTER TABLE "new_SubscriptionMealSelection" RENAME TO "SubscriptionMealSelection";
CREATE INDEX "SubscriptionMealSelection_shop_customerShopifyId_idx" ON "SubscriptionMealSelection"("shop", "customerShopifyId");
CREATE INDEX "SubscriptionMealSelection_shop_subscriptionContractId_idx" ON "SubscriptionMealSelection"("shop", "subscriptionContractId");
CREATE UNIQUE INDEX "SubscriptionMealSelection_shop_shopifyOrderId_key" ON "SubscriptionMealSelection"("shop", "shopifyOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
