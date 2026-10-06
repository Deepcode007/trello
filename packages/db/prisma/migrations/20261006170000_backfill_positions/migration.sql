-- Backfill distinct non-zero positions for sections partitioned by board
WITH ranked_sections AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "createdAt" ASC, "id" ASC) * 1000.0 AS new_pos
    FROM "sections"
    WHERE "position" = 0
)
UPDATE "sections" s
SET "position" = rs.new_pos
FROM ranked_sections rs
WHERE s."id" = rs."id";

-- Backfill distinct non-zero positions for issues partitioned by section
WITH ranked_issues AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sectionId" ORDER BY "createdAt" ASC, "id" ASC) * 1000.0 AS new_pos
    FROM "issues"
    WHERE "position" = 0
)
UPDATE "issues" i
SET "position" = ri.new_pos
FROM ranked_issues ri
WHERE i."id" = ri."id";
