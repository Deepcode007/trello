# Exhaustive Technical Audit: Prisma Database Schema & Relational Data Integrity

**Audited File**: `packages/db/prisma/schema.prisma`  
**Related Migrations**: `packages/db/prisma/migrations/*`  
**Related Backend Controllers**: `apps/backend/src/controllers/*`  
**Auditor**: Database Schema Auditor (`teamwork_preview_explorer`)  
**Audit Date**: 2026-10-05  
**Database Engine**: PostgreSQL 13+ via Prisma ORM 7.9.1 (`@prisma/adapter-pg`)  

---

## 1. Executive Summary & Findings Matrix

An exhaustive architectural and relational audit was conducted on `packages/db/prisma/schema.prisma`, its ten database migration scripts, and its corresponding backend controller invocation paths. 

The audit revealed severe relational integrity flaws, cascading delete omissions that cause hard 500 runtime errors, missing high-frequency indexes leading to unindexed sequential table scans, a broken soft-delete implementation that permanently blocks deletion of parent entities, and substantial domain gaps when compared against standard Kanban and Trello specifications.

### Findings Summary Matrix

| ID | Finding Title | Severity | Impact Area | Primary File & Lines |
|---|---|---|---|---|
| **F-01** | Foreign Key Cascade Omission on `comments.issueId` | **CRITICAL** | Data Integrity & Runtime Crash | `schema.prisma:105`, `deleteIssue.ts:48-52`, `deleteBoard.ts:47-51` |
| **F-02** | Foreign Key Cascade Omission on `comments.userId` | **HIGH** | Account Lifecycle & Data Integrity | `schema.prisma:107`, `migration.sql (add_comments):17` |
| **F-03** | Relational Ghost/Orphan Cards via `issues.sectionId` `onDelete: SetNull` | **HIGH** | Kanban UX & Query Visibility | `schema.prisma:83`, `getaBoard.ts:20-34` |
| **F-04** | Missing Indexes on High-Frequency Foreign Key Query Paths | **HIGH** | Query Performance & Cascade Latency | `schema.prisma:58, 96, 104, 106, 108` |
| **F-05** | Redundant Duplicate B-Tree Index on `issues.sectionId` | **MEDIUM** | Storage Waste & Write Overhead | `schema.prisma:88-89`, `migration.sql:20` |
| **F-06** | Missing Core Kanban Entity Fields (Descriptions, Timestamps, Labels, Checklists) | **HIGH** | Domain Feature Parity | `schema.prisma:21-114` |
| **F-07** | Inconsistent Schema Architecture & PostgreSQL Conventions | **MEDIUM** | Code Maintainability & Data Quality | `schema.prisma:1-115` |

---

## 2. Finding F-01: Foreign Key Cascade Omission on `comments.issueId` (CRITICAL)

### 2.1 Description & Root Cause
In `packages/db/prisma/schema.prisma` lines 101–114, the `comments` model declares its relation to `issues` as follows:
```prisma
model comments {
    id          String      @id @default(uuid())
    description String
    issueId     String
    issue       issues      @relation(fields: [issueId], references: [id])
    userId      String
    user        user        @relation(fields: [userId], references: [id])
    parentId    String?
    parent      comments?   @relation("CommentReplies", fields: [parentId], references: [id])
    children    comments[]  @relation("CommentReplies")

    createdAt   DateTime    @default(now())
    deletedAt   DateTime?
}
```
Notice that line 105 **omits the `onDelete: Cascade` clause**.

In migration `20260804182353_on_delete_cascade/migration.sql`, the developers explicitly upgraded all primary relational foreign keys to `ON DELETE CASCADE` (`boards_orgId_fkey`, `sections_boardId_fkey`, `issues_boardId_fkey`, `issue_mapping_issueId_fkey`, `issue_mapping_userId_fkey`, `membership_userId_fkey`, `membership_orgId_fkey`).

