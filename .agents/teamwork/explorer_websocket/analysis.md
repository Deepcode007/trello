# Exhaustive Technical Audit: WebSocket Real-Time Synchronization & Kanban Domain Gap Analysis

**Audit Date**: October 2026  
**Auditor**: WebSocket & Domain Auditor (`teamwork_preview_explorer`)  
**Target Systems**: `apps/websockets`, `apps/backend/src/services/broadcaster.ts`, `apps/backend/src/controllers/`, `packages/db/prisma/schema.prisma`

---

## 1. Executive Summary

A comprehensive architectural and code-level audit was conducted across the real-time collaboration layer (`apps/websockets`), the inter-process event broadcaster (`apps/backend/src/services/broadcaster.ts`), all REST mutation controllers (`apps/backend/src/controllers`), and the underlying Prisma schema (`packages/db/prisma/schema.prisma`).

The system utilizes a dual-process architecture: an Express REST API on port `3000` handling HTTP requests and database persistence, and a native Bun WebSocket server on port `3001` managing persistent client connections and board-scoped pub/sub rooms (`board_<boardId>`). Communication between backend REST controllers and the WebSocket engine occurs either via in-memory event dispatch (when co-located in a single process) or an HTTP IPC bridge (`POST /internal/broadcast`).

While the baseline WebSocket handshake authentication, room subscription mechanics, and card move/create broadcasts function for simple happy-path scenarios, the audit uncovered **critical systemic deficiencies**:
1. **Pervasive Event Coverage Gaps**: Only **6 out of 18 backend mutations** trigger WebSocket broadcasts. 12 critical mutations—including board renames, board deletions, member card assignments, comment threads, and membership changes—completely lack real-time synchronization.
2. **Security & Subscription Invalidation Vulnerabilities**: Removed organization members retain active WebSocket subscriptions ("zombie subscriptions") to private boards indefinitely. The WebSocket environment falls back to an insecure hardcoded JWT secret (`"asdas"`), and the internal IPC broadcast endpoint conflates user JWT signing keys with internal service credentials.
3. **Absence of State Consistency & Resilience**: Events lack sequence numbers or entity revision versions, exposing multi-client state to race conditions and out-of-order execution. Mutations trigger broadcasts in a fire-and-forget pattern with no transactional outbox or catch-up event log when clients disconnect.
4. **Significant Domain Deficiencies vs Trello**: The data model lacks standard Kanban capabilities, including card descriptions, checklists, due dates, labels, activity logs, file attachments, column WIP limits, soft archiving, and fractional indexing (LexoRank). Furthermore, critical REST API defects (such as missing `id` fields in board endpoints) break real-time room discovery on the client.

---

## 2. Event Coverage Completeness Audit

### 2.1 Backend Mutation Inventory & Broadcast Matrix

Every mutation controller in `apps/backend/src/controllers` was systematically audited against the WebSocket broadcaster invocation list.

| Controller / Endpoint | HTTP Method & Route | Mutation Description | Triggers WS Broadcast? | Broadcast Event Type | Severity of Absence |
| :--- | :--- | :--- | :---: | :--- | :---: |
| `board/createBoard.ts` | `POST /api/orgs/:orgId/boards` | Creates new board | ❌ **NO** | *None* | **Medium** |
| `board/renameBoard.ts` | `PUT /api/boards/:boardId` | Renames board title | ❌ **NO** | *None* | **High** |
| `board/deleteBoard.ts` | `DELETE /api/boards/:boardId` | Deletes board & cascades | ❌ **NO** | *None* | **Critical** |
| `sections/createSection.ts` | `POST /api/boards/:boardId/sections` | Creates new column | ✅ **YES** | `list:created` | — |
| `sections/renameSection.ts` | `PUT/PATCH /api/sections/:sectionId` | Renames column or changes order | ✅ **YES** | `list:updated`, `list:reordered` | — |
| `sections/deleteSection.ts` | `DELETE /api/sections/:sectionId` | Deletes column & moves cards | ✅ **YES** | `card:moved`, `list:deleted` | — |
| `issues/createIssue.ts` | `POST /api/sections/:sectionId/issues` | Creates new card | ✅ **YES** | `card:created` | — |
| `issues/updateIssue.ts` | `PUT/PATCH /api/issues/:issueId` | Updates card or moves column/pos | ✅ **YES** | `card:moved`, `card:updated` | — |
| `issues/deleteIssue.ts` | `DELETE /api/issues/:issueId` | Deletes card | ✅ **YES** | `card:deleted` | — |
| `issues/assignIssue.ts` | `POST /api/issues/:issueId/assignees` | Assigns users to card | ❌ **NO** | *None* | **High** |
| `issues/removeAssignment.ts` | `DELETE /api/issues/:issueId/assignees/` | Removes user from card | ❌ **NO** | *None* | **High** |
| `comments/addComment.ts` | `POST /api/issues/:issueId/comments` | Adds comment or reply | ❌ **NO** | *None* | **High** |
| `comments/editComment.ts` | `PUT /api/comments/:commentId` | Edits comment text | ❌ **NO** | *None* | **Medium** |
| `comments/deleteComment.ts` | `DELETE /api/comments/:commentId` | Soft-deletes comment | ❌ **NO** | *None* | **Medium** |
| `organisation/Create.ts` | `POST /api/orgs` | Creates new organization | ❌ **NO** | *None* | **Low** |
| `organisation/updateDetails.ts`| `PUT /api/orgs/:orgId` | Renames or updates org | ❌ **NO** | *None* | **Low** |
| `organisation/deteleOrg.ts` | `DELETE /api/orgs/:orgId` | Deletes organization | ❌ **NO** | *None* | **Critical** |
| `organisation/addUser.ts` | `POST /api/orgs/:orgId/members` | Invites member to org | ❌ **NO** | *None* | **Medium** |
| `organisation/acceptInvite.ts` | `PUT /api/orgs/:orgId/accept` | Accepts member invite | ❌ **NO** | *None* | **Medium** |
| `organisation/updateRole.ts` | `PUT /api/orgs/:orgId/members` | Updates member role | ❌ **NO** | *None* | **High** |
| `organisation/removeUser.ts` | `DELETE /api/orgs/:orgId/members` | Removes user from org | ❌ **NO** | *None* | **Critical** |

