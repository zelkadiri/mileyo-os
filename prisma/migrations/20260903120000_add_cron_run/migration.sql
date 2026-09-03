-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "cronName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "processedCount" INTEGER,
    "skippedCount" INTEGER,
    "errorCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_shop_cronName_startedAt_idx" ON "CronRun"("shop", "cronName", "startedAt");

-- CreateIndex
CREATE INDEX "CronRun_shop_cronName_status_startedAt_idx" ON "CronRun"("shop", "cronName", "status", "startedAt");
