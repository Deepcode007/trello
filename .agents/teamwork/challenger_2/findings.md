# Adversarial Findings Report: WebSocket Real-Time Synchronization Layer & Kanban Domain Parity

**Auditor / Role**: Challenger 2 (`teamwork_preview_challenger` / Empirical Challenger)  
**Target Document**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md`  
**Working Directory**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/challenger_2`  
**Date**: October 2026  
**Status**: Completed Empirical Verification  

---

## Executive Summary & Adversarial Verdict

An exhaustive empirical challenge was conducted against the findings, architecture claims, and remediation roadmap in `AUDIT_REPORT.md` (specifically focusing on Section 4: WebSocket Synchronization, Section 5: Kanban Domain & Feature Comparison, and Section 6: Remediation Roadmap).

### Core Verdict
1. **Mutation Broadcast Coverage Matrix**: While the 12 silent mutations cited in `AUDIT_REPORT.md` are genuine omissions, the claim that the backend contains *"exactly 18 mutating endpoints with 12 silent"* is **empirically false**. An automated ast/code scan of all 34 controller files in `apps/backend/src/controllers` identified **22 mutating endpoints** in total. The report missed **4 additional unbroadcast mutations**, including `organisation/deteleOrg.ts` (cascading deletion of an entire organization and all its boards) and `organisation/acceptInvite.ts`.
2. **Defective Remediation Diffs in Finding WS-01**: The proposed patch diffs for `assignIssue.ts` and `addComment.ts` (and by extension `removeAssignment.ts`, `editComment.ts`, and `deleteComment.ts`) contain a **critical runtime defect**. The controllers' Prisma queries select only `board: { select: { org: ... } }`. Neither `issue.board.id` nor `issue.boardId` is fetched. At runtime, evaluating `issue.board.id` yields `undefined`, causing `wsBroadcaster.broadcast` to reject the call and silently fail.
3. **Non-Functional Member Eviction Proposal in Finding WS-02**: The proposed fix for "Zombie Subscriptions" instructs `removeUser.ts` to call `wsBroadcaster.broadcast("org_" + orgId, ...)`. Empirically verified, `formatBoardTopic` prefixes this to `"board_org_<orgId>"`. Connected WebSocket clients subscribe strictly to `"board_<boardId>"`. No socket is subscribed to `"board_org_<orgId>"`, and the Bun WebSocket server lacks any connection lookup map (`userId -> Set<ServerWebSocket>`) to evict sockets based on pub/sub messages. The proposed patch does not terminate zombie connections.
4. **Internal Self-Contradiction in Consolidated Target Schema**: In Finding DB-03, the report argues that `issues.sectionId` must be non-nullable (`String`) with `onDelete: Cascade` to eliminate orphan/ghost cards. However, in Section 6 ("Consolidated Target `packages/db/prisma/schema.prisma`", lines 1210–1211), the report's target schema re-introduces `sectionId String?` and `onDelete: SetNull`, directly resurrecting the high-severity defect it claimed to fix.
5. **Domain Gap Roadmap Deficiencies**: The report identifies Checklists, Labels, and Activity Logs as mandatory for Trello parity, yet completely omits these models from the Consolidated Target Schema. The roadmap proposes a "Transactional Outbox Pattern" in Phase 3 without defining an `outbox` model or board sequence counters in the target schema. Phase 2 migrations introduce fields on `issues` that the existing backend controllers immediately strip or reject via Zod schemas, creating schema drift.

---

## 1. Adversarial Challenge: Backend Mutation Enumeration & Broadcast Coverage

### Challenge 1.1: Undercount of Backend Mutations (22 Mutating Endpoints vs 18 Claimed)
- **Report Claim (AUDIT_REPORT.md lines 790–792)**:
  > *"The application features 18 distinct data-mutating endpoints. Only 6 trigger WebSocket events (createSection, renameSection, deleteSection, createIssue, updateIssue, deleteIssue). Exactly 12 core backend mutations execute database writes in complete silence, triggering zero WebSocket events"*
