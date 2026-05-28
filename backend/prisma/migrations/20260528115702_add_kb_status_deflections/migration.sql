-- CreateEnum
CREATE TYPE "KbArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "DeflectionType" AS ENUM ('AGENT', 'END_USER');

-- AlterTable
ALTER TABLE "KbArticle" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT NOT NULL,
ADD COLUMN     "status" "KbArticleStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "KbDeflection" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "ticketId" TEXT,
    "type" "DeflectionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KbDeflection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbDeflection_articleId_idx" ON "KbDeflection"("articleId");

-- CreateIndex
CREATE INDEX "KbDeflection_ticketId_idx" ON "KbDeflection"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_slug_key" ON "KbArticle"("slug");

-- AddForeignKey
ALTER TABLE "KbDeflection" ADD CONSTRAINT "KbDeflection_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbDeflection" ADD CONSTRAINT "KbDeflection_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
