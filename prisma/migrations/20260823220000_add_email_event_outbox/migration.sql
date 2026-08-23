-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "providerId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "metaJson" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailEvent_idempotencyKey_key" ON "EmailEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailEvent_status_nextAttemptAt_idx" ON "EmailEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailEvent_shop_status_nextAttemptAt_idx" ON "EmailEvent"("shop", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailEvent_eventType_createdAt_idx" ON "EmailEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "EmailEvent_referenceType_referenceId_idx" ON "EmailEvent"("referenceType", "referenceId");
