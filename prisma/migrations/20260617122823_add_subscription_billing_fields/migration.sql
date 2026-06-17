-- AlterTable
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "lastBillingAttemptAt" DATETIME;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "lastBillingAttemptError" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "lastBillingAttemptId" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "lastBillingAttemptStatus" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "nextBillingDate" DATETIME;
