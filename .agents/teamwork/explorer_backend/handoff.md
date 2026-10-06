# Backend API Technical Audit Handoff Report

## 1. Observation

Direct code observations from `apps/backend` and related files:

1. **Parameter Mismatch in `issueDetail.ts`**:
   - `apps/backend/src/routes/routes.ts`: Line 143 declares `app.get("/api/cards/:id", asyncHandler(issueDetail));`.
   - `apps/backend/src/controllers/issues/issueDetail.ts`: Lines 8–15 declare:
     ```typescript
     const result = zod.object({
         issueId: zod.uuid()
     }).safeParse(req.params);
     if (!result.success) throw new ValidationError();
     ```
   - In contrast, `updateIssue.ts` line 9 and `deleteIssue.ts` line 9 both use:
     ```typescript
     const issueIdParam = req.params.issueId ?? req.params.cardId ?? req.params.id;
     ```

2. **Missing Board `id` in `getAllBoards`**:
   - `apps/backend/src/controllers/board/getBoards.ts`: Lines 23–32 state:
     ```typescript
     boards: {
         select: {
             title: true,
             _count: {
                 select: {
                     issues: true
                 }
             }
         }
     }
     ```
   - Board primary key `id` is omitted from the selection.
   - `apps/backend/src/controllers/board/getaBoard.ts`: Lines 18–36 also omit `id: true` for the board itself.

3. **404 Response and Deferred Auth in `getAllComments`**:
   - `apps/backend/src/controllers/comments/getAllcomments.ts`: Lines 60–61 state:
     ```typescript
     if (comments.length===0) throw new Not_Found("Comments not found");
     if (comments[0]!.issue.board.org.members.length === 0) throw new Forbidden("Members only");
     ```
   - `tests/comments/get_comments.ts`: Lines 79–86 explicitly test for 404 on empty issues:
     ```typescript
     it("Fails with 404 when issue has no comments", async () => { ... expect(res.status).toBe(404); });
     ```

4. **Self-Update Failure and Unchecked Demotion in `updateRoleHandler`**:
   - `apps/backend/src/controllers/organisation/updateRole.ts`: Lines 15, 45–60 state:
     ```typescript
     role: zod.enum(["admin", "employee"])
     ...
     org.members.forEach(x => {
         if (x.userId === req.id && x.role === "admin") admin = true;
         else if (x.user.email == result2.data.email) {
             user_found = true;
             userId = x.userId;
             if (x.role == result2.data.role)
                 throw new Duplicate(`User already ${x.role}`)
         }
     })
     if (!admin) throw new Forbidden("Admin access required");
     if (!user_found) throw new Not_Found("User not a member");
     ```
   - `packages/db/prisma/schema.prisma`: Lines 15–19 declare `enum Role { admin, employee, contributor }`.

5. **Missing `accepted: true` in `UpdateOrgHandler`**:
   - `apps/backend/src/controllers/organisation/updateDetails.ts`: Lines 24–29 state:
     ```typescript
     members: {
         where: {
             userId: req.id,
             role: "admin"
         }
     }
     ```
   - Contrast with `deteleOrg.ts` line 25: `role: "admin", accepted: true`.

6. **Database Foreign Key Cascade Omission on Comments**:
   - `packages/db/prisma/schema.prisma`: Line 105 states:
     ```prisma
     issue issues @relation(fields: [issueId], references: [id])
     ```
   - Lacks `onDelete: Cascade`.

7. **Missing WebSocket Broadcast Triggers**:
   - `apps/backend/src/controllers/board/renameBoard.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/board/deleteBoard.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/issues/assignIssue.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/issues/removeAssignment.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/comments/addComment.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/comments/editComment.ts`: No import or call to `wsBroadcaster`.
   - `apps/backend/src/controllers/comments/deleteComment.ts`: No import or call to `wsBroadcaster`.

---

## 2. Logic Chain

1. **Parameter Mismatch**:
   - From Observation 1, route `/api/cards/:id` provides `req.params.id`.
   - `issueDetail` expects `req.params.issueId`.
   - Because `req.params.issueId` is undefined, `zod.uuid()` validation fails.
   - `ValidationError` is thrown, producing HTTP 400 Bad Request instead of returning the card details.

