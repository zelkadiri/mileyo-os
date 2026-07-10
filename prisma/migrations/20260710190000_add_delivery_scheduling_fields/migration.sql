ALTER TABLE "BoxOrder"
ADD COLUMN "desiredDeliveryDate" VARCHAR(10),
ADD COLUMN "scheduledDeliveryDate" VARCHAR(10),
ADD COLUMN "deliveryRescheduleReason" TEXT;

ALTER TABLE "BoxOrder"
ADD CONSTRAINT "BoxOrder_desiredDeliveryDate_check"
  CHECK ("desiredDeliveryDate" IS NULL OR "desiredDeliveryDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
ADD CONSTRAINT "BoxOrder_scheduledDeliveryDate_check"
  CHECK ("scheduledDeliveryDate" IS NULL OR "scheduledDeliveryDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

CREATE INDEX "BoxOrder_shop_scheduledDeliveryDate_idx" ON "BoxOrder"("shop", "scheduledDeliveryDate");

ALTER TABLE "SubscriptionMealSelection"
ADD COLUMN "preferredDeliveryWeekday" INTEGER,
ADD COLUMN "nextScheduledDeliveryDate" VARCHAR(10);

ALTER TABLE "SubscriptionMealSelection"
ADD CONSTRAINT "SubscriptionMealSelection_nextScheduledDeliveryDate_check"
  CHECK ("nextScheduledDeliveryDate" IS NULL OR "nextScheduledDeliveryDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
ADD CONSTRAINT "SubscriptionMealSelection_preferredDeliveryWeekday_check"
  CHECK ("preferredDeliveryWeekday" IS NULL OR ("preferredDeliveryWeekday" >= 0 AND "preferredDeliveryWeekday" <= 6));
