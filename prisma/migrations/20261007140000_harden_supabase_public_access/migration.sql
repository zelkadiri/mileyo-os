-- Harden Supabase public access for server-only Prisma tables.
-- Removes anon/authenticated Data API privileges and enables RLS without policies.
-- Does not FORCE RLS. Does not revoke postgres or service_role.
-- Does not modify data, columns, indexes, or foreign keys.

-- Session
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public."Session" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."Session" FROM authenticated;
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;

-- BoxOrder
REVOKE ALL PRIVILEGES ON TABLE public."BoxOrder" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."BoxOrder" FROM authenticated;
ALTER TABLE public."BoxOrder" ENABLE ROW LEVEL SECURITY;

-- SubscriptionMealSelection
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionMealSelection" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionMealSelection" FROM authenticated;
ALTER TABLE public."SubscriptionMealSelection" ENABLE ROW LEVEL SECURITY;

-- SubscriptionPaymentRecovery
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionPaymentRecovery" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionPaymentRecovery" FROM authenticated;
ALTER TABLE public."SubscriptionPaymentRecovery" ENABLE ROW LEVEL SECURITY;

-- CheckoutLead
REVOKE ALL PRIVILEGES ON TABLE public."CheckoutLead" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."CheckoutLead" FROM authenticated;
ALTER TABLE public."CheckoutLead" ENABLE ROW LEVEL SECURITY;

-- EmailEvent
REVOKE ALL PRIVILEGES ON TABLE public."EmailEvent" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."EmailEvent" FROM authenticated;
ALTER TABLE public."EmailEvent" ENABLE ROW LEVEL SECURITY;

-- SubscriptionBoxChange
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionBoxChange" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."SubscriptionBoxChange" FROM authenticated;
ALTER TABLE public."SubscriptionBoxChange" ENABLE ROW LEVEL SECURITY;

-- AppSettings
REVOKE ALL PRIVILEGES ON TABLE public."AppSettings" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."AppSettings" FROM authenticated;
ALTER TABLE public."AppSettings" ENABLE ROW LEVEL SECURITY;

-- EmailCronRun
REVOKE ALL PRIVILEGES ON TABLE public."EmailCronRun" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."EmailCronRun" FROM authenticated;
ALTER TABLE public."EmailCronRun" ENABLE ROW LEVEL SECURITY;

-- CronRun
REVOKE ALL PRIVILEGES ON TABLE public."CronRun" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."CronRun" FROM authenticated;
ALTER TABLE public."CronRun" ENABLE ROW LEVEL SECURITY;

-- PreparationDeliveryDateState
REVOKE ALL PRIVILEGES ON TABLE public."PreparationDeliveryDateState" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."PreparationDeliveryDateState" FROM authenticated;
ALTER TABLE public."PreparationDeliveryDateState" ENABLE ROW LEVEL SECURITY;

-- MealBox
REVOKE ALL PRIVILEGES ON TABLE public."MealBox" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."MealBox" FROM authenticated;
ALTER TABLE public."MealBox" ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM authenticated;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- Prevent future tables created by postgres in public from auto-granting anon/authenticated.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL PRIVILEGES ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL PRIVILEGES ON TABLES FROM authenticated;

COMMIT;
