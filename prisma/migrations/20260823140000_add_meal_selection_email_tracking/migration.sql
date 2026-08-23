-- AlterTable
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "mealSelectionLastExplicitDeliveryDate" VARCHAR(10);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "mealSelectionConfirmedEmailSentAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "mealSelectionConfirmedDeliveryDate" VARCHAR(10);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "mealSelectionReminderEmailSentAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionMealSelection" ADD COLUMN "mealSelectionReminderDeliveryDate" VARCHAR(10);
