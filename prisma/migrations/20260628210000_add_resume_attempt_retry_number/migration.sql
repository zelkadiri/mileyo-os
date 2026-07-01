-- AlterTable
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptRetryNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptLastFailedBillingAttemptId" TEXT;
