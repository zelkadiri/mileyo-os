-- CreateTable
CREATE TABLE "BoxOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "orderType" TEXT,
    "boxTitle" TEXT,
    "mealsCount" INTEGER,
    "selectedMeals" JSON,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "rawOrder" JSON,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "BoxOrder_shop_shopifyOrderId_key" ON "BoxOrder"("shop", "shopifyOrderId");
