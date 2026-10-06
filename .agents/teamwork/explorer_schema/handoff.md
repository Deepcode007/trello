# Handoff Report: Database Schema & Relational Data Integrity Audit

**Agent**: Database Schema Auditor (`teamwork_preview_explorer`)  
**Working Directory**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_schema`  
**Primary Deliverable**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_schema/analysis.md`  
**Date**: 2026-10-05  

---

## 1. Observation

Direct observations from source inspection and database migrations:

1. **Foreign Key Constraint Omission on `comments.issueId` and `comments.userId`**:
   - `packages/db/prisma/schema.prisma:105`:
     ```prisma
     issue       issues      @relation(fields: [issueId], references: [id])
     ```
     Lacks `onDelete: Cascade`.
   - `packages/db/prisma/schema.prisma:107`:
     ```prisma
     user        user        @relation(fields: [userId], references: [id])
     ```
     Lacks `onDelete: Cascade`.
   - `packages/db/prisma/migrations/20260808070740_add_comments/migration.sql:14-17`:
     ```sql
     ALTER TABLE "comments" ADD CONSTRAINT "comments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     ```
     Foreign keys are explicitly configured with `ON DELETE RESTRICT`. In contrast, earlier migration `20260804182353_on_delete_cascade/migration.sql:26-47` configured `ON DELETE CASCADE` for `membership`, `boards`, `sections`, `issues`, and `issue_mapping`.

2. **Backend Hard Delete vs Soft Delete Invocation**:
   - `apps/backend/src/controllers/issues/deleteIssue.ts:48-52`: Executes `await prisma.issues.delete({ where: { id: result.data.issueId } })`.
   - `apps/backend/src/controllers/board/deleteBoard.ts:47-51`: Executes `await prisma.boards.delete({ where: { id: result.data.boardId } })`.
   - `apps/backend/src/controllers/organisation/deteleOrg.ts:18-29`: Executes `await prisma.orgs.deleteMany({ where: { id: result.data.orgId, ... } })`.
   - `apps/backend/src/controllers/comments/deleteComment.ts:72-76`:
     ```ts
     const updated = await tx.comments.update({
         where: { id: comment.id },
         data: { deletedAt: new Date() }
     });
     ```
     Sets `deletedAt` without removing the physical record from the PostgreSQL table.
   - `apps/backend/src/helpers/asyncHandler.ts:13-27`:
     ```ts
     catch (e: unknown) {
         if (e instanceof AppError) {
             return res.status(e.statusCode).json({ success: false, error: e.message });
         }
         return res.status(500).json({ success: false, error: "Some Server Error" });
     }
     ```
     Uncaught `PrismaClientKnownRequestError` instances default to HTTP `500 Internal Server Error`.

3. **Orphaned Cards via `issues.sectionId` `onDelete: SetNull`**:
   - `packages/db/prisma/schema.prisma:83`:
     ```prisma
     section       sections?       @relation(fields: [sectionId], references: [id], onDelete: SetNull)
     ```
   - `apps/backend/src/controllers/board/getaBoard.ts:20-34`:
     ```ts
     select: {
         title: true,
         section: {
             select: {
                 issues: { ... }
             }
         }
     }
     ```
     Cards with `sectionId: null` are never returned in board responses.

4. **Missing High-Frequency Foreign Key Indexes**:
   - `packages/db/prisma/schema.prisma:54-62`: `boards` model lacks `@@index([orgId])`.
   - `packages/db/prisma/schema.prisma:92-99`: `issue_mapping` has `@@unique([userId, issueId])`, but lacks `@@index([issueId])`.
   - `packages/db/prisma/schema.prisma:101-114`: `comments` model lacks all indexes on `issueId`, `parentId`, and `userId`.
   - `packages/db/prisma/schema.prisma:87-90`: `issues` contains redundant duplicate index `@@index([sectionId])` alongside `@@index([sectionId, position])`.

5. **Missing Core Kanban Entity Fields**:
   - `packages/db/prisma/schema.prisma:75-90`: `issues` lacks `description`, `createdAt`, `updatedAt`, `dueDate`, `startDate`, `priority`, and `isArchived`.
   - Across all models (`user`, `orgs`, `membership`, `boards`, `sections`, `issues`), standard timestamps (`createdAt`, `updatedAt`) are absent on 6 out of 7 models (only `comments.createdAt` exists).

---

## 2. Logic Chain

