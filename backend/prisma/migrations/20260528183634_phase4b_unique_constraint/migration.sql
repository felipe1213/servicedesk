-- Add composite unique index on KbArticle(source, externalId) for connector upsert safety
CREATE UNIQUE INDEX "KbArticle_source_externalId_key" ON "KbArticle"("source", "externalId");

-- AlterTable: add default to KbSyncLog.startedAt (no SQL needed - only schema metadata change)
