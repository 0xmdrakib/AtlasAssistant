-- Retire the requested section, including historical section aliases.
-- SavedItem and ItemTranslation references cascade with content deletion.
BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT pg_advisory_xact_lock(9260911);
DELETE FROM "Item" WHERE lower("section") LIKE '%faith%'
  OR "sourceId" IN (SELECT "id" FROM "Source" WHERE lower("section") LIKE '%faith%');
DELETE FROM "Digest" WHERE lower("section") LIKE '%faith%';
DELETE FROM "Source" WHERE lower("section") LIKE '%faith%';
COMMIT;
