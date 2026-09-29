-- CreateTable
CREATE TABLE "PreparationDeliveryDateState" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduledDeliveryDate" VARCHAR(10) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparationDeliveryDateState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreparationDeliveryDateState_shop_archivedAt_idx" ON "PreparationDeliveryDateState"("shop", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationDeliveryDateState_shop_scheduledDeliveryDate_key" ON "PreparationDeliveryDateState"("shop", "scheduledDeliveryDate");
