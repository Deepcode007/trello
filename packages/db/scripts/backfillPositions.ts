import { prisma } from "../db";

export async function backfillPositions(): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.$executeRawUnsafe(`
            WITH ranked_sections AS (
                SELECT "id", ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "createdAt" ASC, "id" ASC) * 1000.0 AS new_pos
                FROM "sections"
                WHERE "position" = 0
            )
            UPDATE "sections" s
            SET "position" = rs.new_pos
            FROM ranked_sections rs
            WHERE s."id" = rs."id";
        `);

        await prisma.$executeRawUnsafe(`
            WITH ranked_issues AS (
                SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sectionId" ORDER BY "createdAt" ASC, "id" ASC) * 1000.0 AS new_pos
                FROM "issues"
                WHERE "position" = 0
            )
            UPDATE "issues" i
            SET "position" = ri.new_pos
            FROM ranked_issues ri
            WHERE i."id" = ri."id";
        `);

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
    }
}

if (import.meta.main) {
    backfillPositions().then((res) => {
        if (res.success) {
            console.log("Positions backfilled successfully.");
            process.exit(0);
        } else {
            console.error("Backfill failed:", res.error);
            process.exit(1);
        }
    });
}
