-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealBox" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meals" INTEGER NOT NULL,
    "oneTimePriceCents" INTEGER NOT NULL,
    "subscriptionPriceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "boxCollectionId" TEXT,
    "boxCollectionHandle" TEXT,
    "boxCollectionTitle" TEXT,
    "mealCollectionId" TEXT,
    "mealCollectionHandle" TEXT,
    "mealCollectionTitle" TEXT,
    "subscriptionDiscountPercent" DOUBLE PRECISION DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxOrder" (
    "id" TEXT NOT NULL,
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
    "subscriptionContractId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoxOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionMealSelection" (
    "id" TEXT NOT NULL,
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
    "nextBillingDate" TIMESTAMP(3),
    "lastBillingAttemptAt" TIMESTAMP(3),
    "lastBillingAttemptStatus" TEXT,
    "lastBillingAttemptError" TEXT,
    "lastBillingAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionMealSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BoxOrder_shop_shopifyOrderId_key" ON "BoxOrder"("shop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "SubscriptionMealSelection_shop_customerShopifyId_idx" ON "SubscriptionMealSelection"("shop", "customerShopifyId");

-- CreateIndex
CREATE INDEX "SubscriptionMealSelection_shop_subscriptionContractId_idx" ON "SubscriptionMealSelection"("shop", "subscriptionContractId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionMealSelection_shop_shopifyOrderId_key" ON "SubscriptionMealSelection"("shop", "shopifyOrderId");
