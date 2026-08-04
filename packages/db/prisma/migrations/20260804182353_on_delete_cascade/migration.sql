-- DropForeignKey
ALTER TABLE "boards" DROP CONSTRAINT "boards_orgId_fkey";

-- DropForeignKey
ALTER TABLE "issue_mapping" DROP CONSTRAINT "issue_mapping_issueId_fkey";

-- DropForeignKey
ALTER TABLE "issue_mapping" DROP CONSTRAINT "issue_mapping_userId_fkey";

-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_boardId_fkey";

-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "membership" DROP CONSTRAINT "membership_orgId_fkey";

-- DropForeignKey
ALTER TABLE "membership" DROP CONSTRAINT "membership_userId_fkey";

-- DropForeignKey
ALTER TABLE "sections" DROP CONSTRAINT "sections_boardId_fkey";

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_mapping" ADD CONSTRAINT "issue_mapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_mapping" ADD CONSTRAINT "issue_mapping_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
