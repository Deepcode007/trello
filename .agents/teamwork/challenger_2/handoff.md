# Adversarial Handoff Report: WebSocket Broadcast Coverage & Domain Parity Audit

**Author**: Challenger 2 (`teamwork_preview_challenger` / Empirical Challenger)  
**Recipient**: Orchestrator / Parent Agent (`42e1f2f8-c398-46b9-af05-d7cdaec41f90`)  
**Date**: October 2026  
**Type**: Hard Handoff (Task Complete)  

---

## 1. Observation

1. **Undercounted Mutations in AUDIT_REPORT.md**:
   - `AUDIT_REPORT.md` (lines 790–792) asserts:
     > *"The application features 18 distinct data-mutating endpoints. Only 6 trigger WebSocket events... Exactly 12 core backend mutations execute database writes in complete silence, triggering zero WebSocket events"*
   - AST / keyword scan of all 34 controller files in `apps/backend/src/controllers` revealed **22 mutating controllers** in total (6 broadcasting, 16 silent):
     - `organisation/deteleOrg.ts` (line 18: `await prisma.orgs.deleteMany(...)`) is completely omitted from the report.
     - `organisation/acceptInvite.ts` (line 46: `await prisma.membership.update(...)`) is completely omitted.
     - `organisation/Create.ts` (line 30: `await prisma.orgs.create(...)`) is omitted.
     - `signupHandler.ts` (line 40: `await prisma.user.create(...)`) is omitted.
2. **Runtime Projection Bug in Proposed WS-01 Patch Diffs**:
   - In `AUDIT_REPORT.md` lines 867–873, the patch proposes:
     `wsBroadcaster.broadcast(issue.board.id ?? issue.boardId, { type: "card:member_assigned", ... });`
   - In `apps/backend/src/controllers/issues/assignIssue.ts` lines 22–46, `prisma.issues.findUnique` selects:
     `select: { board: { select: { org: { select: { id: true, members: ... } } } } }`
   - Neither `issue.board.id` nor `issue.boardId` is selected. At runtime, evaluating `issue.board.id ?? issue.boardId` produces `undefined`.
   - In `apps/backend/src/services/broadcaster.ts` line 97:
     `if (!boardId || typeof boardId !== "string") return false;`
     The broadcast call rejects with `false` and does not transmit.
   - The same issue exists in `AUDIT_REPORT.md` line 893 (`addComment.ts`), where `issue.board.id` is `undefined`.
3. **Non-Functional Member Eviction Proposal in WS-02**:
   - `AUDIT_REPORT.md` line 925 proposes:
     `wsBroadcaster.broadcast("org_" + result.data.orgId, { type: "org:member_removed", payload: { action: "evict_user" } });`
   - In `apps/backend/src/services/broadcaster.ts` line 44:
     `formatBoardTopic("org_" + orgId)` produces `"board_org_" + orgId`.
   - In `apps/websockets/src/server.ts` line 242:
     Clients subscribe strictly to canonical topic `"board_<boardId>"`. No sockets are subscribed to `"board_org_<orgId>"`.
   - Bun's `server.publish` only delivers to subscribers of the specified topic; it cannot terminate sockets on other topics.
   - The WebSocket server possesses no user-to-socket lookup registry (`userId -> Set<ServerWebSocket>`).
4. **Self-Contradiction Between Finding DB-03 and Target Schema**:
   - In `AUDIT_REPORT.md` lines 230–269 (Finding DB-03), the auditor argues that `issues.sectionId` must be `String` (non-nullable) with `onDelete: Cascade` to eliminate orphan/ghost cards.
   - In `AUDIT_REPORT.md` line 1210–1211 (Consolidated Target Schema), the schema specifies:
     `sectionId String?`
     `section sections? @relation(fields: [sectionId], references: [id], onDelete: SetNull)`
     directly restoring the defect.
5. **Omission of Domain Models in Target Schema**:
   - `AUDIT_REPORT.md` Section 5 rates Checklists, Labels, and Activity Logs as completely missing, and Roadmap Phase 4 schedules their implementation.
   - In Section 6 ("Consolidated Target Schema"), zero models for checklists, labels, or activity logs are defined.
6. **Hardcoded Fallback Secret Confirmed**:
   - In `apps/websockets/src/types/env.ts` line 5: `jwt_key: zod.string().default("asdas")`.
   - Verified via `bun -e 'import { envSchema } from "./apps/websockets/src/types/env"; console.log(envSchema.safeParse({}).data.jwt_key);'` => `"asdas"`.

---

## 2. Logic Chain

