import { beforeAll, describe, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

describe("Checklists Tests", () => {
    let adminToken: string;
    let employeeToken: string;
    let contributorToken: string;
    let nonMemberToken: string;

    let orgId: string;
    let boardId: string;
    let sectionId: string;
    let issueId: string;

    let activeChecklistId: string;
    let firstItemId: string;
    let secondItemId: string;

    beforeAll(async () => {
        // Create users and tokens using helpers
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const employeeUser = await create_user();
        employeeToken = await login_user(employeeUser.email, employeeUser.password);

        const contributorUser = await create_user();
        contributorToken = await login_user(contributorUser.email, contributorUser.password);

        const nonMemberUser = await create_user();
        nonMemberToken = await login_user(nonMemberUser.email, nonMemberUser.password);

        // Create organization using helper
        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

        // Invite and promote employee
        await invite_user(orgId, employeeUser.email, adminToken);
        await accept_invite(employeeToken, orgId);
        await update_user_role(orgId, employeeUser.email, adminToken, "employee");

        // Invite contributor
        await invite_user(orgId, contributorUser.email, adminToken);
        await accept_invite(contributorToken, orgId);

        // Create primary board, section, and issue using helpers
        const board = await create_boards(adminToken, orgId);
        boardId = board!.id;

        const section = await create_sections(adminToken, boardId);
        sectionId = section!.id;

        const issue = await create_issue(adminToken, sectionId, boardId);
        issueId = issue!.id;
    });

    describe("Checklists Creation & Auto Position Spacing (POST /api/issues/:issueId/checklists)", () => {
        let firstChecklistId: string;
        let secondChecklistId: string;

        it("creates first checklist with status 201, initial position 1000, and empty items array", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "Acceptance Criteria" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.title).toBe("Acceptance Criteria");
            expect(body.data.position).toBe(1000);
            expect(body.data.issueId).toBe(issueId);
            expect(Array.isArray(body.data.items)).toBe(true);
            expect(body.data.items.length).toBe(0);
            firstChecklistId = body.data.id;
        });

        it("assigns position 2000 (max + 1000) to second checklist on the same issue", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${employeeToken}`
                },
                body: JSON.stringify({ title: "Deployment Steps" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.title).toBe("Deployment Steps");
            expect(body.data.position).toBe(2000);
            secondChecklistId = body.data.id;
        });

        it("forbids contributor from creating a checklist with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${contributorToken}`
                },
                body: JSON.stringify({ title: "Contributor Checklist" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("forbids non-member from creating a checklist with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${nonMemberToken}`
                },
                body: JSON.stringify({ title: "Non-member Checklist" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("rejects empty or whitespace title with 400 Bad Request", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "    " })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("returns 404 Not Found when issueId does not exist", async () => {
            const fakeIssueId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeIssueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "Ghost Checklist" })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Card not found");
        });

        it("returns 400 Bad Request when issueId is not a valid UUID", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/not-a-uuid/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "Bad UUID" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Bad Reuqest/Invalid Inputs");
        });
    });

    describe("Checklist Items (POST /api/checklists/:checklistId/items & PATCH /api/checklists/items/:itemId)", () => {
        beforeAll(async () => {
            // Create a clean checklist for item testing via API
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "Subtasks Master" })
            });
            const body = await res.json() as any;
            activeChecklistId = body.data.id;
        });

        it("adds a checklist item without due date (status 201, position 1000, isCompleted false)", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${activeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: "Write comprehensive integration tests" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.content).toBe("Write comprehensive integration tests");
            expect(body.data.isCompleted).toBe(false);
            expect(body.data.position).toBe(1000);
            expect(body.data.dueDate).toBeNull();
            firstItemId = body.data.id;
        });

        it("adds a second item with optional dueDate and auto position spacing (position 2000)", async () => {
            const isoDueDate = "2026-12-31T23:59:59.000Z";
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${activeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${employeeToken}`
                },
                body: JSON.stringify({
                    content: "Execute test suite against backend API",
                    dueDate: isoDueDate
                })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.position).toBe(2000);
            expect(new Date(body.data.dueDate).toISOString()).toBe(isoDueDate);
            secondItemId = body.data.id;
        });

        it("forbids contributor from adding checklist items with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${activeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${contributorToken}`
                },
                body: JSON.stringify({ content: "Unauthorized task" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("rejects empty item content with 400 Bad Request", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${activeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: "   " })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("rejects invalid date format in dueDate with 400 Bad Request", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${activeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: "Bad date", dueDate: "not-a-date" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
        });

        it("returns 404 Not Found when adding item to non-existent checklist", async () => {
            const fakeChecklistId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${fakeChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: "Ghost item" })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Checklist not found");
        });

        it("updates checklist item content and toggles isCompleted with status 200", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/items/${firstItemId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({
                    content: "Write tests (COMPLETED)",
                    isCompleted: true
                })
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.content).toBe("Write tests (COMPLETED)");
            expect(body.data.isCompleted).toBe(true);
        });

        it("updates checklist item by nulling out dueDate", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/items/${secondItemId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${employeeToken}`
                },
                body: JSON.stringify({ dueDate: null })
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.dueDate).toBeNull();
        });

        it("forbids contributor from updating checklist items with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/items/${firstItemId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${contributorToken}`
                },
                body: JSON.stringify({ isCompleted: false })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("returns 404 Not Found when updating non-existent checklist item", async () => {
            const fakeItemId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/items/${fakeItemId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ isCompleted: true })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Checklist item not found");
        });
    });

    describe("Checklist Deletion & Cascade Integrity (DELETE /api/checklists/:checklistId)", () => {
        let doomedChecklistId: string;
        let doomedItemId: string;

        beforeAll(async () => {
            // Create a dedicated checklist with an item via API
            const clRes = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: "Checklist for Cascade Deletion Test" })
            });
            const clBody = await clRes.json() as any;
            doomedChecklistId = clBody.data.id;

            const itRes = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${doomedChecklistId}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: "Cascade Item 1" })
            });
            const itBody = await itRes.json() as any;
            doomedItemId = itBody.data.id;
        });

        it("forbids contributor from deleting checklist with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${doomedChecklistId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${contributorToken}` }
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("forbids non-member from deleting checklist with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${doomedChecklistId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${nonMemberToken}` }
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("allows admin to delete checklist and returns status 200", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${doomedChecklistId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data).toBe("Checklist deleted");
        });

        it("returns 404 Not Found when attempting to delete an already deleted checklist", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${doomedChecklistId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Checklist not found");
        });

        it("returns 404 Not Found when updating item on deleted checklist", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/items/${doomedItemId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ isCompleted: true })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Checklist item not found");
        });
    });

    describe("Adversarial Edge Cases & Boundary Conditions", () => {
        it("handles special characters and Unicode in checklist title and item content", async () => {
            const specialTitle = "🛠️ DoD: 100% Coverage & No Regressions <script>";
            const resChecklist = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/checklists`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ title: specialTitle })
            });

            expect(resChecklist.status).toBe(201);
            const clBody = await resChecklist.json() as any;
            expect(clBody.data.title).toBe(specialTitle);

            const specialContent = "Verify SQL 'advisory_lock' & \"monotonic\" sequences 💯";
            const resItem = await fetch(`${globalThis.TEST_BASE_URL}/api/checklists/${clBody.data.id}/items`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ content: specialContent })
            });

            expect(resItem.status).toBe(201);
            const itemBody = await resItem.json() as any;
            expect(itemBody.data.content).toBe(specialContent);
        });
    });
});
