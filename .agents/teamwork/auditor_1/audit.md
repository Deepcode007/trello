# Forensic Audit Report: AUDIT_REPORT.md

**Work Product**: `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md`  
**Auditor**: Forensic Integrity Auditor (`auditor_1`)  
**Profile**: General Project  
**Integrity Mode**: Demo Mode (governed by `ORIGINAL_REQUEST.md`)  
**Date**: October 2026  
**Verdict**: **CLEAN**

---

## 1. Executive Summary

An exhaustive forensic integrity audit was performed on the master technical audit document `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md` (1,352 lines, 76,109 bytes). The deliverable was verified against the ground-truth repository codebase across `packages/db`, `apps/backend`, and `apps/websockets`.

Every documented finding, source code citation, line number, SQL migration reference, error mechanism, and remediation patch was subjected to empirical verification.

**Audit Findings**:
- **Zero Fabrications**: All 20 technical findings reflect genuine, reproducible architectural, security, and integrity flaws in the codebase.
- **Zero Hallucinated Citations**: All cited files exist, and line numbers match verbatim with the underlying source files.
- **Zero Facades**: The report contains full root-cause analyses, concrete SQLSTATE and Prisma error codes, reproduction payloads, and comprehensive code remediation diffs.
- **100% Acceptance Criteria Compliance**: All 7 mandatory technical coverage points stipulated in `ORIGINAL_REQUEST.md` are addressed in depth.

---

## 2. Integrity Verification Phase Results

### Phase 1: Source Code & Codebase Consistency Verification

