-- CreateTable
CREATE TABLE "CheckoutLead" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "objective" TEXT,
    "boxVariantId" TEXT,
    "mealCount" INTEGER,
    "scheduledDeliveryDate" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "CheckoutLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutLead_shop_email_key" ON "CheckoutLead"("shop", "email");

CREATE INDEX "CheckoutLead_shop_lastSeenAt_idx" ON "CheckoutLead"("shop", "lastSeenAt");
