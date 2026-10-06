-- AlterTable
ALTER TABLE "sections" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "sections_boardId_position_idx" ON "sections"("boardId", "position");

-- AlterTable
ALTER TABLE "issues" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "issues_sectionId_position_idx" ON "issues"("sectionId", "position");