| Finding ID in Report | Referenced File & Line Citations | Ground-Truth Verification Result | Integrity Status |
|---|---|---|---|
| **DB-01** (Comments FK Cascade Omission & Soft-Delete Trap) | `packages/db/prisma/schema.prisma:105`, `deleteIssue.ts:48-52`, `deleteBoard.ts:47-51`, `deleteComment.ts:61-80`, `20260808070740_add_comments/migration.sql:14` | Verified line-by-line: `schema.prisma:105` lacks `onDelete: Cascade`. Migration line 14 defaults to `ON DELETE RESTRICT`. `deleteIssue.ts:48-52` and `deleteBoard.ts:47-51` invoke `delete()`. `deleteComment.ts:72-76` updates `deletedAt` without deleting physical rows, locking issues permanently. | **PASS (VERIFIED)** |
| **DB-02** (Comments User FK Cascade Omission) | `packages/db/prisma/schema.prisma:107`, `migration.sql:17` | Verified: `userId` relation lacks `onDelete: Cascade`. Migration line 17 applies `ON DELETE RESTRICT`. User deletion fails with SQLSTATE 23503 / P2003 when user has comments. | **PASS (VERIFIED)** |
| **DB-03** (Orphan Cards via `issues.sectionId` `SetNull`) | `packages/db/prisma/schema.prisma:83`, `getaBoard.ts:20-34` | Verified: `schema.prisma:83` sets `onDelete: SetNull`. `getaBoard.ts:20-34` queries cards nested strictly inside `section`. Setting `sectionId` to null causes cards to disappear from board views. | **PASS (VERIFIED)** |
| **DB-04** (Missing FK Indexes on High-Frequency Paths) | `schema.prisma:58, 96, 104, 106, 108` | Verified: `boards.orgId` (line 58), `issue_mapping.issueId` (line 96, composite secondary), `comments.issueId` (line 104), `comments.userId` (line 106), `comments.parentId` (line 108) all lack PostgreSQL indexes. | **PASS (VERIFIED)** |
| **DB-05** (Duplicate B-Tree Index on `issues.sectionId`) | `schema.prisma:88-89`, `20260807195148.../migration.sql:20`, `20261006001500.../migration.sql:11` | Verified: `issues_sectionId_idx` (migration line 20) is a redundant left-prefix duplicate of `issues_sectionId_position_idx` (migration line 11). Both are defined in `schema.prisma:88-89`. | **PASS (VERIFIED)** |
| **DB-06** (Omission of Audit Timestamps and Core Entity Fields) | `schema.prisma:21-114` | Verified: `user`, `orgs`, `membership`, `boards`, `sections`, and `issues` lack `createdAt` and `updatedAt`. `issues` lacks `description`, `dueDate`, and `priority`. | **PASS (VERIFIED)** |
| **API-01** (Missing Board `id` in Board Projections) | `getBoards.ts:23-32`, `getaBoard.ts:18-36` | Verified: `getBoards.ts:24-31` selects only `title` and `_count`. `getaBoard.ts:18-36` selects `title`, `section`, and `orgId`, completely omitting `id: true`. | **PASS (VERIFIED)** |
| **API-02** (404 on Empty Comments & Auth Bypass Oracle) | `getAllcomments.ts:19-62` | Verified: Lines 60-61 check `comments.length === 0` throwing 404 before verifying organization membership on line 61. Returns 404 for empty lists and creates side-channel oracle. | **PASS (VERIFIED)** |
| **API-03** (Route Parameter Binding Mismatch in `issueDetail`) | `issueDetail.ts:8-15`, `routes.ts:143` | Verified: `routes.ts:143` maps `GET /api/cards/:id` to `issueDetail`, but `issueDetail.ts:8-15` parses `req.params` expecting strictly `issueId`, causing Zod ValidationError (400 Bad Request). | **PASS (VERIFIED)** |
| **API-04** (Role Restrictions, Self-Update Deadlock & Demotion) | `updateRole.ts:13-77` | Verified: Line 15 restricts to `["admin", "employee"]` excluding `"contributor"`. Lines 45-56 `if/else if` causes self-updates to fail with 404 Not Found. Zero check preventing demoting last admin. | **PASS (VERIFIED)** |
| **API-05** (Missing `accepted: true` in `UpdateOrgHandler`) | `updateDetails.ts:21-41` | Verified: Lines 24-29 query `userId: req.id, role: "admin"` without `accepted: true`, allowing unaccepted invitees to alter org settings. | **PASS (VERIFIED)** |
| **API-06** (User Enumeration, Self-Invites, 24h Moderation Lockout) | `loginHandler.ts:25-37`, `addUser.ts:55-80`, `deleteComment.ts:56-59`, `getCurrent.ts:5-17`, `getAllIssues.ts:57-65` | Verified: 404 vs 401 oracle in `loginHandler.ts`. Self-invite deadlock in `addUser.ts`. 24h lockout applying to admins in `deleteComment.ts`. Missing org fields in `getCurrent.ts`. Shape disparity in `getAllIssues.ts`. | **PASS (VERIFIED)** |
| **WS-01** (12 Backend Mutations Lacking WebSocket Broadcasts) | `broadcaster.ts:5-150`, 12 mutation controllers | Verified empirically via grep: Only 6 controllers invoke `wsBroadcaster`. All 12 listed controllers execute DB writes with zero broadcast calls. | **PASS (VERIFIED)** |
| **WS-02** (Zombie Subscriptions on Revoked Members) | `apps/websockets/src/server.ts:220-244`, `removeUser.ts:68-76` | Verified: Membership checked only during initial join in `server.ts:220-229`. `removeUser.ts` deletes membership without emitting eviction event to WebSocket server. | **PASS (VERIFIED)** |
| **WS-03** (Hardcoded Fallback Secret in WebSocket Env) | `apps/websockets/src/types/env.ts:5` | Verified: `jwt_key: zod.string().default("asdas")` allows trivial authentication forgery if environment variable is missing. | **PASS (VERIFIED)** |
| **WS-04** (Conflation of IPC Secret with Public User JWT Secret) | `apps/websockets/src/server.ts:70`, `broadcaster.ts:136` | Verified: `headers.get("x-internal-secret") !== jwtSecret` reuses public token secret for internal IPC bridge. | **PASS (VERIFIED)** |
| **WS-05** (Absence of Monotonic Event Sequencing) | `apps/websockets/src/types/events.ts:21-25`, `broadcaster.ts:113-118` | Verified: `BroadcastEvent` contains only optional timestamp; lacks sequence numbers, entity versions, or vector clocks. | **PASS (VERIFIED)** |
| **WS-06** (Fire-and-Forget Delivery without Outbox) | `updateIssue.ts:90-102`, `broadcaster.ts:134-152` | Verified: Broadcaster calls are unawaited, fire-and-forget, and executed outside database transactions with errors silenced. | **PASS (VERIFIED)** |
| **WS-07** (Non-Deterministic Float Positioning) | `createIssue.ts:57-64`, `updateIssue.ts:73` | Verified: `position = (count + 1) * 1000` with raw floats susceptible to race collisions and non-deterministic sorting. | **PASS (VERIFIED)** |
| **WS-08** (Connection Pool Thundering Herd on Reconnect) | `apps/websockets/src/server.ts:14-38` | Verified: `defaultCheckBoardAccess` executes un-cached `prisma.boards.findUnique` per join event, risking connection pool saturation. | **PASS (VERIFIED)** |

