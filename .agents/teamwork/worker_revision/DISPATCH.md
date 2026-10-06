## 2026-10-05T19:30:23Z

You are the Audit Revision Worker (teamwork_preview_worker).
Your working directory is: /Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/worker_revision
Mandatory: Read /Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/ORIGINAL_REQUEST.md before starting.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Context:
During the Iteration 1 Gate review, Reviewer 2 and Challenger 2 identified concrete defects in the remediation code diffs, WebSocket eviction design, and target schema inside `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md`.

You MUST read the feedback from:
- `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/reviewer_2/handoff.md`
- `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/challenger_2/handoff.md`

Objective:
Update `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md` to resolve ALL the points raised by Reviewer 2 and Challenger 2:

1. Finding API-04 (`updateRole.ts` diff):
   - In the remediation diff, fix line 65 to assign `userId: targetMember.userId` instead of undeclared `userId: userId!`, resolving TS2304 / runtime ReferenceError.

2. Finding WS-01 (`assignIssue.ts`, `addComment.ts` diffs, and Mutation Inventory):
   - In `assignIssue.ts` diff: update the Prisma `select` for `issue` to include `board: { select: { id: true, org: ... } }` and for `validUsers` include `user: { select: { email: true, issueMappings: true } }` so `issue.board.id` and `v.user.email` are genuinely selected and never `undefined`.
   - In `addComment.ts` diff: update the Prisma `select` for `issue` to include `board: { select: { id: true, org: ... } }` so `issue.board.id` is available for `wsBroadcaster.broadcast(issue.board.id, ...)`.
   - Update Mutation Inventory: Clarify that across all 34 controller files there are 22 mutating endpoints total (6 broadcasting, 16 silent), detailing the omissions including `organisation/deteleOrg.ts` (cascading org delete), `acceptInvite.ts`, `Create.ts`, and `signupHandler.ts`.

3. Finding WS-02 (`removeUser.ts` & Member Eviction):
   - Replace the simplistic `org_${orgId}` broadcast with a genuine, production-grade eviction architecture:
     a) Document why `formatBoardTopic("org_" + orgId)` produces `"board_org_<id>"` (phantom channel with 0 subscribers) and why pub/sub alone cannot terminate foreign sockets without an in-memory connection registry.
     b) Provide the complete two-layer remediation:
        - Layer 1: Multi-board broadcast: `removeUser.ts` queries all boards in the org (`prisma.boards.findMany({ where: { orgId }, select: { id: true } })`) and broadcasts `board:member_evicted` with `{ userId: user_found.userId, orgId }` to every board topic.
        - Layer 2: Dedicated WebSocket eviction handler or internal administrative endpoint (`POST /internal/evict-user`) in `apps/websockets` that looks up the active sockets for `userId` in a connection registry and terminates them with close code 4003 (`FORBIDDEN_REVOKED`).

4. Finding DB-03 and Section 6 Consolidated Target Schema:
   - Reconcile `issues.sectionId`: update Section 6's Consolidated Target Schema to specify `sectionId String` with `onDelete: Cascade` (and document the migration backfill query for orphan issues before setting NOT NULL).
   - In Section 6's Migration Runbooks, include the exact SQL DDL for altering `issues.sectionId`.

5. Finding WS-04 (IPC Secret Decoupling):
   - Update the patch to include both `apps/websockets/src/server.ts` (accepting `INTERNAL_BROADCAST_SECRET`) AND `apps/backend/src/services/broadcaster.ts` (transmitting `x-internal-secret: env.INTERNAL_BROADCAST_SECRET ?? env.JWT_KEY`).

6. Section 6 Target Schema Completeness:
   - Add model definitions for `checklists`, `checklist_items`, `labels`, and `board_events` (outbox pattern table) matching the Section 5 roadmap.

Verify your changes to `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md`.
Write your handoff report to `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/.agents/teamwork/worker_revision/handoff.md`.
Update `progress.md` and send a message back to the orchestrator when finished.
