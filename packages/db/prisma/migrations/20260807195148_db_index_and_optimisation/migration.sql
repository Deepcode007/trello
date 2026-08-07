/*
  Warnings:

  - A unique constraint covering the columns `[userId,issueId]` on the table `issue_mapping` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_sectionId_fkey";

-- AlterTable
ALTER TABLE "issues" ALTER COLUMN "sectionId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "issue_mapping_userId_issueId_key" ON "issue_mapping"("userId", "issueId");

-- CreateIndex
CREATE INDEX "issues_boardId_sectionId_idx" ON "issues"("boardId", "sectionId");

-- CreateIndex
CREATE INDEX "issues_sectionId_idx" ON "issues"("sectionId");

-- CreateIndex
CREATE INDEX "membership_orgId_idx" ON "membership"("orgId");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
