-- AlterTable
ALTER TABLE "KbArticle" ADD COLUMN     "conflictData" JSONB,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalVersion" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "syncConflict" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KbSyncLog" (
    "id" TEXT NOT NULL,
    "connector" "KbSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "articlesNew" INTEGER NOT NULL DEFAULT 0,
    "articlesUpdated" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "KbSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbSyncLog_connector_idx" ON "KbSyncLog"("connector");