---

## 3. Mandatory Acceptance Criteria Audit (`ORIGINAL_REQUEST.md`)

| Acceptance Criterion | Required Specifics | Delivery in `AUDIT_REPORT.md` | Verification Status |
|---|---|---|---|
| **AC-1: Report Length & Structure** | ≥ 150 lines of structured markdown | 1,352 lines across 7 structured sections | **PASS** (Exceeds by 9x) |
| **AC-2: Required Sections** | Prisma Schema, Backend API, WebSocket Sync, Kanban Comparison, Remediation Roadmap | Sections 2, 3, 4, 5, 6 present and comprehensive | **PASS** |
| **AC-3: Finding Components** | Severity rating, exact file & lines, root cause analysis, code diff | Present for all 20 findings | **PASS** |
| **AC-4: DB-01 Mandatory Point** | FK cascade omission on `comments.issueId` in `schema.prisma` and runtime crash on board/issue deletes | Detailed in Section 2, Finding DB-01 with Postgres SQLSTATE 23503, Prisma P2003, and soft-delete trap analysis | **PASS** |
| **AC-5: API-01 Mandatory Point** | Missing board `id` in `getAllBoards` (`getBoards.ts`) | Detailed in Section 3, Finding API-01 with client routing impact and room subscription breakdown | **PASS** |
| **AC-6: API-02 Mandatory Point** | 404 response on empty comment lists & auth bypass in `getAllComments` (`getAllcomments.ts`) | Detailed in Section 3, Finding API-02 with side-channel oracle explanation and reproduction curls | **PASS** |
| **AC-7: API-03 Mandatory Point** | Parameter mismatch between `/api/cards/:id` and `issueDetail` (`issueDetail.ts`) | Detailed in Section 3, Finding API-03 with Express routing vs Zod parsing breakdown | **PASS** |
| **AC-8: API-04 Mandatory Point** | Role restriction & self-update flaws in `updateRoleHandler` (`updateRole.ts`) | Detailed in Section 3, Finding API-04 covering self-update deadlock, last admin demotion, and contributor role truncation | **PASS** |
| **AC-9: API-05 Mandatory Point** | Missing `accepted: true` verification in `UpdateOrgHandler` (`updateDetails.ts`) | Detailed in Section 3, Finding API-05 with unaccepted invitee org alteration scenario | **PASS** |
| **AC-10: WS-01 Mandatory Point** | Identify all backend mutations lacking WebSocket broadcast triggers | Detailed in Section 4, Finding WS-01 explicitly enumerating all 12 silent mutations in a structured table | **PASS** |

---

## 4. Empirical Test and Build Verification

1. **Prisma Schema Validation**:
   - Command: `cd packages/db && bunx prisma validate`
   - Output: `The schema at prisma/schema.prisma is valid 🚀` (Exit Code: 0).
2. **WebSocket Test Suite**:
   - Command: `cd apps/websockets && bun test`
   - Output: `70 pass, 0 fail, 349 expect() calls across 4 files` (Exit Code: 0).
3. **Backend Unit & Controller Test Suites**:
   - Command: `cd apps/backend && bun test tests/unit`
   - Output: `55 pass, 0 fail, 224 expect() calls across 4 files` (Exit Code: 0).
4. **Total Verified Passing Tests**: 125 tests passing cleanly across the repository.

---

## 5. Prohibited Patterns Check

1. **Hardcoded Test Results**: None. `AUDIT_REPORT.md` is a technical document containing authentic architectural analyses, not hardcoded mock responses.
2. **Facade Implementations**: None. Detailed failure mechanisms, step-by-step reproduction curl commands, exact line numbers, and production-ready diffs are provided.
3. **Fabricated Verification Outputs**: None. All references and code blocks match the current state of the repository code.
4. **Self-Certifying Tests**: None.
5. **Execution Delegation**: None. The analysis is deeply customized to this specific repository's codebase and schema.

---

## 6. Final Verdict

**Verdict**: **CLEAN**

The deliverable `/Users/deep/Desktop/Padhayi/DEV/Projects/trello/AUDIT_REPORT.md` represents an exceptionally thorough, technically authentic, and rigorous audit report. It contains zero integrity violations, fully satisfies all requirements of `ORIGINAL_REQUEST.md`, and is hereby approved.
