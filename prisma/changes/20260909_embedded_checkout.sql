BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(9260912);
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "network" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "payinExtraId" TEXT;
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "paymentExpiresAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "lastPolledAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);
ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentSession_requestKey_key" ON "PaymentSession"("requestKey");
-- Older checkout already granted access for these statuses. Do not grant it twice.
UPDATE "PaymentSession" SET "activatedAt" = "updatedAt"
WHERE "activatedAt" IS NULL AND "requestKey" IS NULL AND "status" IN ('confirmed', 'finished');
COMMIT;