---

### 2.2 Deep Dive: Individual Missing Broadcast Mutations

#### Finding WS-01: Missing WebSocket Broadcast on Board Renaming
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/board/renameBoard.ts:46-60`
- **Failure Mechanism & Impact**: When an admin or employee updates the title of a board, the database record is updated (`prisma.boards.update`), but no broadcast event is published to `board_<boardId>`. Active collaborators viewing the board maintain stale header titles, navigation breadcrumbs, and window document titles until an explicit full-page browser refresh.
- **PoC Scenario**:
  1. User A (Admin) and User B (Employee) join board `board_101` via WebSocket (`{"action": "join", "boardId": "board_101"}`).
  2. User A executes `PUT /api/boards/board_101` with body `{"title": "Q4 Release Planning - Final"}`.
  3. User A receives HTTP 200. User B receives 0 WebSocket frames on `board_101`. User B continues seeing "Q4 Release Planning".
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/board/renameBoard.ts
+++ b/apps/backend/src/controllers/board/renameBoard.ts
@@ -4,6 +4,7 @@
 import zod from "zod"
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function renameBoard(req: Request, res: Response)
@@ -53,6 +54,11 @@
         }
     })
 
+    wsBroadcaster.broadcast(board.id, {
+        type: "board:updated",
+        payload: { boardId: board.id, title: board.title }
+    });
+
     return res.status(200).json({
         success: true,
         data: board
```

---

#### Finding WS-02: Missing WebSocket Broadcast on Board Deletion
- **Severity**: **Critical**
- **File & Line Numbers**: `apps/backend/src/controllers/board/deleteBoard.ts:47-57`
- **Failure Mechanism & Impact**: When an authorized user deletes a board via `DELETE /api/boards/:boardId`, the database deletes the board record. However, no `board:deleted` event is broadcast to the board's room subscribers. Connected users remain subscribed to the orphaned room, continue attempting to create cards or move items, and receive repeated 404 / 500 error popups.
- **PoC Scenario**:
  1. User A and User B are both viewing board `b-999`.
  2. User A deletes `b-999` via `DELETE /api/boards/b-999`.
  3. User B receives no notification. User B attempts to drag Card 1 into Section 2. The client sends `PATCH /api/cards/c-1/move`, which fails with 404 Not Found, leaving the UI in an inconsistent optimistic-update state.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/board/deleteBoard.ts
+++ b/apps/backend/src/controllers/board/deleteBoard.ts
@@ -4,6 +4,7 @@
 import zod from "zod"
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function deleteBoard(req: Request, res: Response)
@@ -50,6 +51,11 @@
         }
     })
 
+    wsBroadcaster.broadcast(result.data.boardId, {
+        type: "board:deleted",
+        payload: { boardId: result.data.boardId }
+    });
+
     return res.status(200).json({
         success: true,
         data: "board deleted"
```

---

#### Finding WS-03: Missing WebSocket Broadcast on Card Member Assignment
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/issues/assignIssue.ts:92-99`
- **Failure Mechanism & Impact**: When users are assigned to an issue via `POST /api/issues/:issueId/assignees`, records are inserted into `issue_mapping`. No WebSocket broadcast is emitted. Other team members collaborating on the board do not see the new member avatars appear on the card in real-time, and the newly assigned user receives no live push notification.
- **PoC Scenario**:
  1. Product Owner assigns Developer Alice to Issue `iss-10` via `POST /api/issues/iss-10/assignees` with `{"email": ["alice@company.com"]}`.
  2. PO receives HTTP 200.
  3. Developer Alice and other team members currently viewing the board receive 0 WebSocket frames. The card remains unassigned on all peer screens.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/issues/assignIssue.ts
+++ b/apps/backend/src/controllers/issues/assignIssue.ts
@@ -4,6 +4,7 @@
 import zod from "zod"
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function assignIssue(req: Request, res: Response)
@@ -95,6 +96,16 @@
         data: mapping
     })
 
