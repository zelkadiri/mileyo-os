-- CreateTable
CREATE TABLE "EmailCronRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "processedCount" INTEGER,
    "sentCount" INTEGER,
    "failedCount" INTEGER,
    "requeuedCount" INTEGER,
    "reclaimedCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailCronRun_shop_startedAt_idx" ON "EmailCronRun"("shop", "startedAt");

-- CreateIndex
CREATE INDEX "EmailCronRun_shop_status_startedAt_idx" ON "EmailCronRun"("shop", "status", "startedAt");