- **Empirical Investigation**:
  An automated AST and keyword scan of all 34 controller files in `apps/backend/src/controllers` was conducted:
  - 6 controllers invoke `wsBroadcaster`:
    1. `sections/createSection.ts` (`.create`)
    2. `sections/renameSection.ts` (`.update`)
    3. `sections/deleteSection.ts` (`.updateMany`, `.delete`)
    4. `issues/createIssue.ts` (`.create`)
    5. `issues/updateIssue.ts` (`.update`)
    6. `issues/deleteIssue.ts` (`.delete`)
  - **16 controllers mutate database state without calling `wsBroadcaster`** (not 12):
    1. `board/createBoard.ts` (`.create`)
    2. `board/renameBoard.ts` (`.update`)
    3. `board/deleteBoard.ts` (`.delete`)
    4. `issues/assignIssue.ts` (`.createMany`)
    5. `issues/removeAssignment.ts` (`.delete`)
    6. `comments/addComment.ts` (`.create`)
    7. `comments/editComment.ts` (`.update`)
    8. `comments/deleteComment.ts` (`.updateMany`, `.update`)
    9. `organisation/addUser.ts` (`.create`)
    10. `organisation/removeUser.ts` (`.delete`)
    11. `organisation/updateRole.ts` (`.update`)
    12. `organisation/updateDetails.ts` (`.update`)
    13. **`organisation/deteleOrg.ts`** (`.deleteMany`) — **OMITTED IN AUDIT REPORT**
    14. **`organisation/acceptInvite.ts`** (`.update`) — **OMITTED IN AUDIT REPORT**
    15. **`organisation/Create.ts`** (`.create`) — **OMITTED IN AUDIT REPORT**
    16. **`signupHandler.ts`** (`.create`) — **OMITTED IN AUDIT REPORT**
- **Blast Radius of Omissions**:
  - `organisation/deteleOrg.ts` (`DELETE /api/orgs/:orgId`): When an organization is deleted, PostgreSQL cascades deletion down through `orgs -> boards -> sections -> issues -> comments`. All boards within that organization are permanently deleted. Because `deteleOrg.ts` emits zero WebSocket broadcasts, every connected user actively collaborating on any board in that organization remains stranded in the deleted room.
  - `organisation/acceptInvite.ts` (`PUT /api/orgs/:orgId/accept`): Updates `membership.accepted` to `true`. Zero broadcasts are emitted. Collaborators viewing organization member directories or board permissions do not see the pending user transition to active without a full page refresh.

---

### Challenge 1.2: Runtime Projection Failure in Proposed WS-01 Remediation Diffs
- **Report Claim (AUDIT_REPORT.md lines 867, 893)**:
  The report provides recommended patches for missing broadcasts:
  ```diff
  // assignIssue.ts patch:
  + wsBroadcaster.broadcast(issue.board.id ?? issue.boardId, {
  +     type: "card:member_assigned",
  ...
  // addComment.ts patch:
  + wsBroadcaster.broadcast(issue.board.id, {
  +     type: "comment:created",
  ```
- **Empirical Verification**:
  Let us inspect the Prisma query selections in `apps/backend/src/controllers/issues/assignIssue.ts` (lines 22–46):
  ```typescript
  const issue = await prisma.issues.findUnique({
      where: { id: result.data.issueId },
      select: {
          board: {
              select: {
                  org: {
                      select: {
                          id: true,
                          members: { where: { userId: req.id, ... } }
                      }
                  }
              }
          }
      }
  });
  ```
  And in `apps/backend/src/controllers/comments/addComment.ts` (lines 23–49):
  ```typescript
  const issue = await prisma.issues.findUnique({
      where: { id: result.data.issueId },
      select: {
          id: true,
          comments: { where: { id: result2.data.parentId } },
          board: {
              select: {
                  org: {
                      select: {
                          members: { where: { userId: req.id, accepted: true } }
                      }
                  }
              }
          }
      }
  });
  ```
  Notice:
  1. In `assignIssue.ts`, `issue.board` selects **only `org`**. `issue.board.id` is `undefined`. `issue.boardId` is `undefined`.
  2. In `addComment.ts`, `issue.board` selects **only `org`**. `issue.board.id` is `undefined`.
  3. Execution test in Bun:
     ```typescript
     const boardIdInPatch = (issue as any).board.id ?? (issue as any).boardId;
     // Evaluates to: undefined
     wsBroadcaster.broadcast(boardIdInPatch, ...);
     // broadcaster.ts line 97: if (!boardId || typeof boardId !== "string") return false;
     // Evaluates to: returns false without broadcasting!
     ```
  4. The same projection omission exists in `removeAssignment.ts`, `editComment.ts`, and `deleteComment.ts`.
