-- Resume billing idempotency: one key per pause→resume cycle, not per subscription.
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptKey" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptStatus" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptStartedAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptOrderId" TEXT;
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "resumeAttemptBillingAttemptId" TEXT;
