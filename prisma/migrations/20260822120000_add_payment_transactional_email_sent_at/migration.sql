-- Track Mileyo transactional payment emails (failed / recovered) for idempotency.
ALTER TABLE "SubscriptionPaymentRecovery" ADD COLUMN "paymentFailedEmailSentAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionPaymentRecovery" ADD COLUMN "paymentRecoveredEmailSentAt" TIMESTAMP(3);