- **Verdict**: The proposed code patches in `AUDIT_REPORT.md` are non-functional at runtime. To remediate, the Prisma queries must be updated to explicitly select `boardId: true` or `board: { select: { id: true, org: ... } }`.

---

### Challenge 1.3: Unbatched IPC Broadcast Storm in Section Deletion (`deleteSection.ts`)
- **Observation**:
  In `apps/backend/src/controllers/sections/deleteSection.ts` (lines 100–109):
  ```typescript
  if (targetSectionId && reassignedIssues.length > 0) {
      for (const issue of reassignedIssues) {
          wsBroadcaster.broadcastCardMoved(user.boardId, {
              cardId: issue.id,
              sourceList: result.data.sectionId,
              destList: targetSectionId,
              position: issue.position ?? 0
          });
      }
  }
  ```
- **Failure Mechanism**:
  When deleting a section containing 100 cards, the controller executes a synchronous `for` loop that fires 100 unawaited asynchronous HTTP POST requests to `http://127.0.0.1:3001/internal/broadcast` simultaneously.
- **Impact**:
  In a dual-process architecture, this unbatched loop triggers an IPC broadcast storm that exhausts connection pools, trips the 1000ms fetch timeout, and risks socket packet drops on the Bun WebSocket server.
- **Remediation**:
  Replace per-card move loops with a consolidated batch event:
  ```typescript
  wsBroadcaster.broadcast(user.boardId, {
      type: "list:deleted_with_reassignment",
      payload: {
          deletedListId: result.data.sectionId,
          targetListId: targetSectionId,
          cardIds: reassignedIssues.map(i => i.id)
      }
  });
  ```

---

## 2. Adversarial Challenge: Room Security & Connection Lifecycle (`apps/websockets`)

### Challenge 2.1: Flawed Topic Formatting in Member Eviction Proposal (Finding WS-02)
- **Report Claim (AUDIT_REPORT.md lines 925–933)**:
  To eliminate zombie sockets when a member is removed from an organization, `deleteUserHandler` should broadcast:
  ```typescript
  wsBroadcaster.broadcast(`org_${result.data.orgId}`, {
      type: "org:member_removed",
      payload: { userId: user_found.userId, orgId: result.data.orgId, action: "evict_user" }
  });
  ```
- **Empirical Verification**:
  1. Let us inspect `formatBoardTopic` in `apps/backend/src/services/broadcaster.ts` (lines 41–45):
     ```typescript
     export function formatBoardTopic(boardId: string): string {
         if (!boardId || typeof boardId !== "string" || !boardId.trim()) return "";
         const trimmed = boardId.trim();
         return trimmed.startsWith("board_") ? trimmed : `board_${trimmed}`;
     }
     ```
  2. Executing `formatBoardTopic("org_" + orgId)` produces: `"board_org_<orgId>"`.
  3. In `apps/websockets/src/server.ts` (lines 242–243), clients subscribe strictly to `"board_<boardId>"`.
  4. There are **no clients subscribed to `board_org_<orgId>`**.
  5. Furthermore, Bun's `server.publish(topic, payload)` merely publishes a message to sockets subscribed to `topic`. Calling `server.publish` on a topic **cannot disconnect or unsubscribe a socket listening to a different board room**.
  6. The WebSocket server maintains no global lookup map connecting `userId` to active `ServerWebSocket` instances.
- **Verdict**: The proposed diff in WS-02 broadcasts to a phantom channel and will evict zero connected sockets. A genuine eviction mechanism requires:
  - An in-memory connection registry in `apps/websockets`: `Map<string /* userId */, Set<ServerWebSocket<WebSocketData>>>`.
  - A dedicated HTTP IPC eviction endpoint: `POST /internal/evict-user { userId, orgId }` that iterates through matching sockets and calls `ws.close(4003, "Revoked")`.

---

### Challenge 2.2: Hardcoded Fallback Secret & Service Conflation (Findings WS-03 & WS-04)
- **Empirical Verification**:
  1. In `apps/websockets/src/types/env.ts` line 5:
     `jwt_key: zod.string().default("asdas"),`
  2. In `apps/websockets/index.ts` lines 5–13:
     ```typescript
     const result = envSchema.safeParse(process.env);
     const jwtSecret = WS_env.jwt_key;
     server = createWebSocketServer({ port, jwtSecret });
     ```
     When running `bun run index.ts` without an explicit `jwt_key`, `envSchema` populates `jwt_key` with `"asdas"`.
  3. In `apps/websockets/src/server.ts` lines 69–75:
     ```typescript
     const internalSecret = req.headers.get("x-internal-secret");
     if (jwtSecret && internalSecret !== jwtSecret) {
         return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), { status: 403 });
     }
     ```
  4. If `jwt_key` is default, an external attacker on the public internet can send `POST http://<host>:3001/internal/broadcast` with header `x-internal-secret: asdas` and inject arbitrary card moves, board deletions, or fake user actions into any board topic.
  5. If `jwtSecret` is empty, `jwtSecret && ...` evaluates to `false`, allowing unauthenticated IPC requests.
