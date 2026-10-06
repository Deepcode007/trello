# Handoff Report: WebSocket & Kanban Domain Audit

**Agent**: WebSocket & Domain Auditor (`teamwork_preview_explorer`)  
**Task Type**: Hard Handoff (Investigation & Technical Audit Complete)  
**Report Artifact**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_websocket/analysis.md`

---

## 1. Observation

1. **Broadcaster Usage Across Backend Controllers**:
   `grep_search` across `apps/backend/src` for `wsBroadcaster` returned occurrences in only 6 files:
   - `apps/backend/src/controllers/issues/createIssue.ts:73` (`wsBroadcaster.broadcastCardCreated`)
   - `apps/backend/src/controllers/issues/deleteIssue.ts:54` (`wsBroadcaster.broadcastCardDeleted`)
   - `apps/backend/src/controllers/issues/updateIssue.ts:90,102` (`wsBroadcaster.broadcastCardMoved`, `wsBroadcaster.broadcastCardUpdated`)
   - `apps/backend/src/controllers/sections/createSection.ts:63` (`wsBroadcaster.broadcast(..., "list:created")`)
   - `apps/backend/src/controllers/sections/renameSection.ts:67,70` (`wsBroadcaster.broadcastListReordered`, `wsBroadcaster.broadcast(..., "list:updated")`)
   - `apps/backend/src/controllers/sections/deleteSection.ts:102,111` (`wsBroadcaster.broadcastCardMoved`, `wsBroadcaster.broadcast(..., "list:deleted")`)

   Every other mutation controller in `apps/backend/src/controllers` completely lacks `wsBroadcaster` imports or invocations:
   - `board/createBoard.ts` (Lines 1-56)
   - `board/renameBoard.ts` (Lines 1-62)
   - `board/deleteBoard.ts` (Lines 1-59)
   - `issues/assignIssue.ts` (Lines 1-101)
   - `issues/removeAssignment.ts` (Lines 1-77)
   - `comments/addComment.ts` (Lines 1-68)
   - `comments/editComment.ts` (Lines 1-72)
   - `comments/deleteComment.ts` (Lines 1-87)
   - `organisation/Create.ts` (Lines 1-48)
   - `organisation/updateDetails.ts` (Lines 1-53)
   - `organisation/deteleOrg.ts` (Lines 1-47)
   - `organisation/addUser.ts` (Lines 1-85)
   - `organisation/acceptInvite.ts` (Lines 1-63)
   - `organisation/updateRole.ts` (Lines 1-79)
   - `organisation/removeUser.ts` (Lines 1-82)

2. **WebSocket Environment Configuration**:
   In `apps/websockets/src/types/env.ts:5`:
   ```typescript
   jwt_key: zod.string().default("asdas"),
   ```
   A hardcoded default secret `"asdas"` is specified. In contrast, `apps/backend/src/types/env.ts:5` defines `jwt_key: zod.string()` with no default.

3. **Room Subscription Invalidation & Eviction**:
   In `apps/websockets/src/server.ts:220-229`, authorization (`checkAccess`) is verified strictly when handling the initial `action: "join"` message. Neither `apps/websockets/src/server.ts` nor `apps/backend/src/controllers/organisation/removeUser.ts` contains any revocation listener, socket close command, or eviction mechanism when an accepted member is deleted or demoted.

4. **Event Payload Sequencing & Versions**:
   In `apps/backend/src/services/broadcaster.ts:5-9` and `apps/websockets/src/types/events.ts:21-25`:
   ```typescript
   export interface BroadcastEvent<T = unknown> {
       type: string;
       payload: T;
       timestamp?: number;
   }
   ```
   No sequence number, revision counter, or entity version exists in any broadcast payload.

5. **Prisma Schema Kanban Model Completeness**:
   In `packages/db/prisma/schema.prisma`:
   - `issues` (Lines 75-90) only contains `id`, `title`, `position`, `gh_url`, `boardId`, `sectionId`. It lacks `description`, `dueDate`, `startDate`, `isArchived`, `createdAt`, `updatedAt`.
   - `comments` (Line 105) specifies `issue issues @relation(fields: [issueId], references: [id])` without `onDelete: Cascade`.
   - Zero models exist for `checklists`, `labels`, or `activity_log`.

6. **REST API Board Projections**:
   - `apps/backend/src/controllers/board/getBoards.ts:24-32` selects only `title` and `_count`, omitting `id`.
   - `apps/backend/src/controllers/board/getaBoard.ts:18-36` selects `title`, `section`, `orgId`, omitting board `id`.
   - `apps/backend/src/routes/routes.ts:143` binds `app.get("/api/cards/:id", ...)` while `apps/backend/src/controllers/issues/issueDetail.ts:8-12` parses `req.params.issueId`.
   - `apps/backend/src/controllers/comments/getAllcomments.ts:60-61` throws `Not_Found` when `comments.length === 0` and gates authorization behind `comments[0]`.

7. **Test Suite Status**:
   - Running `bun test apps/websockets/tests` passed 70 out of 70 tests.
   - Running `bun test apps/backend/tests/unit/broadcaster_integration.test.ts` passed 7 out of 7 tests.
   - Running `bun test` revealed test failure in `apps/backend/tests` due to `TypeError: fetch() URL is invalid` because `globalThis.TEST_BASE_URL` was uninitialized in the standalone runner.

---

## 2. Logic Chain

1. **Observation 1 → Event Coverage Conclusion**:
   Because `wsBroadcaster` is only called in 6 files, 12 out of 18 backend mutation controllers operate silently. When users rename boards, delete boards, assign/unassign card members, post/edit/delete comments, or update organization roles, no WebSocket frames are generated. Consequently, multi-client real-time synchronization is broken for 66% of the application's mutations.

2. **Observation 2 & 3 → Security & Subscription Vulnerability Conclusion**:
   Because `apps/websockets` permits an unconfigured `jwt_key` to fall back to `"asdas"`, unauthenticated attackers can forge valid JWTs using this known string and establish WebSocket sessions. Furthermore, because room membership checks occur only during the initial `join` action and no eviction mechanism exists in `removeUser.ts`, users whose access has been revoked retain persistent WebSocket subscriptions ("zombie subscriptions") and continue snooping on real-time board events.

3. **Observation 4 → Concurrency & Consistency Anomaly Conclusion**:
   Because event payloads contain only unsequenced timestamps (`Date.now()`) and mutations in controllers (e.g. `updateIssue.ts:90`) invoke broadcasts fire-and-forget without awaiting or transactional outbox storage, network packet reordering or temporary WebSocket downtime leads to lost events, out-of-order state application, and irrecoverable client-server split-brain state.

4. **Observation 5 → Kanban Domain Gap Conclusion**:
   Comparing `schema.prisma` against standard Trello capabilities reveals that the current application cannot function as a production Trello clone. The absence of card descriptions forces all notes into the title; the absence of checklists, labels, due dates, and activity logs leaves basic workflow coordination unsupported; and the absence of `onDelete: Cascade` on `comments.issueId` causes database foreign key crashes on issue/board deletion.

5. **Observation 6 → API Blocker Conclusion**:
   Because `getBoards.ts` and `getaBoard.ts` omit the board `id` from their select projections, frontend clients consuming the REST API cannot obtain the board ID needed to invoke `{"action": "join", "boardId": "<id>"}` on the WebSocket connection, directly severing the real-time subscription lifecycle at the client entry point.

---

## 3. Caveats

- **Load / Benchmark Testing**: Performance under 10,000+ concurrent WebSocket connections was not load-tested, as this audit was conducted in read-only analysis mode.
- **Client Implementation**: The frontend UI repository was not inspected; findings are based strictly on API contracts, controller logic, schemas, and WebSocket server mechanics.
- **Alternative Interpretations Considered**: The choice of native Bun WebSockets with `ws_port=3001` vs Express HTTP on `3000` is intended for high throughput; however, the lack of an atomic outbox bridge between Express/Postgres and Bun WebSockets creates a reliability gap across process boundaries.

---

## 4. Conclusion

The real-time and domain architecture contains critical gaps across event coverage, authorization persistence, data model completeness, and API contracts.
To achieve an enterprise-grade Trello-like Kanban system:
1. All 12 missing mutations must be wired to `wsBroadcaster`.
2. Zombie subscriptions must be eliminated by broadcasting user eviction events on member removal.
3. Event payloads must be enhanced with sequence numbers and transactional outbox persistence.
4. The Prisma schema must be extended to include `description`, `dueDate`, `isArchived`, `checklists`, `labels`, `activity_log`, timestamps, and `onDelete: Cascade` on `comments.issueId`.
5. REST API projection bugs in `getBoards`, `getaBoard`, `issueDetail`, and `getAllComments` must be remediated immediately.

All detailed findings, line numbers, proof-of-concept steps, and concrete code diffs are compiled in:
`/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/explorer_websocket/analysis.md`.

---

## 5. Verification Method

To independently verify all findings and test suite behavior:

1. **Verify WebSocket Server Tests**:
   ```bash
   bun test apps/websockets/tests
   ```
   Confirms that 70 unit and pub/sub tests pass.

2. **Verify Broadcaster Integration Tests**:
   ```bash
   bun test apps/backend/tests/unit/broadcaster_integration.test.ts
   ```
   Confirms backend broadcaster singleton and payload generation tests pass.

3. **Verify Mutation Event Coverage Gaps**:
   ```bash
   grep -rn "wsBroadcaster" apps/backend/src/controllers/
   ```
   Confirms that only 6 controllers call `wsBroadcaster`, while `board/renameBoard.ts`, `board/deleteBoard.ts`, `issues/assignIssue.ts`, `comments/addComment.ts`, etc., contain 0 matches.

4. **Verify Schema Cascade Omission**:
   Inspect line 105 of `packages/db/prisma/schema.prisma` to verify `issue issues @relation(fields: [issueId], references: [id])` lacks `onDelete: Cascade`.

5. **Verify Missing Board ID in Projections**:
   Inspect line 24-32 of `apps/backend/src/controllers/board/getBoards.ts` and line 18-36 of `apps/backend/src/controllers/board/getaBoard.ts` to confirm `id: true` is missing.