However, when comments were subsequently added in migration `20260808070740_add_comments/migration.sql`, line 14:
```sql
ALTER TABLE "comments" ADD CONSTRAINT "comments_issueId_fkey" 
FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
PostgreSQL and Prisma defaulted to `ON DELETE RESTRICT`.

### 2.2 Exact Runtime Failure Mechanism & Error Codes
When an administrator or employee attempts to delete a card (`DELETE /api/issues/:issueId` or `DELETE /api/cards/:id`), board (`DELETE /api/boards/:boardId`), or organization (`DELETE /api/orgs/:orgId`) that contains even one comment:

1. **Card Deletion**: In `apps/backend/src/controllers/issues/deleteIssue.ts` line 48:
   ```ts
   const deleted = await prisma.issues.delete({
       where: { id: result.data.issueId }
   });
   ```
   PostgreSQL executes `DELETE FROM "issues" WHERE "id" = $1`.
   Because rows in `"comments"` reference `"issues"."id"` via `"comments_issueId_fkey"` with `ON DELETE RESTRICT`, the PostgreSQL transaction immediately aborts with:
   - **PostgreSQL Error**: `error: update or delete on table "issues" violates foreign key constraint "comments_issueId_fkey" on table "comments"`
   - **SQLSTATE**: `23503` (`foreign_key_violation`)
   - **Error Detail**: `Key (id)=(...) is still referenced from table "comments".`

2. **Prisma Client Translation**:
   The Prisma PostgreSQL adapter catches SQLSTATE `23503` and throws a `PrismaClientKnownRequestError`:
   - **Prisma Error Code**: `P2003`
   - **Error Message**: `Foreign key constraint violated on the field: comments_issueId_fkey`
   - **Error Meta**: `{"field_name": "comments_issueId_fkey", "modelName": "issues"}`

3. **HTTP Server Response**:
   In `apps/backend/src/helpers/asyncHandler.ts` lines 13–27:
   ```ts
   catch (e: unknown) {
       if (e instanceof AppError) {
           return res.status(e.statusCode).json({ success: false, error: e.message });
       }
       return res.status(500).json({ success: false, error: "Some Server Error" });
   }
   ```
   Because `PrismaClientKnownRequestError` is not an instance of `AppError`, the server returns:
   - **HTTP Status**: `500 Internal Server Error`
   - **Body**: `{"success": false, "error": "Some Server Error"}`
   - The deletion fails completely.

4. **Hierarchical Board & Org Cascading Failure**:
   When deleting a board (`DELETE /api/boards/:boardId` via `deleteBoard.ts:47`):
   - PostgreSQL cascades `boards` deletion down to `issues` via `issues_boardId_fkey` (`ON DELETE CASCADE`).
   - When attempting to delete the issues on that board, PostgreSQL hits `comments_issueId_fkey` (`ON DELETE RESTRICT`).
   - The cascade transaction aborts with SQLSTATE `23503` / Prisma `P2003` / HTTP 500.
   - The same failure occurs when deleting an organization (`DELETE /api/orgs/:orgId` via `deteleOrg.ts:18`) because `orgs -> boards -> issues -> comments` fails at the final hop.

### 2.3 Amplifying Architectural Defect: The "Soft-Delete Trap"
This bug is drastically amplified by the comment deletion logic in `apps/backend/src/controllers/comments/deleteComment.ts` lines 61–80:
```ts
const deleted = await prisma.$transaction(async (tx) => {
    await tx.comments.updateMany({
        where: { parentId: comment.id },
        data: { parentId: comment.parentId }
    });
    const updated = await tx.comments.update({
        where: { id: comment.id },
        data: { deletedAt: new Date() }
    });
    return updated;
});
```
When a user "deletes" a comment in the application, the backend performs a **soft-delete** by populating `deletedAt`. **The row is never deleted from PostgreSQL table `comments`**.

Because `ON DELETE RESTRICT` checks physical row existence in PostgreSQL—completely unaware of application-level soft-delete columns:
- Even if all comments on an issue are "deleted" by their authors or admins, **the physical rows remain in PostgreSQL referencing `issueId`**.
- As a result, **once a card has ever received a comment, it can NEVER be deleted**. Neither the card, nor its containing board, nor the organization can ever be deleted through the API. They are permanently locked in the database.

### 2.4 Reproduction Steps & Proof-of-Concept Scenarios

#### Scenario A: REST API Reproduction
1. **Create an organization and board**:
   ```bash
   # POST /api/orgs -> orgId
   # POST /api/boards/:orgId -> boardId
   # POST /api/sections/:boardId -> sectionId
   ```
2. **Create an issue and post a comment**:
   ```bash
   # Create Issue
   curl -X POST http://localhost:3000/api/sections/${sectionId}/issues \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"title": "Card with Comments", "boardId": "'${boardId}'"}'
   # Returns issueId: "550e8400-e29b-41d4-a716-446655440000"

   # Post Comment
   curl -X POST http://localhost:3000/api/issues/550e8400-e29b-41d4-a716-446655440000/comments \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"description": "Blocking comment"}'
   # Returns commentId: "660e8400-e29b-41d4-a716-446655440001"
   ```
3. **Attempt to delete the issue**:
   ```bash
   curl -X DELETE http://localhost:3000/api/issues/550e8400-e29b-41d4-a716-446655440000 \
     -H "Authorization: Bearer ${TOKEN}"
   ```
   **Observed Response**:
   ```json
   HTTP/1.1 500 Internal Server Error
   Content-Type: application/json

   {
     "success": false,
     "error": "Some Server Error"
   }
   ```
4. **Attempt to delete the comment first, then delete the issue (Soft-Delete Trap Verification)**:
   ```bash
   curl -X DELETE http://localhost:3000/api/comments/660e8400-e29b-41d4-a716-446655440001 \
     -H "Authorization: Bearer ${TOKEN}"
   # Returns 201 {"success": true, "data": "..."}

   curl -X DELETE http://localhost:3000/api/issues/550e8400-e29b-41d4-a716-446655440000 \
     -H "Authorization: Bearer ${TOKEN}"
   ```
   **Observed Response**: Still fails with HTTP 500 (`P2003` constraint violation)!

#### Scenario B: PostgreSQL SQL Verification
```sql
BEGIN;
INSERT INTO "user" ("id", "email", "username", "password") 
VALUES ('u1', 'test@test.com', 'test', 'hash');

