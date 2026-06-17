-- AlterTable (only columns not present on older dev databases)
ALTER TABLE "BoxOrder" ADD COLUMN "subscriptionSelectionId" TEXT;
ALTER TABLE "BoxOrder" ADD COLUMN "simulated" BOOLEAN NOT NULL DEFAULT false;