1. **Premise 1 (Database Constraint)**: PostgreSQL enforces `ON DELETE RESTRICT` on `"comments_issueId_fkey"` (Observation 1).
2. **Premise 2 (Backend Action)**: Backend delete controllers (`deleteIssue`, `deleteBoard`, `deteleOrg`) perform hard deletes on parent tables (Observation 2).
3. **Premise 3 (Relational Cascade)**: When deleting an issue, board, or organization, PostgreSQL cascades deletes down to `issues`. When attempting to delete any issue referenced by rows in `"comments"`, PostgreSQL raises constraint violation SQLSTATE `23503` (foreign_key_violation).
4. **Premise 4 (Runtime Error)**: Prisma translates SQLSTATE `23503` to `PrismaClientKnownRequestError` code `P2003`. Because `asyncHandler` only handles `AppError`, this causes an uncaught 500 error response: `{"success": false, "error": "Some Server Error"}` (Observation 2).
5. **Premise 5 (The Soft-Delete Trap)**: Even if all comments on an issue are "deleted" by users via `DELETE /api/comments/:commentId`, the application merely sets `deletedAt: new Date()` (Observation 2). The physical row remains in the `"comments"` table. Consequently, once a comment is added to an issue, that issue, its board, and its organization can **never** be deleted.
6. **Premise 6 (Ghost Cards)**: If a section is deleted, `onDelete: SetNull` nullifies `sectionId` on its issues (Observation 3). Because `getBoardDetails` queries issues strictly through `board.section.issues`, cards with `sectionId: null` vanish from the Kanban board view while continuing to exist in the database.
7. **Premise 7 (Unindexed Sequential Scans)**: PostgreSQL does not automatically index foreign keys. Without explicit indexes on `boards.orgId`, `comments.issueId`, `comments.parentId`, and `issue_mapping.issueId` (Observation 4), all board listings, comment thread queries, and child reparenting operations execute full table scans. Furthermore, `@@index([sectionId])` on `issues` is a pure duplicate of `@@index([sectionId, position])`.

---

## 3. Caveats

1. **Existing Production Data**: In an active database with existing records, adding `onDelete: Cascade` and indexes is safe and non-blocking, but adding `NOT NULL` columns requires default values (`DEFAULT CURRENT_TIMESTAMP` for timestamps, `DEFAULT 'medium'` for priority).
2. **WebSocket & Frontend Coupling**: Introducing missing Kanban fields (such as `description`, `priority`, `dueDate`) requires corresponding updates in backend controller Zod validators (`createIssue`, `updateIssue`) and WebSocket payload broadcasters before frontends can consume them.
3. **User Comment Retention**: If legal/audit requirements dictate that comments must be preserved after a user is deleted, `comments.userId` should be modified to `userId String?` with `onDelete: SetNull`, rather than cascading deletion.

---

## 4. Conclusion

The Prisma database schema contains critical relational and performance defects:
1. **Critical Cascade Flaw (F-01)**: `comments.issueId` lacks `onDelete: Cascade`, resulting in P2003 / 500 errors whenever deleting issues, boards, or organizations that contain comments (exacerbated by the soft-delete trap).
2. **Account Deletion Cascade Flaw (F-02)**: `comments.userId` lacks `onDelete: Cascade`, blocking user deletions.
3. **Ghost Card Integrity Flaw (F-03)**: `issues.sectionId` `onDelete: SetNull` creates invisible orphaned cards that disappear from Kanban board queries.
4. **Performance Index Deficits (F-04 & F-05)**: Missing indexes on `boards.orgId`, `comments.issueId`, `comments.parentId`, `comments.userId`, and `issue_mapping.issueId` cause unindexed sequential table scans, while `issues.sectionId` carries a redundant duplicate index.
5. **Domain Feature Incompleteness (F-06 & F-07)**: Absence of card descriptions, timestamps across 6 models, due dates, priorities, labels, and checklists leaves the data layer far below Kanban feature parity.

A complete two-phase remediation plan with exact schema diffs and migration SQL is provided in `analysis.md`.

---

## 5. Verification Method

1. **Verify Schema & Migrations**:
   - Inspect `packages/db/prisma/schema.prisma:101-114` to confirm lack of `onDelete: Cascade` on `comments.issueId`.
   - Inspect `packages/db/prisma/migrations/20260808070740_add_comments/migration.sql:14` to confirm `ON DELETE RESTRICT`.
2. **Verify Cascade Failure in PostgreSQL**:
   ```sql
   -- Insert board -> section -> issue -> comment
   -- Attempt DELETE FROM issues WHERE id = '<issueId>';
   -- Observe error: SQLSTATE 23503 (violates foreign key constraint comments_issueId_fkey)
   ```
3. **Verify Index Coverage with PostgreSQL EXPLAIN**:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM "boards" WHERE "orgId" = '...';
   -- Observes Seq Scan on boards due to lack of boards_orgId_idx
   
   EXPLAIN ANALYZE SELECT * FROM "comments" WHERE "issueId" = '...' ORDER BY "createdAt" DESC;
   -- Observes Seq Scan + Sort on comments due to lack of composite index
   ```
4. **Execute Test Suite**:
   ```bash
   bun test --preload ./apps/backend/tests/setup.ts apps/backend/tests/unit/controller_fixes.test.ts
   ```