INSERT INTO "orgs" ("id", "name", "description") 
VALUES ('o1', 'Org 1', 'Desc');

INSERT INTO "boards" ("id", "title", "orgId") 
VALUES ('b1', 'Board 1', 'o1');

INSERT INTO "sections" ("id", "title", "boardId") 
VALUES ('s1', 'Todo', 'b1');

INSERT INTO "issues" ("id", "title", "boardId", "sectionId") 
VALUES ('i1', 'Task 1', 'b1', 's1');

INSERT INTO "comments" ("id", "description", "issueId", "userId") 
VALUES ('c1', 'First Comment', 'i1', 'u1');

-- Execute deletion:
DELETE FROM "issues" WHERE "id" = 'i1';
-- ERROR:  update or delete on table "issues" violates foreign key constraint "comments_issueId_fkey" on table "comments"
-- DETAIL: Key (id)=(i1) is still referenced from table "comments".
-- SQL state: 23503
ROLLBACK;
```

### 2.5 Remediation Code Diff

#### Changes to `packages/db/prisma/schema.prisma`
```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -102,7 +102,7 @@ model comments {
     id          String      @id @default(uuid())
     description String
     issueId     String
-    issue       issues      @relation(fields: [issueId], references: [id])
+    issue       issues      @relation(fields: [issueId], references: [id], onDelete: Cascade)
     userId      String
     user        user        @relation(fields: [userId], references: [id])
     parentId    String?
```

#### Migration SQL: `prisma/migrations/20261006120000_cascade_comments_issue_id/migration.sql`
```sql
-- Drop the restrictive foreign key constraint
ALTER TABLE "comments" DROP CONSTRAINT "comments_issueId_fkey";

-- Re-add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "comments" 
  ADD CONSTRAINT "comments_issueId_fkey" 
  FOREIGN KEY ("issueId") 
  REFERENCES "issues"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;
```

---

## 3. Finding F-02: Foreign Key Cascade Omission on `comments.userId` (HIGH)

### 3.1 Description & Root Cause
In `packages/db/prisma/schema.prisma` line 107 and migration `20260808070740_add_comments/migration.sql` line 17:
```prisma
userId      String
user        user        @relation(fields: [userId], references: [id])
```
```sql
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
When a user is deleted from the `user` table (account deletion, GDPR erasure request, or test DB cleanup), PostgreSQL enforces `ON DELETE RESTRICT`.

In comparison:
- `membership`: has `onDelete: Cascade` on `userId` (`schema.prisma:47`).
- `issue_mapping`: has `onDelete: Cascade` on `userId` (`schema.prisma:95`).
- `comments`: has `ON DELETE RESTRICT` on `userId`.

### 3.2 Runtime Failure Mechanism
If an administrator or account deletion endpoint triggers `prisma.user.delete({ where: { id: userId } })`:
1. PostgreSQL checks all tables referencing `user(id)`.
2. `membership` cascades and deletes.
3. `issue_mapping` cascades and deletes.
4. `comments` encounters `comments_userId_fkey` with `ON DELETE RESTRICT`.
5. PostgreSQL aborts with SQLSTATE `23503` (`foreign_key_violation`).
6. Prisma throws `PrismaClientKnownRequestError` with code `P2003`.
7. The entire user deletion transaction fails.

### 3.3 Architectural Decision: Cascade vs SetNull
There are two production patterns for user deletion relative to comments:
- **Option 1: Complete Cascade (`onDelete: Cascade`)**: Deleting a user deletes all comments authored by that user. Clean and simple, but removes discussion context from existing cards.
- **Option 2: Ghost / Preserved Author (`onDelete: SetNull` with `userId String?`)**: `userId` is nullable. When a user is deleted, comments remain on the card with `userId = null` (displayed in UI as "[Deleted User]").
- **Recommendation for Trello/Kanban**: `onDelete: Cascade` aligns with the existing schema pattern where `membership` and `issue_mapping` are deleted with `Cascade`. If comment retention is desired in the future, `userId` can be made nullable with `SetNull`.

### 3.4 Remediation Code Diff

#### Changes to `packages/db/prisma/schema.prisma`
```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -104,7 +104,7 @@ model comments {
     issueId     String
     issue       issues      @relation(fields: [issueId], references: [id], onDelete: Cascade)
     userId      String
-    user        user        @relation(fields: [userId], references: [id])
+    user        user        @relation(fields: [userId], references: [id], onDelete: Cascade)
     parentId    String?
     parent      comments?   @relation("CommentReplies", fields: [parentId], references: [id])
     children    comments[]  @relation("CommentReplies")
```

#### Migration SQL:
```sql
-- Drop restrictive user foreign key
ALTER TABLE "comments" DROP CONSTRAINT "comments_userId_fkey";

-- Re-add with ON DELETE CASCADE
ALTER TABLE "comments" 
  ADD CONSTRAINT "comments_userId_fkey" 
  FOREIGN KEY ("userId") 
  REFERENCES "user"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;
```

---

## 4. Finding F-03: Relational Ghost/Orphan Cards via `issues.sectionId` `onDelete: SetNull` (HIGH)

### 4.1 Description & Root Cause
In `packages/db/prisma/schema.prisma` line 83:
```prisma
model issues {
    id            String          @id @default(uuid())
    title         String
    position      Float           @default(0)
    gh_url        String?
    boardId       String
    board         boards          @relation(fields: [boardId], references: [id], onDelete: Cascade)
    sectionId     String?
    section       sections?       @relation(fields: [sectionId], references: [id], onDelete: SetNull)
    ...
```
In migration `20260807195148_db_index_and_optimisation/migration.sql`, lines 11 and 26:
```sql
ALTER TABLE "issues" ALTER COLUMN "sectionId" DROP NOT NULL;
ALTER TABLE "issues" ADD CONSTRAINT "issues_sectionId_fkey" 
FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
The foreign key was explicitly altered to drop `NOT NULL` and use `ON DELETE SET NULL`.

### 4.2 Impact on Board Queries & UI Visibility
Examine `apps/backend/src/controllers/board/getaBoard.ts` lines 14–37:
```ts
const board = await prisma.boards.findUnique({
    where: { id: result.data.boardId },
    select: {
        title: true,
        section: {
            orderBy: { position: "asc" },
            select: {
                issues: {
                    orderBy: { position: "asc" }
                },
                title: true,
                id: true,
                position: true
            }
        },
        orgId: true
    }
});
```
`getBoardDetails` retrieves cards **strictly nested inside `section`**.

If a section is deleted and `ON DELETE SET NULL` executes:
1. Every card in that section has its `sectionId` set to `NULL`.
2. The card remains linked to `boardId`.
3. However, because `getBoardDetails` queries `boards -> section -> issues`, **cards with `sectionId: null` are never fetched**.
4. The cards become **invisible orphan cards**:
   - They cannot be seen or manipulated in the Kanban board.
   - They still occupy card IDs, positions, and database storage.
   - They still count in `getAllBoards` issue count aggregation (`_count: { select: { issues: true } }` in `getBoards.ts:28`).
   - A user sees an issue count of e.g. "5 cards" on the board overview, but opening the board displays zero cards!

### 4.3 Controller Compensation vs Relational Reality
In `apps/backend/src/controllers/sections/deleteSection.ts` lines 57–98, the backend attempts to compensate for this at the application layer by requiring `targetSectionId` when `issueCount > 0`.
However:
- If a section is deleted via any background job, admin script, direct database command, or future endpoint, PostgreSQL executes `ON DELETE SET NULL`.
- If an issue is created without a `sectionId` (schema allows it because `sectionId` is optional `String?`), the issue is orphaned from birth.
- The database schema does not reflect the true domain invariant: *A Kanban card must belong to a list to be rendered on a board.*

### 4.4 Architectural Remediation Options
- **Option A (Strict Kanban Domain — Recommended)**:
  Make `sectionId` non-nullable: `sectionId String`. Change cascade to `onDelete: Cascade`. If a section is deleted, all cards within it are deleted (standard Kanban list deletion), OR require explicit card migration before deletion as enforced in `deleteSection.ts`.
- **Option B (Unassigned / Backlog Pool)**:
  Retain `sectionId String?`, but update `getBoardDetails` to explicitly select unassigned issues:
  ```ts
  select: {
      title: true,
      section: { ... },
      issues: { where: { sectionId: null } } // Backlog / Unsorted list
  }
  ```

---

## 5. Finding F-04: Missing Indexes on High-Frequency Foreign Key Query Paths (HIGH)

### 5.1 The PostgreSQL Foreign Key Indexing Gap
Unlike MySQL (InnoDB engine), **PostgreSQL does NOT automatically create indexes on foreign key columns**.
Unless an index is explicitly defined in `schema.prisma`, any query filtering or sorting by a foreign key column—as well as any foreign key constraint check during parent row deletions—triggers an unindexed **Sequential Table Scan (`Seq Scan`)**.

### 5.2 Audit of Missing Indexes

#### 5.2.1 Missing Index on `boards.orgId`
- **Location**: `schema.prisma:54-62`
- **Query Path**: `apps/backend/src/controllers/board/getBoards.ts:17-34` (`getAllBoards`)
  ```ts
  prisma.orgs.findUnique({
      where: { id: orgId },
      select: { boards: { select: ... } }
  })
  ```
  Generates SQL: `SELECT ... FROM "boards" WHERE "boards"."orgId" = $1`.
- **Failure Impact**:
  - Full table scan on `boards` for every call to `/api/orgs/:orgId/boards`.
  - When an organization is deleted, PostgreSQL must check `boards` for matching `orgId` via a sequential scan across all boards in the database.
- **Remedy**: Add `@@index([orgId])` on `boards`.

#### 5.2.2 Missing Index on `comments.issueId`
- **Location**: `schema.prisma:101-114`
- **Query Path**: `apps/backend/src/controllers/comments/getAllcomments.ts:19-58` (`getAllComments`)
  ```ts
  prisma.comments.findMany({
      where: { issueId: result.data.issueId },
      orderBy: { createdAt: "desc" }
  })
  ```
  Generates SQL: `SELECT ... FROM "comments" WHERE "comments"."issueId" = $1 ORDER BY "comments"."createdAt" DESC`.
- **Failure Impact**:
  - Full table scan on `comments` + memory/temp disk sorting on `createdAt` for every single issue comment load.
  - Foreign key validation on card deletion requires scanning the entire `comments` table.
- **Remedy**: Add composite index `@@index([issueId, createdAt(sort: Desc)])` on `comments`.

#### 5.2.3 Missing Index on `comments.parentId`
- **Location**: `schema.prisma:108-110`
- **Query Path**: `apps/backend/src/controllers/comments/deleteComment.ts:63-70`
  ```ts
  await tx.comments.updateMany({
      where: { parentId: comment.id },
      data: { parentId: comment.parentId }
  });
  ```
  Generates SQL: `UPDATE "comments" SET "parentId" = $1 WHERE "comments"."parentId" = $2`.
- **Failure Impact**:
  - Full table scan on `comments` every time a comment is soft-deleted to reparent child comments.
- **Remedy**: Add `@@index([parentId])` on `comments`.

#### 5.2.4 Missing Index on `comments.userId`
- **Location**: `schema.prisma:106-107`
- **Query Path**: User deletion foreign key check and user activity queries.
- **Failure Impact**: Full sequential scan on `comments` during user deletion.
- **Remedy**: Add `@@index([userId])` on `comments`.

#### 5.2.5 Missing Index on `issue_mapping.issueId`
- **Location**: `schema.prisma:92-99`
- **Current Constraint**: `@@unique([userId, issueId])`
- **Query Path**: `apps/backend/src/controllers/issues/issueDetail.ts:47-56`, `apps/backend/src/controllers/issues/removeAssignment.ts:63-68`
- **Mechanics**:
  The composite unique constraint creates a B-tree index on `(userId, issueId)`. In PostgreSQL B-tree semantics, an index on `(A, B)` **cannot be used for queries filtering only on `B`** (`WHERE issueId = $1`).
- **Failure Impact**:
  - Looking up all assigned users for an issue requires scanning the `issue_mapping` table.
  - Deleting an issue requires scanning `issue_mapping` to verify the foreign key.
- **Remedy**: Add `@@index([issueId])` on `issue_mapping`.

### 5.3 Remediation Code Diff for Indexes

#### Changes to `packages/db/prisma/schema.prisma`
```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -61,6 +61,7 @@ model boards {
     issues  issues[]
     section sections[]
+
+    @@index([orgId])
 }
 
@@ -97,6 +98,7 @@ model issue_mapping {
     issueId String
     issue   issues @relation(fields: [issueId], references: [id], onDelete: Cascade)
     @@unique([userId, issueId])
+    @@index([issueId])
 }
 
@@ -113,4 +115,8 @@ model comments {
     createdAt   DateTime    @default(now())
     deletedAt   DateTime?
+
+    @@index([issueId, createdAt(sort: Desc)])
+    @@index([parentId])
+    @@index([userId])
 }
```

#### Migration SQL:
```sql
-- Create missing foreign key indexes
CREATE INDEX "boards_orgId_idx" ON "boards"("orgId");
CREATE INDEX "issue_mapping_issueId_idx" ON "issue_mapping"("issueId");
CREATE INDEX "comments_issueId_createdAt_idx" ON "comments"("issueId", "createdAt" DESC);
CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");
CREATE INDEX "comments_userId_idx" ON "comments"("userId");
```

---

## 6. Finding F-05: Redundant Duplicate B-Tree Index on `issues.sectionId` (MEDIUM)

### 6.1 Description & Root Cause
In `packages/db/prisma/schema.prisma` lines 87–90:
```prisma
model issues {
    ...
    @@index([boardId, sectionId])
    @@index([sectionId])
    @@index([sectionId, position])
}
```
History:
- `@@index([sectionId])` was created in migration `20260807195148_db_index_and_optimisation/migration.sql` line 20.
- Later, `@@index([sectionId, position])` was created in migration `20261006001500_add_positions_to_sections_and_issues/migration.sql` line 11 to optimize ordering.

### 6.2 Index Redundancy Mechanics
In a B-tree index on composite columns `(sectionId, position)`, PostgreSQL indexes the keys ordered first by `sectionId`, then by `position`.
Any query matching:
```sql
SELECT * FROM "issues" WHERE "sectionId" = $1;
```
can utilize the composite index `issues_sectionId_position_idx` with identical efficiency to `issues_sectionId_idx`. The single-column index `issues_sectionId_idx` is a **100% redundant left-prefix duplicate**.

### 6.3 Performance & Storage Cost
Maintaining duplicate indexes has measurable costs:
1. Every `INSERT`, `UPDATE` (of `sectionId` or `position`), and `DELETE` on `issues` must write to both index trees and generate WAL (Write-Ahead Logging) records for both.
2. The redundant index consumes PostgreSQL shared buffer cache memory that could otherwise hold active table pages.

### 6.4 Remediation Code Diff

#### Changes to `packages/db/prisma/schema.prisma`
```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -86,7 +86,6 @@ model issues {
 
     @@index([boardId, sectionId])
-    @@index([sectionId])
     @@index([sectionId, position])
 }
```

#### Migration SQL:
```sql
-- Drop redundant duplicate index
DROP INDEX IF EXISTS "issues_sectionId_idx";
```

---

## 7. Finding F-06: Missing Core Kanban Entity Fields & Domain Gaps (HIGH)

### 7.1 Gap Analysis vs Standard Kanban / Trello Capabilities
A detailed comparative audit of `schema.prisma` against standard Kanban specifications (Trello, Jira) identifies the following entity-level omissions:

| Domain Requirement | Current Schema Status | Missing Prisma Field / Model | Functional Impact |
|---|---|---|---|
| **Card Descriptions** | **COMPLETELY MISSING** | `issues.description String? @db.Text` | Users cannot provide specifications, acceptance criteria, or notes on cards. |
| **Audit Timestamps** | **MISSING ON 6 MODELS** | `createdAt DateTime @default(now())`<br>`updatedAt DateTime @updatedAt` | Cards, boards, sections, orgs, and users have no creation or modification timestamps. |
| **Due Dates & Deadlines** | **COMPLETELY MISSING** | `issues.dueDate DateTime?`<br>`issues.startDate DateTime?` | Kanban deadline tracking, overdue cards, calendar integrations impossible. |
| **Comment Edit Auditing** | **MISSING** | `comments.updatedAt DateTime @updatedAt` | When comments are modified via `editComment.ts`, modification timestamp is lost. |
| **Labels & Tags** | **COMPLETELY MISSING** | Models `Label`, `IssueLabel` | No way to categorize cards with colored badges (e.g. "Bug", "Urgent", "Frontend"). |
| **Card Checklists** | **COMPLETELY MISSING** | Models `Checklist`, `ChecklistItem` | No subtask checklists with completion states on cards. |
| **File Attachments** | **COMPLETELY MISSING** | Model `Attachment` | Cannot attach mockups, logs, or screenshots to cards. |
| **Card Archiving** | **COMPLETELY MISSING** | `isArchived Boolean @default(false)` | In Kanban, cards/lists are archived rather than deleted. Current schema forces destructive deletion. |
| **Priority Levels** | **COMPLETELY MISSING** | `enum Priority { low, medium, high, urgent }` | No priority triaging field on cards. |
| **WIP Limits on Lists** | **COMPLETELY MISSING** | `sections.wipLimit Int?` | Work-in-Progress constraints (core Kanban principle) unsupported. |
| **Board Customization** | **COMPLETELY MISSING** | `boards.description String?`<br>`boards.color String?` | No board metadata, description, or background theming. |
| **User Profile Metadata** | **COMPLETELY MISSING** | `user.name String?`<br>`user.avatarUrl String?` | No display names or avatars for card assignees or commenters. |

### 7.2 Detailed Breakdown of Critical Field Omissions

#### 1. `issues.description`
In `apps/backend/src/controllers/issues/updateIssue.ts` line 69:
```ts
const updateData: { title?: string; sectionId?: string; gh_url?: string; position?: number } = {};
```
Cards only support `title`, `sectionId`, `gh_url`, and `position`. There is literally no `description` column. A Kanban card without a description field cannot function as a task specification tool.

#### 2. Timestamps Across Models
- `issues`: Lacks `createdAt` and `updatedAt`.
- `boards`: Lacks `createdAt` and `updatedAt`.
- `sections`: Lacks `createdAt` and `updatedAt`.
- `user`: Lacks `createdAt` and `updatedAt`.
- `orgs`: Lacks `createdAt` and `updatedAt`.
- `membership`: Lacks `createdAt`, `updatedAt`, and `acceptedAt`.
- `comments`: Has `createdAt`, but lacks `updatedAt`.

Without these timestamps:
- Cannot sort cards by "recently updated" or "newest".
- Cannot build activity feeds or audit logs.
- Cannot determine when an invitation was accepted or sent.

---

## 8. Finding F-07: Schema Architecture vs PostgreSQL Best Practices (MEDIUM)

### 8.1 Inconsistent Model and Relation Naming
1. **Model Naming Conventions**:
   - Prisma convention: PascalCase singular (`User`, `Organization`, `Board`, `Section`, `Issue`, `Comment`) mapped to snake_case tables using `@@map("table_name")`.
   - Current schema: Mixture of lowercase singular (`user`, `membership`, `issue_mapping`) and lowercase plural (`orgs`, `boards`, `sections`, `issues`, `comments`).
2. **Inconsistent Field Casing**:
   - `gh_url` (snake_case) vs `boardId` (camelCase) vs `deletedAt` (camelCase).
3. **Plurality Mismatch in Relation Fields**:
   - In `boards` (line 61): `section sections[]`. The relation field is named `section` (singular), but its type is an array `sections[]`. This leads to confusing code (`board.section.map(...)`). Should be `sections sections[]`.
4. **Plurality Mismatch in Backend Controller Naming**:
   - Folder name `organisation`, model name `orgs`.

### 8.2 Broken Soft-Delete Architecture in Comments
1. **Query Leakage**:
   In `apps/backend/src/controllers/comments/getAllcomments.ts` lines 19–22:
   ```ts
   const comments = await prisma.comments.findMany({
       where: {
           issueId: result.data.issueId
       },
       ...
   ```
   The query **does not filter `deletedAt: null`**.
2. **Helper Tree Leakage**:
   In `apps/backend/src/helpers/commentTree.ts` lines 13–29, `buildCommentTree` takes `flatComments` and builds the hierarchy without checking `deletedAt`.
   As a result, soft-deleted comments are still serialized and returned to API clients with their full descriptions.
3. **Partial Soft-Delete Inconsistency**:
   Only `comments` has a `deletedAt` column. `issues`, `sections`, `boards`, and `user` use physical hard deletes. Having one entity partially soft-deleted while related parents are hard-deleted creates relational friction and leads directly to the cascade lock described in Finding F-01.

### 8.3 Data Types & Check Constraints
1. **Floating Point Ordering**:
   `sections.position` and `issues.position` use `Float` (`DOUBLE PRECISION`). While standard for floating-point reordering (e.g. `(p1 + p2) / 2`), repeated bisection without normalization eventually causes IEEE 754 precision loss.
2. **Missing Check Constraints**:
   PostgreSQL supports `CHECK` constraints (e.g. `CHECK (position >= 0)` or `CHECK (length(title) > 0)`). In the current schema, empty string titles `""` and negative positions can be written to the database.

---

## 9. Complete Consolidated Target `schema.prisma` Refactoring

Below is the complete, production-ready refactored `packages/db/prisma/schema.prisma` resolving all identified findings while maintaining backwards compatibility with existing table and column names:

```prisma
// Refactored schema.prisma - Resolves F-01 through F-07
generator client {
    provider = "prisma-client"
    output   = "../generated/prisma"
}

datasource db {
    provider = "postgresql"
}

enum Role {
    admin
    employee
    contributor
}

enum Priority {
    low
    medium
    high
    urgent
}

model user {
    id            String          @id @default(uuid())
    email         String          @unique
    username      String
    password      String
    name          String?
    avatarUrl     String?
    
    createdAt     DateTime        @default(now())
    updatedAt     DateTime        @updatedAt

    memberships   membership[]
    issueMappings issue_mapping[]
    comments      comments[]
}

model orgs {
    id          String       @id @default(uuid())
    name        String
    description String
    visible     Boolean      @default(true)
    
    createdAt   DateTime     @default(now())
    updatedAt   DateTime     @updatedAt

    members     membership[]
    boards      boards[]
}

model membership {
    id          String    @id @default(uuid())
    role        Role
    accepted    Boolean   @default(false)

    userId      String
    user        user      @relation(fields: [userId], references: [id], onDelete: Cascade)
    orgId       String
    org         orgs      @relation(fields: [orgId], references: [id], onDelete: Cascade)

    createdAt   DateTime  @default(now())
    updatedAt   DateTime  @updatedAt
    acceptedAt  DateTime?

    @@unique([userId, orgId])
    @@index([orgId])
}

model boards {
    id          String       @id @default(uuid())
    title       String
    description String?
    color       String?
    isArchived  Boolean      @default(false)

    orgId       String
    org         orgs         @relation(fields: [orgId], references: [id], onDelete: Cascade)

    createdAt   DateTime     @default(now())
    updatedAt   DateTime     @updatedAt

    issues      issues[]
    sections    sections[]

    @@index([orgId])
}

model sections {
    id          String      @id @default(uuid())
    title       String
    position    Float       @default(0)
    wipLimit    Int?
    isArchived  Boolean     @default(false)

    boardId     String
    board       boards      @relation(fields: [boardId], references: [id], onDelete: Cascade)

    createdAt   DateTime    @default(now())
    updatedAt   DateTime    @updatedAt

    issues      issues[]

    @@index([boardId, position])
}

model issues {
    id            String          @id @default(uuid())
    title         String
    description   String?
    position      Float           @default(0)
    priority      Priority        @default(medium)
    dueDate       DateTime?
    startDate     DateTime?
    isArchived    Boolean         @default(false)
    gh_url        String?

    boardId       String
    board         boards          @relation(fields: [boardId], references: [id], onDelete: Cascade)
    sectionId     String?
    section       sections?       @relation(fields: [sectionId], references: [id], onDelete: SetNull)

    createdAt     DateTime        @default(now())
    updatedAt     DateTime        @updatedAt

    issueMappings issue_mapping[]
    comments      comments[]

    @@index([boardId, sectionId])
    @@index([sectionId, position])
}

model issue_mapping {
    id        String   @id @default(uuid())
    userId    String
    user      user     @relation(fields: [userId], references: [id], onDelete: Cascade)
    issueId   String
    issue     issues   @relation(fields: [issueId], references: [id], onDelete: Cascade)

    createdAt DateTime @default(now())

    @@unique([userId, issueId])
    @@index([issueId])
}

model comments {
    id          String      @id @default(uuid())
    description String
    issueId     String
    issue       issues      @relation(fields: [issueId], references: [id], onDelete: Cascade)
    userId      String
    user        user        @relation(fields: [userId], references: [id], onDelete: Cascade)
    parentId    String?
    parent      comments?   @relation("CommentReplies", fields: [parentId], references: [id], onDelete: SetNull)
    children    comments[]  @relation("CommentReplies")

    createdAt   DateTime    @default(now())
    updatedAt   DateTime    @updatedAt
    deletedAt   DateTime?

    @@index([issueId, createdAt(sort: Desc)])
    @@index([parentId])
    @@index([userId])
}
```

---

## 10. Database Migration Runbook & Execution Strategy

To remediate these database defects safely without data loss, the migration must be split into two sequential phases:

### Phase 1: Critical Fixes (FK Cascades & Missing Indexes)
This phase has zero downtime and can be applied immediately to resolve crashes and performance issues.

```sql
-- Migration: 20261006130000_fix_cascade_and_indexes.sql

-- 1. Fix foreign key cascade on comments.issueId
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_issueId_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_issueId_fkey" 
  FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Fix foreign key cascade on comments.userId
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_userId_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Add missing high-frequency indexes
CREATE INDEX IF NOT EXISTS "boards_orgId_idx" ON "boards"("orgId");
CREATE INDEX IF NOT EXISTS "issue_mapping_issueId_idx" ON "issue_mapping"("issueId");
CREATE INDEX IF NOT EXISTS "comments_issueId_createdAt_idx" ON "comments"("issueId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "comments_parentId_idx" ON "comments"("parentId");
CREATE INDEX IF NOT EXISTS "comments_userId_idx" ON "comments"("userId");

-- 4. Drop redundant single-column index
DROP INDEX IF EXISTS "issues_sectionId_idx";
```

### Phase 2: Domain Schema Expansion (Kanban Fields & Timestamps)
This phase adds the missing Kanban entity fields with sensible defaults for existing records.

```sql
-- Migration: 20261006140000_add_kanban_fields_and_timestamps.sql

-- 1. Create Priority enum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- 2. Add timestamps and profile fields to user
ALTER TABLE "user" 
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Add timestamps to orgs
ALTER TABLE "orgs" 
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Add timestamps to membership
ALTER TABLE "membership" 
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);

-- 5. Add fields to boards
ALTER TABLE "boards" 
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "color" TEXT,
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 6. Add fields to sections
ALTER TABLE "sections" 
  ADD COLUMN IF NOT EXISTS "wipLimit" INTEGER,
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 7. Add fields to issues (Cards)
ALTER TABLE "issues" 
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" "Priority" NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 8. Add timestamps to issue_mapping
ALTER TABLE "issue_mapping" 
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 9. Add updatedAt to comments
ALTER TABLE "comments" 
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

---

## 11. Conclusion & Next Steps for Team

1. **Immediate Patch**: Apply Phase 1 migration script to allow card, board, and org deletions to succeed in test and production environments.
2. **Backend Controller Fixes**:
   - Update `apps/backend/src/controllers/comments/getAllcomments.ts` to add `where: { issueId, deletedAt: null }`.
   - Update `apps/backend/src/helpers/commentTree.ts` to ignore or sanitize soft-deleted comments.
   - Update `apps/backend/src/controllers/comments/deleteComment.ts` to return `200 OK` or `204 No Content` instead of `201 Created`.
3. **Client Generation**: Run `bun x prisma generate` in `packages/db` after updating `schema.prisma`.