- **Verdict**: WS-03 and WS-04 are confirmed and validated.

---

### Challenge 2.3: Total Omission of Active WebSocket Token Expiry
- **Observation**:
  `apps/websockets/src/auth/authUpgrade.ts` verifies the JWT token **only during the initial HTTP upgrade handshake** (line 135).
  Once upgraded, the socket connection remains persistent:
  `ws.data = { userId, email, name, subscriptions, connectedAt }`
- **Failure Mechanism**:
  A client connection can remain open for days or weeks. Even after the user's JWT expires (e.g. 7-day token expiration), the WebSocket connection and all room subscriptions remain valid and continue receiving real-time data. If the user changes their password, logs out of the web application, or has their account suspended, active WebSocket sessions bypass all authentication controls.
- **Mitigation**:
  1. Attach `tokenExpiresAt: decoded.exp * 1000` to `WebSocketData`.
  2. Implement a periodic connection sweep or evaluate token expiry during inbound frame processing.
  3. Provide a client re-authentication frame (`{"action": "refresh_auth", "token": "..."}`).

---

### Challenge 2.4: Multi-Tab Presence Thrashing ("False Departure")
- **Observation**:
  In `apps/websockets/src/server.ts` line 325:
  When a WebSocket closes (`handleWebSocketClose`), the server broadcasts `user:left` to all subscribed board rooms.
- **Failure Mechanism**:
  If a user opens Board A in two separate browser tabs (Tab 1 and Tab 2), both sockets subscribe to `board_<boardId>`. When the user closes Tab 1, `handleWebSocketClose` executes and broadcasts `user:left` for that user's `userId`. Collaborators' screens render a notification that the user has left the board, even though the user remains actively viewing and editing the board in Tab 2.
- **Mitigation**:
  Track room presence using a connection reference count per `(userId, boardId)`:
  Only broadcast `user:left` when the user's active socket count for that board reaches 0.

---

### Challenge 2.5: Denial-of-Service via Uncapped Subscriptions & Frame Flooding
- **Observation**:
  In `apps/websockets/src/server.ts` lines 199–230:
  When a client sends `action: "join"`, the server calls `checkAccess(ws.data.userId, boardId)`, which executes a PostgreSQL query (`prisma.boards.findUnique`).
- **Vulnerability**:
  The WebSocket server implements **zero message rate limiting** and **zero subscription capacity limits**. A malicious client can send a tight loop of 5,000 `join` frames with random UUIDs. The server will execute 5,000 parallel database queries over Prisma, exhausting the database connection pool (default limit: 10 connections) and starving all backend REST API requests.
- **Mitigation**:
  Enforce a maximum of 20 active subscriptions per socket and throttle client messages to 10 frames per second.

---

## 3. Adversarial Challenge: Trello Feature Gap Analysis & Remediation Roadmap

### Challenge 3.1: Self-Contradiction Between Finding DB-03 and Consolidated Target Schema
- **The Contradiction**:
  - In `AUDIT_REPORT.md` Section 2, Finding DB-03 is titled:
    > *"Finding DB-03: Relational Ghost & Orphan Cards via `issues.sectionId` `onDelete: SetNull` (HIGH)"*
    The auditor states:
    > *"In schema.prisma line 83: `sectionId String?` ... `onDelete: SetNull` ... Cards are queried strictly nested inside section... If a section is deleted... sectionId is null... The card is completely absent from getBoardDetails... REMEDIATION: Change to `sectionId String` (non-nullable) and `onDelete: Cascade`."*
  - Now observe Section 6 ("Consolidated Target `packages/db/prisma/schema.prisma`"), lines 1210–1211:
    ```prisma
    model issues {
        ...
        sectionId     String?
        section       sections?       @relation(fields: [sectionId], references: [id], onDelete: SetNull)
        ...
    }
    ```