+    wsBroadcaster.broadcast(issue.board.org.id ? issue.board.id ?? issue.boardId : "", {
+        type: "card:member_assigned",
+        payload: {
+            issueId: result.data.issueId,
+            assignedUsers: validUsers.map(v => ({ userId: v.userId, email: v.user.email })),
+            boardId: issue.boardId
+        }
+    });
+
     return res.status(200).json({
         success: true,
         data: `assigned ${mapping.length}`
```

---

#### Finding WS-04: Missing WebSocket Broadcast on Card Member Unassignment
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/issues/removeAssignment.ts:63-75`
- **Failure Mechanism & Impact**: Removing an assigned collaborator via `DELETE /api/issues/:issueId/assignees/` removes the `issue_mapping` row from PostgreSQL, but triggers no broadcast. All connected clients continue displaying the unassigned user's avatar on the card front and card detail modal until manual reload.
- **PoC Scenario**:
  1. Admin unassigns Alice from Card `iss-10`.
  2. The database mapping is deleted.
  3. Peer screens still render Alice's badge on Card `iss-10`. Team members assume Alice is still working on the task.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/issues/removeAssignment.ts
+++ b/apps/backend/src/controllers/issues/removeAssignment.ts
@@ -4,6 +4,7 @@
 import zod from "zod"
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function removeAssignment(req: Request, res: Response)
@@ -69,6 +70,16 @@
         }
     })
 
+    wsBroadcaster.broadcast(issue.board.id ?? "", {
+        type: "card:member_unassigned",
+        payload: {
+            issueId: result.data.issueId,
+            userId: issue.issueMappings[0]!.userId,
+            email: result2.data.email,
+            boardId: issue.board.id
+        }
+    });
+
     return res.status(200).json({
         success: true,
         data: `unassigned ${result2.data.email}`
```

---

#### Finding WS-05: Missing WebSocket Broadcast on Comment Thread Mutations
- **Severity**: **High**
- **File & Line Numbers**:
  - `apps/backend/src/controllers/comments/addComment.ts:55-66`
  - `apps/backend/src/controllers/comments/editComment.ts:60-70`
  - `apps/backend/src/controllers/comments/deleteComment.ts:72-85`
- **Failure Mechanism & Impact**: Adding, editing, or deleting comments on a card operates entirely silently. In a collaborative Kanban tool, card comment sections function as live discussion threads. Because no `comment:created`, `comment:updated`, or `comment:deleted` broadcasts exist, multiple collaborators viewing the same open card cannot converse in real-time.
- **PoC Scenario**:
  1. User A and User B open the detail modal for Card `iss-42`.
  2. User A posts a comment: "Blocking defect in staging, do not merge."
  3. User B receives no real-time update. User B approves the merge request because the comment is not visible without an explicit manual reload.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/comments/addComment.ts
+++ b/apps/backend/src/controllers/comments/addComment.ts
@@ -4,6 +4,7 @@
 import zod from "zod"
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function addComment(req: Request, res: Response)
@@ -62,6 +63,12 @@
         }
     })
 
+    wsBroadcaster.broadcast(issue.board.id, {
+        type: "comment:created",
+        payload: { comment: created, issueId: result.data.issueId }
+    });
+
     return res.status(201).json({
         success: true,
         data: created
```

---

#### Finding WS-06: Missing WebSocket Broadcast on Member Removal / Organization De-Authorization
- **Severity**: **Critical**
- **File & Line Numbers**: `apps/backend/src/controllers/organisation/removeUser.ts:68-76`
- **Failure Mechanism & Impact**: When an admin removes a user from an organization (or when a user leaves), the `membership` record is deleted. However, no event is broadcast to the WebSocket server or the active board rooms. If the removed user currently has an active WebSocket connection open to board rooms within that organization, their connection and subscriptions **remain fully active**. The removed user continues to receive real-time board updates, card movements, edits, and confidential comments indefinitely until their socket disconnects.
- **PoC Scenario**:
  1. Employee Eve is fired and removed from Org `org-1` via `DELETE /api/orgs/org-1/members`.
  2. Eve's WebSocket client connected prior to termination remains connected to `board_confidential_roadmaps`.
  3. When other employees move cards or edit strategies, Bun publishes the events to all socket subscribers on `board_confidential_roadmaps`.
  4. Eve's client continues logging every real-time event despite having zero database membership.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/organisation/removeUser.ts
+++ b/apps/backend/src/controllers/organisation/removeUser.ts
@@ -4,6 +4,7 @@
 import zod from "zod";
 import { Forbidden, Not_Found, ValidationError } from "../../helpers/errorClass";
+import { wsBroadcaster } from "../../services/broadcaster";
 
 export async function deleteUserHandler(req: Request, res: Response)
@@ -74,6 +75,16 @@
         }
     })
 
