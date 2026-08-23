-- AlterTable
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "upcomingDeliveryEmailSentAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "upcomingDeliveryEmailDeliveryDate" VARCHAR(10);