2. **Missing Board ID**:
   - From Observation 2, `getAllBoards` projects only `title` and `_count`.
   - The response omits the `id` property.
   - Frontend components require board `id` to construct routing URLs, join real-time WebSocket rooms, and invoke board mutations. All board interactions fail as a consequence.

3. **Comment Empty State and Authorization Bypass**:
   - From Observation 3, when a newly created issue has 0 comments, line 60 executes before line 61.
   - The server throws `Not_Found` (HTTP 404). Clients cannot render empty comment threads.
   - If an unauthorized user queries an arbitrary issue ID:
     - 0 comments -> returns HTTP 404.
     - >= 1 comments -> reaches line 61 and returns HTTP 403.
   - This discrepancy acts as an enumeration oracle revealing the existence and activity of cards across organizations.

4. **Role Management Flaws**:
   - From Observation 4, the `if ... else if ...` construct means if `x.userId === req.id` matches, the `else if` is bypassed.
   - When an admin attempts to update their own role, `user_found` remains false, triggering an incorrect 404 "User not a member".
   - Demoting an admin does not check `org._count.members` (unlike `deleteUserHandler`), allowing an organization's last admin to be demoted, causing permanent administrative lockout.
   - `"contributor"` is omitted from the Zod enum despite existing in the database schema, preventing demotion of members back to contributor.

5. **Organization Update Authorization Bypass**:
   - From Observation 5, `UpdateOrgHandler` does not require `accepted: true`.
   - An unaccepted invitee with pending admin status can call `PUT /api/orgs/:orgId` and mutate organization details.

6. **Cascade Delete Failures on Comments**:
   - From Observation 6, deleting a board or card cascade deletes issues, but PostgreSQL restricts deletion of issues referenced by `comments.issueId`.
   - Calls to `deleteBoard` or `deleteIssue` on resources with comments crash with an unhandled 500 foreign key violation.

7. **Real-Time Synchronization Incompleteness**:
   - From Observation 7, mutations for board rename, board deletion, user assignments, and comments omit `wsBroadcaster` calls.
   - Collaborating clients viewing the board do not receive real-time updates for these events.

---

## 3. Caveats

- **Runtime Execution**: The PostgreSQL database instance was not running during the test suite execution, causing integration tests (`fetch` to `localhost:3000`) to fail with `ConnectionRefused`. However, all 55 isolated unit tests (`tests/unit/*`) passed cleanly (`bun test tests/unit`).
- **Read-Only Inspection**: In accordance with the Explorer archetype rules, no source files were directly modified in the codebase; all remediation proposals are supplied as concrete diffs in `analysis.md`.

---

## 4. Conclusion

The audit identified critical vulnerabilities and functional flaws in `apps/backend`:
- 2 Critical vulnerabilities (comment empty state / auth leak side-channel; last admin lockout & broken self-update).
- 4 High severity defects (route parameter mismatch on `/api/cards/:id`; missing board `id` in list projections; pending invitee authorization bypass in `UpdateOrgHandler`; missing database cascade deletion on comments).
- 4 Medium severity issues (user enumeration on login; self-invite 500 crash in `addUser`; missing org entity data in `getCurrentOrgs`; 24h admin comment moderation lockout).
- Multiple WebSocket broadcast gaps across boards, assignments, and comments.

All findings are fully documented with reproduction steps and code diffs in:
`/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_backend/analysis.md`

---

## 5. Verification Method

1. **Verify Unit Tests**:
   ```bash
   cd /Users/deep/Desktop/Padhayi/DEV/Projects/trello/apps/backend
   bun test tests/unit
   ```
2. **Inspect Audit Report and Code Diffs**:
   Inspect `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_backend/analysis.md` to review the line numbers and diffs.
3. **Invalidation Conditions**:
   - If `issueDetail.ts` is updated to read `req.params.id`, `GET /api/cards/:id` will no longer fail with 400.
   - If `getBoards.ts` selects `id: true`, board responses will contain the board primary key.
   - If `getAllcomments.ts` verifies membership before querying comments and returns `[]` on empty results, card comment sections will load with 200 OK.
