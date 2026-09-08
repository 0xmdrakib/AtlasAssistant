-- Additive, repeatable migration for the existing db-push managed database.
-- Run through DIRECT_URL. No existing content, account or payment table is rewritten.
BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(9260909);

CREATE TABLE IF NOT EXISTS "SavedItem" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("userId", "itemId"),
    CONSTRAINT "SavedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SavedItem_userId_createdAt_idx" ON "SavedItem"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavedItem_itemId_idx" ON "SavedItem"("itemId");

-- Private account references must not be exposed by Supabase's public Data API.
-- The server's privileged Prisma connection performs authenticated access checks.
ALTER TABLE "SavedItem" ENABLE ROW LEVEL SECURITY;
COMMIT;
