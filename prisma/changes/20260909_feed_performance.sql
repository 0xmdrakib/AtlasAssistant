-- Index the collection-time filters and sorting used by every feed request.
BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(9260910);
CREATE INDEX IF NOT EXISTS "Item_section_createdAt_score_idx" ON "Item" ("section", "createdAt", "score");
CREATE INDEX IF NOT EXISTS "Item_createdAt_idx" ON "Item" ("createdAt");
COMMIT;