- **Impact**:
  The auditor's own target schema directly re-introduces the high-severity defect condemned in Finding DB-03. An engineer applying the consolidated target schema would unwittingly restore the orphan/ghost card bug.

---

### Challenge 3.2: Complete Omission of Claimed Domain Models in Target Schema
- **Observation**:
  In Section 5 ("Comparative Feature Parity Matrix"), the report rates Checklists (Dimension 2), Labels (Dimension 4), and Activity Logs (Dimension 5) as **COMPLETELY MISSING**.
  In Section 6 ("Phased Implementation Roadmap Phase 4"), the report mandates:
  > *"Add checklists, checklist_items, labels, and activity_logs models"*
- **Contradiction**:
  In the provided "Consolidated Target `packages/db/prisma/schema.prisma`" (lines 1090–1255), **not a single one of these models exists**. The schema contains only the original 7 models with a few scalar columns added to `issues`. The target schema does not resolve the Kanban domain modeling deficiencies identified in Section 5.

---

### Challenge 3.3: Unspecified Outbox Pattern Infrastructure
- **Observation**:
  Finding WS-06 and Roadmap Phase 3 mandate implementing the "Transactional Outbox Pattern" to ensure event delivery on restarts.
- **Deficiency**:
  The target schema provides no `outbox` model, no sequence counters on `boards`, and no transactional execution pattern for Express controllers.
  To implement a Transactional Outbox Pattern in PostgreSQL with Prisma:
  ```prisma
  model board_events {
      id          BigInt   @id @default(autoincrement())
      boardId     String
      sequence    BigInt
      eventType   String
      payload     Json
      createdAt   DateTime @default(now())
      publishedAt DateTime?

      @@index([boardId, sequence])
      @@index([publishedAt])
  }
  ```
  Omission of this model leaves Phase 3 without a database foundation.

---

### Challenge 3.4: Controller Schema Drift in Phase 2 Migration Runbook
- **Observation**:
  The Phase 2 Migration SQL Runbook (lines 1286–1345) adds `description`, `priority`, `dueDate`, `startDate`, and `isArchived` to the `issues` table.
- **Defect**:
  The existing controller schemas in `apps/backend/src/controllers/issues/createIssue.ts` and `updateIssue.ts` strictly define:
  ```typescript
  const result2 = zod.object({
      title: zod.string(),
      boardId: zod.uuid(),
      gh_url: zod.string().optional(),
      position: zod.number().optional()
  }).safeParse(req.body);
  ```
  If frontend clients attempt to write to these new columns, Express will strip or ignore them. Applying the database migration without simultaneous controller schema updates creates schema drift and fails to deliver card descriptions or due dates to users.

---

## 4. Comprehensive Mutation & Broadcast Coverage Matrix

Below is the verified, empirical coverage matrix across all 22 mutating endpoints in `apps/backend`:

| # | Controller File | HTTP Route | Mutating Operations | Status in AUDIT_REPORT.md | Actual Broadcast Status | Missing Broadcast Event |
|---|---|---|---|---|---|---|
| 1 | `board/createBoard.ts` | `POST /api/orgs/:orgId/boards` | `prisma.boards.create` | Documented Silent (#1) | **Silent** | `board:created` |
| 2 | `board/renameBoard.ts` | `PUT /api/boards/:boardId` | `prisma.boards.update` | Documented Silent (#2) | **Silent** | `board:updated` |
| 3 | `board/deleteBoard.ts` | `DELETE /api/boards/:boardId` | `prisma.boards.delete` | Documented Silent (#3) | **Silent** | `board:deleted` |
| 4 | `sections/createSection.ts` | `POST /api/boards/:boardId/sections` | `prisma.sections.create` | Documented Broadcasting | **Broadcasting** | `list:created` |
| 5 | `sections/renameSection.ts` | `PUT/PATCH /api/sections/:sectionId` | `prisma.sections.update` | Documented Broadcasting | **Broadcasting** | `list:updated`, `list:reordered` |
| 6 | `sections/deleteSection.ts` | `DELETE /api/sections/:sectionId` | `prisma.issues.updateMany`, `prisma.sections.delete` | Documented Broadcasting | **Broadcasting (Unbatched Storm)** | `list:deleted`, `card:moved` |
| 7 | `issues/createIssue.ts` | `POST /api/sections/:sectionId/issues` | `prisma.issues.create` | Documented Broadcasting | **Broadcasting** | `card:created` |
| 8 | `issues/updateIssue.ts` | `PUT/PATCH /api/issues/:issueId` | `prisma.issues.update` | Documented Broadcasting | **Broadcasting** | `card:moved`, `card:updated` |
| 9 | `issues/deleteIssue.ts` | `DELETE /api/issues/:issueId` | `prisma.issues.delete` | Documented Broadcasting | **Broadcasting** | `card:deleted` |
| 10 | `issues/assignIssue.ts` | `POST /api/issues/:issueId/assignees` | `prisma.issue_mapping.createMany` | Documented Silent (#4) | **Silent (Patch Broken)** | `card:member_assigned` |
| 11 | `issues/removeAssignment.ts` | `DELETE /api/issues/:issueId/assignees/` | `prisma.issue_mapping.delete` | Documented Silent (#5) | **Silent (Patch Broken)** | `card:member_unassigned` |
| 12 | `comments/addComment.ts` | `POST /api/issues/:issueId/comments` | `prisma.comments.create` | Documented Silent (#6) | **Silent (Patch Broken)** | `comment:created` |
| 13 | `comments/editComment.ts` | `PUT /api/comments/:commentId` | `prisma.comments.update` | Documented Silent (#7) | **Silent (Patch Broken)** | `comment:updated` |
| 14 | `comments/deleteComment.ts` | `DELETE /api/comments/:commentId` | `prisma.comments.updateMany`, `update` | Documented Silent (#8) | **Silent (Patch Broken)** | `comment:deleted` |
| 15 | `organisation/addUser.ts` | `POST /api/orgs/:orgId/members` | `prisma.membership.create` | Documented Silent (#9) | **Silent** | `org:member_invited` |
| 16 | `organisation/removeUser.ts` | `DELETE /api/orgs/:orgId/members` | `prisma.membership.delete` | Documented Silent (#10) | **Silent (Patch Broken)** | `org:member_removed` |
| 17 | `organisation/updateRole.ts` | `PUT /api/orgs/:orgId/members` | `prisma.membership.update` | Documented Silent (#11) | **Silent** | `org:role_updated` |
| 18 | `organisation/updateDetails.ts` | `PUT /api/orgs/:orgId` | `prisma.orgs.update` | Documented Silent (#12) | **Silent** | `org:updated` |
| 19 | **`organisation/deteleOrg.ts`** | `DELETE /api/orgs/:orgId` | `prisma.orgs.deleteMany` | **OMITTED** | **Silent** | `org:deleted` (cascading all boards) |
| 20 | **`organisation/acceptInvite.ts`** | `PUT /api/orgs/:orgId/accept` | `prisma.membership.update` | **OMITTED** | **Silent** | `org:member_accepted` |
| 21 | **`organisation/Create.ts`** | `POST /api/orgs` | `prisma.orgs.create` | **OMITTED** | **Silent** | `org:created` |
| 22 | **`signupHandler.ts`** | `POST /api/auth/signup` | `prisma.user.create` | **OMITTED** | **Silent** | N/A (User account creation) |

---

## 5. Summary of Recommended Patches to `AUDIT_REPORT.md`

1. **Update Mutation Inventory**: Amend Table 4 and Section 4 to state 22 mutating controllers in total, with 16 silent mutations (explicitly adding `deteleOrg.ts` and `acceptInvite.ts`).
2. **Correct Proposed Patch Diffs**:
   - In `assignIssue.ts`, expand `select` to include `boardId: true` on `issues`.
   - In `addComment.ts`, expand `select` to include `board: { select: { id: true, org: ... } }`.
   - In `removeAssignment.ts`, `editComment.ts`, and `deleteComment.ts`, ensure `boardId` is selected before invoking `wsBroadcaster.broadcast`.
3. **Correct Member Eviction Architecture**: Replace the phantom topic `"org_" + orgId` broadcast with a dedicated HTTP IPC eviction endpoint (`POST /internal/evict-user`) coupled with a WebSocket user-connection map.
4. **Reconcile Target Schema with Finding DB-03**: In Section 6, change `issues.sectionId` from `String?` / `onDelete: SetNull` to `String` / `onDelete: Cascade`.
5. **Include Core Domain Models in Target Schema**: Add models for `checklists`, `checklist_items`, `labels`, and `activity_logs`.
6. **Define Outbox Model**: Add `board_events` outbox model in Section 6 to substantiate Phase 3.