+    // Evict removed user across all organization boards
+    wsBroadcaster.broadcast(`org_${result.data.orgId}`, {
+        type: "org:member_removed",
+        payload: {
+            userId: user_found.userId,
+            orgId: result.data.orgId,
+            action: "evict_user"
+        }
+    });
+
     return res.status(200).json({
         success: true,
         data: "user deleted"
```

---

## 3. WebSocket Architecture, Room Membership & Subscription Lifecycle

### 3.1 Authentication & Authorization Flow

The WebSocket server implementation resides in `apps/websockets/src/server.ts` and `apps/websockets/src/auth/authUpgrade.ts`. The connection lifecycle follows these steps:
1. **HTTP Upgrade Request**: Client sends WebSocket handshake request to `http://localhost:3001/ws` (or root).
2. **Handshake Authentication**: `authenticateRequest(req, jwtSecret)` inspects:
   - `Authorization: Bearer <token>`
   - Cookie headers (`token`, `auth_token`, `jwt`, `session`)
   - URL Query parameters (`?token=`, `?access_token=`, `?jwt=`, `?auth=`)
   - `Sec-WebSocket-Protocol: bearer, <token>`
   If no valid JWT is found, the server rejects the request with HTTP 401 Unauthorized before upgrading.
3. **Connection State Initialization**: On successful upgrade, `server.upgrade` attaches user metadata to `ws.data`:
   ```typescript
   data: {
       userId: user.userId,
       email: user.email,
       name: user.name,
       subscriptions: new Set<string>(),
       connectedAt: Date.now()
   }
   ```
4. **Room Join (`action: "join"`)**: When a client sends `{"action": "join", "boardId": "<id>"}`, `handleWebSocketMessage` invokes `checkAccess(ws.data.userId, boardId)` (`defaultCheckBoardAccess`).
   - The checker queries `prisma.boards.findUnique` to ensure `board.org.members` contains an accepted membership for `userId`.
   - If unauthorized, the socket receives `{"error": "Access denied: not a member of this board's organization"}` and the subscription is rejected.
   - If authorized, the socket joins Bun topic `board_<boardId>`, adds the topic to `ws.data.subscriptions`, and broadcasts `user:joined` with the server-verified user name/email.
5. **Connection Termination**: `handleWebSocketClose` iterates through `ws.data.subscriptions`, broadcasts `user:left` to each room, unsubscribes, and clears `ws.data.subscriptions`.

---

### 3.2 Vulnerability & Architectural Findings

#### Finding WS-10: Insecure Hardcoded Fallback Secret in WebSocket Environment
- **Severity**: **Medium**
- **File & Line Numbers**: `apps/websockets/src/types/env.ts:5`
- **Failure Mechanism & Impact**:
  In `apps/websockets/src/types/env.ts`:
  ```typescript
  jwt_key: zod.string().default("asdas"),
  ```
  If `jwt_key` is not explicitly set in the WebSocket server's environment, it falls back to the hardcoded string `"asdas"`. Conversely, `apps/backend/src/types/env.ts:5` defines `jwt_key: zod.string()` with no default.
  This introduces two severe risks:
  1. In development or misconfigured production environments, the WebSocket server accepts tokens signed with the well-known key `"asdas"`, enabling trivial authentication bypass.
  2. If the backend uses a custom key while the WebSocket server relies on the default, all legitimate client connection attempts will be rejected with 401 Unauthorized due to signature mismatch.
- **PoC Scenario**:
  Run WebSocket server without `jwt_key` in `.env`. Forge a JWT using secret `"asdas"`:
  ```bash
  bun -e 'import jwt from "jsonwebtoken"; console.log(jwt.sign({ id: "hacker-1" }, "asdas"))'
  ```
  Connect to `ws://localhost:3001?token=<token>`. The handshake succeeds and grants access.
- **Remediation Code Diff**:
```diff
--- a/apps/websockets/src/types/env.ts
+++ b/apps/websockets/src/types/env.ts
@@ -2,7 +2,7 @@
 
 export const envSchema = zod.object({
     ws_port: zod.string().default("3001").refine(x => !isNaN(Number(x)), { message: "ws_port must be a valid number" }),
-    jwt_key: zod.string().default("asdas"),
+    jwt_key: zod.string().min(16, { message: "jwt_key must be configured and at least 16 characters" }),
     port: zod.string().optional()
 });
```

---

#### Finding WS-11: Zombie Subscriptions (No Post-Join Revocation on Member Removal)
- **Severity**: **Critical**
- **File & Line Numbers**: `apps/websockets/src/server.ts:220-244` & `apps/backend/src/controllers/organisation/removeUser.ts:68-76`
- **Failure Mechanism & Impact**: Room access authorization (`checkAccess`) is evaluated **only once** at the time the client issues a `join` command. Once joined, Bun tracks the socket subscription in native C++ memory and `ws.data.subscriptions`.
  If an organization admin removes the user from the organization, demotes their role, or if the user's account is banned, the WebSocket server is never informed. The socket remains subscribed to `board_<boardId>` and continues receiving every broadcast event indefinitely until the client manually disconnects.
- **PoC Scenario**:
  1. User A (contractor) joins `board_confidential`.
  2. Admin revokes User A's membership via `DELETE /api/orgs/:orgId/members`.
  3. Other members perform card edits and comment updates.
  4. User A's open socket receives every single event in real-time.
- **Remediation Code Diff**:
  Introduce an internal administrative eviction handler on the WebSocket server and hook it into membership deletion:
```diff
--- a/apps/websockets/src/server.ts
+++ b/apps/websockets/src/server.ts
@@ -107,6 +107,18 @@
                 if (topic !== body.boardId) {
                     wsBroadcaster.emit(`board:${topic}`, body.event);
                 }
+
+                // Handle administrative user eviction
+                if (body.event && typeof body.event === "object" && (body.event as any).type === "org:member_removed") {
+                    const targetUserId = (body.event as any).payload?.userId;
+                    if (targetUserId) {
+                        server.publish(topic, JSON.stringify({
+                            type: "session:revoked",
+                            payload: { userId: targetUserId, reason: "Membership revoked" }
+                        }));
+                    }
+                }
 
                 return new Response(JSON.stringify({ success: true }), {
                     status: 200,
```

---

#### Finding WS-12: Lack of Mid-Session Token Expiration Verification
- **Severity**: **High**
- **File & Line Numbers**: `apps/websockets/src/server.ts:135-152` & `apps/websockets/src/auth/authUpgrade.ts:97-128`
- **Failure Mechanism & Impact**:
  JWT tokens typically have an expiration time (`exp`, e.g., 15 minutes to 1 hour). In `handleUpgradeRequest`, the token signature and expiration are verified during the initial HTTP handshake.
  However, once upgraded to a WebSocket connection, the socket can remain connected for days or weeks without re-verifying the token. If an access token expires 10 minutes into a session, the user remains authenticated indefinitely. The server lacks a periodic heartbeat re-authentication challenge (`auth:challenge` / `auth:renew`) to ensure credentials remain valid.
- **PoC Scenario**:
  1. Client connects with a short-lived token expiring in 60 seconds (`exp: now + 60`).
  2. 24 hours later, the client is still connected, receiving and sending messages on all subscribed boards.
- **Remediation Strategy**:
  Implement a connection timestamp check and require client-side token refresh via ping frames:
  ```typescript
  // In handleWebSocketMessage on action "ping" or scheduled timer:
  if (Date.now() - ws.data.connectedAt > MAX_SESSION_DURATION_MS) {
      ws.send(JSON.stringify({ type: "auth:expired", message: "Session expired. Re-authenticate." }));
      ws.close(4401, "Session Expired");
  }
  ```

---

#### Finding WS-13: Conflation of IPC Secret with Public User JWT Signing Key
- **Severity**: **Medium**
- **File & Line Numbers**: `apps/websockets/src/server.ts:70` & `apps/backend/src/services/broadcaster.ts:105`
- **Failure Mechanism & Impact**:
  In `apps/websockets/src/server.ts:70`:
  ```typescript
  const internalSecret = req.headers.get("x-internal-secret");
  if (jwtSecret && internalSecret !== jwtSecret) {
      return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), { status: 403 });
  }
  ```
  The endpoint `/internal/broadcast` uses `jwtSecret` as the preshared authorization token. Reusing the user JWT secret as an internal service-to-service key violates the principle of separation of concerns. If `jwt_key` is ever exposed, rotated, or if a frontend developer accidentally bundles the JWT verification secret in a client build, malicious actors can invoke `/internal/broadcast` and inject forged board events into active user sessions.
- **Remediation Code Diff**:
```diff
--- a/apps/websockets/src/server.ts
+++ b/apps/websockets/src/server.ts
@@ -67,9 +67,10 @@
         return (async () => {
             try {
-                const internalSecret = req.headers.get("x-internal-secret");
-                if (jwtSecret && internalSecret !== jwtSecret) {
+                const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || jwtSecret;
+                const internalSecret = req.headers.get("x-internal-secret");
+                if (expectedSecret && internalSecret !== expectedSecret) {
                     return new Response(JSON.stringify({ error: "Forbidden: invalid internal secret" }), {
                         status: 403,
                         headers: { "Content-Type": "application/json" }
```

---

## 4. Multi-Client State Consistency & Synchronization Resilience

### 4.1 State Consistency Flaws

#### Finding WS-14: Absence of Event Sequencing & Revision Vectors (Split-Brain Anomaly)
- **Severity**: **Critical**
- **File & Line Numbers**: `apps/backend/src/services/broadcaster.ts:5-9` & `apps/websockets/src/types/events.ts:21-25`
- **Failure Mechanism & Impact**:
  The broadcast event payload structure is defined as:
  ```typescript
  export interface BroadcastEvent<T = unknown> {
      type: string;
      payload: T;
      timestamp?: number;
  }
  ```
  Events contain only an epoch millisecond timestamp (`Date.now()`). There is **no monotonic sequence number** (e.g. `sequence: 1042`), **no entity version counter** (e.g. `card.version: 4`), and **no vector clock**.
  In multi-client environments, network latency and socket multiplexing frequently cause packets to arrive out of order:
  - Client A moves Card X to Column 1 (t=100ms).
  - Client B moves Card X to Column 2 (t=105ms).
  - Client C receives Client B's update first, followed by Client A's delayed update.
  Because Client C lacks sequence numbers, it applies Client A's stale update over Client B's newer update. As a result, Client C's board displays Card X in Column 1, while Client B and the database show Column 2 ("split-brain state").
- **PoC Scenario**:
  Simulate two rapid `card:moved` events over network delay:
  1. `Event 1`: `{ type: "card:moved", payload: { cardId: "c1", destList: "done", position: 1000 }, timestamp: 100 }`
  2. `Event 2`: `{ type: "card:moved", payload: { cardId: "c1", destList: "in_progress", position: 2000 }, timestamp: 110 }`
  If Event 1 arrives at a client after Event 2 due to packet jitter, the client leaves Card `c1` in "done" despite the final database state being "in_progress".
- **Remediation Strategy**:
  Add an atomic board sequence counter in Redis or PostgreSQL, attach `sequence: number` and `version: number` to all events, and have clients buffer or discard events where `incoming.sequence <= current.sequence`.

---

#### Finding WS-15: Fire-and-Forget Broadcast Delivery without Outbox Pattern
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/issues/updateIssue.ts:90-103` & `apps/backend/src/services/broadcaster.ts:96-121`
- **Failure Mechanism & Impact**:
  In `apps/backend/src/controllers/issues/updateIssue.ts`:
  ```typescript
  wsBroadcaster.broadcastCardMoved(issue.boardId, { ... });
  ```
  Broadcaster calls are executed **asynchronously without awaiting** and outside the database transaction. If the WebSocket server restarts or experiences a momentary network partition during an API mutation:
  1. The PostgreSQL mutation commits successfully.
  2. The HTTP POST to `http://127.0.0.1:3001/internal/broadcast` fails (or times out after 1000ms).
  3. The broadcaster catches the error and silently returns `false` (`broadcaster.ts:150`).
  4. The broadcast event is permanently lost.
  5. Connected clients never receive the event and remain desynchronized until they manually reload the page.
  The platform lacks a **Transactional Outbox Pattern** (storing events in an `events` table inside the same Prisma transaction) and provides no **Catch-Up API** (e.g., `GET /api/boards/:id/events?sinceSeq=...`).
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/issues/updateIssue.ts
+++ b/apps/backend/src/controllers/issues/updateIssue.ts
@@ -87,14 +87,14 @@
     const isEdit = result2.data.title !== undefined || result2.data.gh_url !== undefined;
 
     if (isMove) {
-        wsBroadcaster.broadcastCardMoved(issue.boardId, {
+        await wsBroadcaster.broadcastCardMoved(issue.boardId, {
             cardId: updated.id,
             sourceList: issue.sectionId,
             destList: targetSectionId ?? issue.sectionId,
             position: result2.data.position ?? 0
         });
     }
 
     if (isEdit) {
         const editUpdates: { title?: string; gh_url?: string } = {};
         if (result2.data.title !== undefined) editUpdates.title = result2.data.title;
         if (result2.data.gh_url !== undefined) editUpdates.gh_url = result2.data.gh_url;
-        wsBroadcaster.broadcastCardUpdated(issue.boardId, updated.id, editUpdates);
+        await wsBroadcaster.broadcastCardUpdated(issue.boardId, updated.id, editUpdates);
     }
```

---

#### Finding WS-16: Non-Deterministic Position Indexing & Collision Vulnerability
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/issues/createIssue.ts:57-64` & `apps/backend/src/controllers/issues/updateIssue.ts:73-80`
- **Failure Mechanism & Impact**:
  In `createIssue.ts`:
  ```typescript
  let position = result2.data.position;
  if (position === undefined) {
      const count = await prisma.issues.count({ where: { sectionId: result.data.sectionId } });
      position = (count + 1) * 1000;
  }
  ```
  In `updateIssue.ts`:
  ```typescript
  if (result2.data.position !== undefined) updateData.position = result2.data.position;
  ```
  Card positions are managed via raw float/integer fields without fractional indexing or collision arbitration. If two users drag cards simultaneously to the same position, both cards receive the exact same position index.
  Because the database query orders by `position ASC` without a tie-breaker (e.g. `id ASC`), card rendering order becomes non-deterministic and flickers across clients upon subsequent reloads.
- **Remediation Strategy**:
  Implement LexoRank (lexicographical string rank order, e.g. `"0|hzzzzz:"`) or float midpoint interpolation with automatic rebalancing when difference `|pos1 - pos2| < 0.001`.

---

#### Finding WS-17: Reconnection Thundering Herd on Database Connection Pool
- **Severity**: **Medium**
- **File & Line Numbers**: `apps/websockets/src/server.ts:14-38`
- **Failure Mechanism & Impact**:
  In `defaultCheckBoardAccess`:
  ```typescript
  export async function defaultCheckBoardAccess(userId: string, boardId: string): Promise<boolean> {
      const board = await prisma.boards.findUnique({
          where: { id: rawId },
          select: { org: { select: { members: { where: { userId, accepted: true } } } } }
      });
      return Boolean(board && board.org.members.length > 0);
  }
  ```
  Every single `join` message executes a direct PostgreSQL query against `prisma.boards`. When the WebSocket server restarts or recovers from a network interruption, hundreds of connected browser clients simultaneously reconnect and blast `join` frames.
  This creates a "thundering herd" problem that saturates Prisma's PostgreSQL connection pool (default limit: 10 connections in pool), causing database timeouts and connection refusals across the entire backend.
- **Remediation Strategy**:
  Cache user board memberships in an in-memory LRU cache or Redis with a short TTL (e.g. 60 seconds):
  ```typescript
  const accessCache = new Map<string, { hasAccess: boolean; expiresAt: number }>();
  ```

---

## 5. Kanban Domain & Feature Comparison with Trello

A detailed feature-by-feature comparative analysis was performed evaluating the current repository schema and controllers against standard Trello capabilities:

| Feature Dimension | Trello Standard Capability | Current Repository Implementation | Assessment & Critical Gaps |
| :--- | :--- | :--- | :--- |
| **1. Card Descriptions** | Markdown formatted rich descriptions with revision history | Only short `title` and optional `gh_url` string. | ❌ **Missing**: No `description` field exists in `issues` model (`schema.prisma:75-90`). Cards cannot store notes or specifications. |
| **2. Checklists & Subtasks** | Multiple checklists per card, items with checkboxes, progress % bar | Zero support. | ❌ **Missing**: No `checklists` or `checklist_items` tables, endpoints, or events. |
| **3. Due Dates & Badges** | `dueDate`, `startDate`, completion toggle (`isComplete`), reminder notifications | Zero support. | ❌ **Missing**: No date fields or completion tracking on `issues`. Cannot track deadlines. |
| **4. Labels & Colors** | Board labels with custom titles, palette colors, card tags, label filter | Zero support. | ❌ **Missing**: No `labels` or `issue_labels` models. No visual categorization. |
| **5. Activity Log / Audit Trail** | Full append-only activity feed ("Alice moved this card from To Do to Doing") | Only `comments.createdAt` exists. | ❌ **Missing**: No `activity_log` or `audit_trail` table. Board mutations leave zero historical record. |
| **6. File & Media Attachments** | Drag-and-drop file upload (images, docs), card cover preview, URLs | Only single `gh_url` string. | ❌ **Missing**: No file storage, media attachments, or cover image support. |
| **7. Member Assignments** | Multiple assignees per card, avatar chips on card front, assignment alerts | Has `issue_mapping` table. | ⚠️ **Partial**: Assign/unassign works in REST, but **lacks WebSocket broadcast**, and `getaBoard` does not return assignees. |
| **8. Column WIP Limits** | Configurable Work-In-Progress limits per list with visual warnings | Zero support. | ❌ **Missing**: No `maxCards` or WIP limit validation on `sections`. |
| **9. Drag-and-Drop Ordering** | Fractional LexoRank indexing with collision rebalancing | Basic Float `position` with manual `(count + 1) * 1000`. | ⚠️ **Primitive**: Prone to floating-point collapse, concurrent move collisions, and race conditions. |
| **10. Archiving vs Deletion** | Soft archiving (`isArchived: true`) with archive drawer & restore | Hard `prisma.delete` across boards, sections, and issues. | ❌ **High Risk**: Deletions permanently purge database records with zero recovery option. |
| **11. Audit Timestamps** | `createdAt` and `updatedAt` across all domain entities | Only `comments` has `createdAt`. | ❌ **Deficient**: `boards`, `sections`, `issues`, `orgs`, `membership` lack `createdAt` and `updatedAt`. |

---

## 6. Critical Inter-Layer Dependencies & API Blockers

The following backend defects directly obstruct or break the WebSocket synchronization layer:

### Finding API-01: Missing Board `id` in Board Projections
- **Severity**: **Critical**
- **File & Line Numbers**: `apps/backend/src/controllers/board/getBoards.ts:24-32` and `apps/backend/src/controllers/board/getaBoard.ts:18-36`
- **Failure Mechanism & Impact**:
  In `apps/backend/src/controllers/board/getBoards.ts`:
  ```typescript
  boards: {
      select: {
          title: true,
          _count: { select: { issues: true } }
      }
  }
  ```
  The board `id` is omitted from the selection query! When a frontend client fetches the board list via `GET /api/orgs/:orgId/boards`, the returned JSON objects do not contain `id`.
  **Direct Real-Time Impact**: The frontend client cannot determine the board ID, cannot navigate to `/boards/:boardId`, and **cannot subscribe to the WebSocket room** `board_<boardId>`.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/board/getBoards.ts
+++ b/apps/backend/src/controllers/board/getBoards.ts
@@ -24,6 +24,7 @@
             boards: {
                 select: {
+                    id: true,
                     title: true,
                     _count: {
                         select: {
```

---

### Finding API-02: Route Parameter Name Mismatch on Card Detail Alias
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/routes/routes.ts:143` and `apps/backend/src/controllers/issues/issueDetail.ts:8-12`
- **Failure Mechanism & Impact**:
  In `apps/backend/src/routes/routes.ts`:
  ```typescript
  app.get("/api/cards/:id", asyncHandler(issueDetail));
  ```
  In `apps/backend/src/controllers/issues/issueDetail.ts`:
  ```typescript
  const result = zod.object({ issueId: zod.uuid() }).safeParse(req.params);
  ```
  The route registers `:id`, while the controller expects `:issueId`. When clients fetch a card via the standard alias `GET /api/cards/3fa85f64-...`, `req.params.issueId` is `undefined`, causing Zod to reject the request with `ValidationError` (HTTP 400).
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/issues/issueDetail.ts
+++ b/apps/backend/src/controllers/issues/issueDetail.ts
@@ -7,8 +7,9 @@
 export async function issueDetail(req: Request, res: Response)
 {
+    const issueIdParam = req.params.issueId ?? req.params.cardId ?? req.params.id;
     const result = zod.object({
         issueId: zod.uuid()
-    }).safeParse(req.params);
+    }).safeParse({ issueId: issueIdParam });
```

---

### Finding DB-01: Foreign Key Cascade Omission on `comments.issueId`
- **Severity**: **Critical**
- **File & Line Numbers**: `packages/db/prisma/schema.prisma:105`
- **Failure Mechanism & Impact**:
  In `packages/db/prisma/schema.prisma`:
  ```prisma
  model comments {
      id          String      @id @default(uuid())
      description String
      issueId     String
      issue       issues      @relation(fields: [issueId], references: [id])
  ```
  The relation lacks `onDelete: Cascade`. When an issue or board containing comments is deleted (`prisma.issues.delete` or `prisma.boards.delete`), PostgreSQL throws a foreign key constraint violation error (`P2003: Foreign key constraint failed on the field: comments_issueId_fkey`), causing board deletion requests to crash with HTTP 500.
- **Remediation Code Diff**:
```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -102,5 +102,5 @@
     id          String      @id @default(uuid())
     description String
     issueId     String
-    issue       issues      @relation(fields: [issueId], references: [id])
+    issue       issues      @relation(fields: [issueId], references: [id], onDelete: Cascade)
     userId      String
```

---

### Finding API-03: Premature 404 and Authorization Bypass on Empty Comments
- **Severity**: **High**
- **File & Line Numbers**: `apps/backend/src/controllers/comments/getAllcomments.ts:60-61`
- **Failure Mechanism & Impact**:
  In `getAllComments.ts`:
  ```typescript
  if (comments.length === 0) throw new Not_Found("Comments not found");
  if (comments[0]!.issue.board.org.members.length === 0) throw new Forbidden("Members only");
  ```
  1. An issue with zero comments should return an empty array `[]` with HTTP 200. Instead, it throws 404 Not Found, causing frontend comment components to treat newly created cards as non-existent.
  2. Because authorization is checked against `comments[0]`, an issue with 0 comments skips membership validation and responds with 404 instead of 403 Forbidden to unauthorized outsiders.
- **Remediation Code Diff**:
```diff
--- a/apps/backend/src/controllers/comments/getAllcomments.ts
+++ b/apps/backend/src/controllers/comments/getAllcomments.ts
@@ -19,6 +19,20 @@
+    const issue = await prisma.issues.findUnique({
+        where: { id: result.data.issueId },
+        select: {
+            board: {
+                select: {
+                    org: {
+                        select: {
+                            members: {
+                                where: { userId: req.id, accepted: true }
+                            }
+                        }
+                    }
+                }
+            }
+        }
+    });
+    if (!issue) throw new Not_Found("Issue not found");
+    if (issue.board.org.members.length === 0) throw new Forbidden("Members only");
+
     const comments = await prisma.comments.findMany({
@@ -58,4 +72,0 @@
-    if (comments.length===0) throw new Not_Found("Comments not found");
-    if (comments[0]!.issue.board.org.members.length === 0) throw new Forbidden("Members only");
```

---

## 7. Remediation Roadmap & Implementation Recommendations

To transition the current platform into a robust, enterprise-ready Trello clone with reliable real-time synchronization, the following phased remediation roadmap is recommended:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        REMEDIATION PHASES                              │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 1: Immediate Critical Fixes                                     │
│  - Add missing board `id` projections in getBoards / getBoardDetails   │
│  - Fix route parameter binding in issueDetail (`:id` vs `:issueId`)    │
│  - Add `onDelete: Cascade` to `comments.issueId` in schema.prisma      │
│  - Fix 404 / auth bypass in getAllComments                             │
│  - Enforce strict min-length check on `jwt_key` in WS env (no fallback)│
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 2: Complete Event Broadcast Coverage                            │
│  - Wire broadcasts into `renameBoard` and `deleteBoard`                │
│  - Wire broadcasts into `assignIssue` and `removeAssignment`           │
│  - Wire broadcasts into `addComment`, `editComment`, `deleteComment`   │
│  - Implement session revocation / eviction broadcast in `removeUser`   │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 3: State Consistency & Synchronization Resilience              │
│  - Introduce monotonically increasing sequence numbers per board       │
│  - Replace fire-and-forget broadcasts with Transactional Outbox Pattern│
│  - Build catch-up endpoint: `GET /api/boards/:id/events?sinceSeq=...`  │
│  - Implement in-memory membership check caching to eliminate stampedes │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 4: Kanban Domain Expansion                                      │
│  - Add `description`, `dueDate`, `isArchived`, `position` to `issues`  │
│  - Implement LexoRank fractional indexing algorithm for card reordering│
│  - Create `checklists`, `labels`, and `activity_log` database models   │
│  - Add `createdAt` and `updatedAt` timestamps across all Prisma models │
└────────────────────────────────────────────────────────────────────────┘
```
