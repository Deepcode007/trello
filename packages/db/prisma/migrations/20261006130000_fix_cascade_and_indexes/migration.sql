-- 1. Resolve Foreign Key Cascade Omission on comments.issueId (Finding DB-01)
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_issueId_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_issueId_fkey" 
  FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Resolve Foreign Key Cascade Omission on comments.userId (Finding DB-02)
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_userId_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Create Missing High-Frequency Foreign Key Indexes (Finding DB-04)
CREATE INDEX IF NOT EXISTS "boards_orgId_idx" ON "boards"("orgId");
CREATE INDEX IF NOT EXISTS "issue_mapping_issueId_idx" ON "issue_mapping"("issueId");
CREATE INDEX IF NOT EXISTS "comments_issueId_createdAt_idx" ON "comments"("issueId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "comments_parentId_idx" ON "comments"("parentId");
CREATE INDEX IF NOT EXISTS "comments_userId_idx" ON "comments"("userId");

-- 4. Drop Redundant Single-Column Index on issues.sectionId (Finding DB-05)
DROP INDEX IF EXISTS "issues_sectionId_idx";

-- 5. Reconcile issues.sectionId to NOT NULL with ON DELETE CASCADE (Finding DB-03)
-- Step 5a: Backfill orphan issues (sectionId IS NULL) to prevent SQLSTATE 23502 not_null_violation
-- Create fallback "Backlog" section for any board containing orphan issues
INSERT INTO "sections" ("id", "title", "boardId", "position")
SELECT 
    gen_random_uuid(),
    'Backlog',
    i."boardId",
    0.0
FROM "issues" i
WHERE i."sectionId" IS NULL
GROUP BY i."boardId"
ON CONFLICT DO NOTHING;

-- Assign orphan issues to the earliest section of their parent board
UPDATE "issues" i
SET "sectionId" = s."id"
FROM (
    SELECT DISTINCT ON ("boardId") "id", "boardId"
    FROM "sections"
    ORDER BY "boardId", "position" ASC
) s
WHERE i."boardId" = s."boardId"
  AND i."sectionId" IS NULL;

-- Step 5b: Drop old SetNull foreign key and enforce ON DELETE CASCADE
ALTER TABLE "issues" DROP CONSTRAINT IF EXISTS "issues_sectionId_fkey";
ALTER TABLE "issues" ADD CONSTRAINT "issues_sectionId_fkey" 
  FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5c: Enforce NOT NULL constraint on issues.sectionId
ALTER TABLE "issues" ALTER COLUMN "sectionId" SET NOT NULL;