1. **Step 1 (Mutation Count)**: Because `AUDIT_REPORT.md` counted only 18 total mutating endpoints (Observation 1), it falsely concluded that only 12 mutations lack broadcasts. By scanning all 34 controller files, we proved there are 22 mutating endpoints and 16 silent mutations. Deleting an organization (`deteleOrg.ts`) deletes all constituent boards via cascade, making its omission a critical real-time flaw.
2. **Step 2 (Broken Diffs)**: Because the proposed diffs in `assignIssue.ts` and `addComment.ts` access `issue.board.id` without adding `id: true` to the Prisma query selections (Observation 2), the runtime value of `boardId` is `undefined`. Under `broadcaster.ts`, any non-string `boardId` causes the function to exit immediately. Thus, applying the auditor's diffs verbatim results in silent runtime failures.
3. **Step 3 (Eviction Failure)**: Because `formatBoardTopic` unconditionally prefixes `"board_"` to any topic not starting with `"board_"` (Observation 3), broadcasting to `"org_<id>"` publishes to `"board_org_<id>"`. Since clients subscribe only to `"board_<boardId>"`, no client ever receives the eviction payload. Furthermore, pub/sub cannot close remote sockets across topics without an in-memory socket registry. The proposed WS-02 fix is therefore architecturally defective.
4. **Step 4 (Schema Contradiction)**: Because Section 6's Consolidated Target Schema defines `sectionId String?` and `onDelete: SetNull` (Observation 4), it completely invalidates the auditor's own high-severity DB-03 finding.
5. **Step 5 (Roadmap & Model Gap)**: Because the target schema omits Checklists, Labels, and Outbox models (Observation 5), the Roadmap's Phase 3 (Outbox Pattern) and Phase 4 (Domain Parity) lack the necessary relational data structures.

---

## 3. Caveats

- **Dual-Process vs In-Process Operation**: In single-process dual-server mode (`index.ts` booting Express), `wsBroadcaster` attaches the server instance directly, avoiding the HTTP IPC roundtrip. However, the projection bugs (`undefined` boardId) and topic prefixing bugs (`board_org_<id>`) persist identically in both execution modes.
- **Signup Handler Exclusion**: We categorized `signupHandler.ts` as a silent mutation (mutates database), but acknowledge that account registration is not typically scoped to board or organization WebSocket topics. Even excluding signup, there are still 21 mutating endpoints and 15 silent mutations.

---

## 4. Conclusion

`AUDIT_REPORT.md` correctly identifies the absence of broadcasts on 12 mutations, the fallback secret (`asdas`), IPC secret conflation, and lack of monotonic sequencing. However, the report contains **four significant flaws**:
1. **Undercounted Scope**: Missed 4 mutating endpoints, most critically `organisation/deteleOrg.ts` and `acceptInvite.ts`.
2. **Defective Code Diffs**: Diffs for `assignIssue.ts` and `addComment.ts` pass `undefined` to `broadcast` due to missing Prisma select fields.
3. **Flawed Eviction Architecture**: WS-02 proposes broadcasting to `"org_<id>"`, which is prefixed to `"board_org_<id>"` and reaches zero clients, failing to evict sockets.
4. **Target Schema Self-Contradiction & Omission**: The target schema directly contradicts Finding DB-03 (restoring `SetNull`) and completely omits Checklists, Labels, and Outbox models.

**Actionable Recommendations**:
1. Amend `AUDIT_REPORT.md` Section 4 to reflect 22 mutating endpoints and 16 silent mutations.
2. Update the remediation diffs in `assignIssue.ts`, `addComment.ts`, `removeAssignment.ts`, `editComment.ts`, and `deleteComment.ts` to include `boardId` in Prisma `select`.
3. Redesign member eviction to use an internal HTTP administrative endpoint (`POST /internal/evict-user`) paired with a WebSocket user-connection registry.
4. In Section 6, fix `issues.sectionId` to `String` and `onDelete: Cascade`.
5. Add model definitions for `checklists`, `checklist_items`, `labels`, and `board_events` (outbox).

---

## 5. Verification Method

To independently verify these findings:

1. **Verify Controller Mutation Inventory (22 mutating controllers)**:
   ```bash
   bun -e '
   import fs from "fs";
   const files = fs.readdirSync("./apps/backend/src/controllers", { recursive: true })
     .filter(f => f.endsWith(".ts"));
   const mutating = files.filter(f => {
     const c = fs.readFileSync("./apps/backend/src/controllers/" + f, "utf8");
     return [".create(", ".update(", ".delete(", ".updateMany(", ".createMany(", ".deleteMany("].some(k => c.includes(k));
   });
   console.log("Total mutating controllers:", mutating.length);
   console.log(mutating);
   '
   ```
   *Expected Output*: Exactly 22 mutating controllers.

2. **Verify Undefined boardId in Auditor Diffs**:
   Inspect `apps/backend/src/controllers/issues/assignIssue.ts` lines 22–46 and `apps/backend/src/controllers/comments/addComment.ts` lines 23–49. Confirm that `select` under `board` contains only `org`, and `boardId` is not selected on `issues`.

3. **Verify Topic Prefixing on `org_` Topics**:
   ```bash
   bun -e '
   import { formatBoardTopic } from "./apps/backend/src/services/broadcaster";
   console.log(formatBoardTopic("org_12345"));
   '
   ```
   *Expected Output*: `"board_org_12345"`.

4. **Verify Target Schema Contradiction with DB-03**:
   Inspect `AUDIT_REPORT.md` line 258 (DB-03 remediation changing `issues.sectionId` to `String` / `onDelete: Cascade`) vs line 1210–1211 (Consolidated Target Schema specifying `sectionId String?` / `onDelete: SetNull`).

5. **Run Existing Test Suite**:
   ```bash
   cd apps/websockets && bun test
   cd ../backend && bun test tests/unit
   ```
   *Expected Output*: 70 websocket tests pass; 55 backend unit tests pass.
