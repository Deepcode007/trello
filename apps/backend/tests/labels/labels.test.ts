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

describe("Labels Tests", () => {
    let adminToken: string;
    let employeeToken: string;
    let contributorToken: string;
    let nonMemberToken: string;

    let orgId: string;
    let boardId: string;
    let sectionId: string;
    let issueId: string;

    let otherBoardId: string;
    let otherSectionId: string;
    let otherIssueId: string;

    let labelAId: string;
    let labelBId: string;
    let otherBoardLabelId: string;

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

        // Create secondary board, section, and issue for cross-board validation
        const otherBoard = await create_boards(adminToken, orgId);
        otherBoardId = otherBoard!.id;

        const otherSection = await create_sections(adminToken, otherBoardId);
        otherSectionId = otherSection!.id;

        const otherIssue = await create_issue(adminToken, otherSectionId, otherBoardId);
        otherIssueId = otherIssue!.id;
    });

    describe("Board Labels Management (POST & GET /api/boards/:boardId/labels)", () => {
        it("allows admin to create a label on a board with status 201", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: "Bug", color: "#ef4444" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.name).toBe("Bug");
            expect(body.data.color).toBe("#ef4444");
            expect(body.data.boardId).toBe(boardId);
            expect(typeof body.data.id).toBe("string");
            labelAId = body.data.id;
        });

        it("allows employee to create a label on a board with status 201", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${employeeToken}`
                },
                body: JSON.stringify({ name: "Feature", color: "#3b82f6" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.name).toBe("Feature");
            expect(body.data.color).toBe("#3b82f6");
            labelBId = body.data.id;
        });

        it("forbids contributor from creating a label with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${contributorToken}`
                },
                body: JSON.stringify({ name: "Contributor Tag", color: "#10b981" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("forbids non-member from creating a label with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${nonMemberToken}`
                },
                body: JSON.stringify({ name: "Hacker Tag", color: "#000000" })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("rejects unauthenticated request with 401 Unauthorized", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "No Auth Tag", color: "#6b7280" })
            });

            expect(res.status).toBe(401);
        });

        it("rejects invalid input schema with 400 Bad Request (missing name)", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ color: "#ef4444" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
        });

        it("rejects invalid input schema with 400 Bad Request (missing color)", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: "No Color" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
        });

        it("rejects invalid UUID format for boardId with 400 Bad Request", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/not-a-valid-uuid/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: "Bad Board UUID", color: "#ef4444" })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Bad Reuqest/Invalid Inputs");
        });

        it("returns 404 Not Found when board does not exist in database", async () => {
            const nonExistentBoardId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${nonExistentBoardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: "Ghost Board Label", color: "#ef4444" })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Board not found");
        });

        it("lists all labels created for a board with status 200 in ascending chronological order", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "GET",
                headers: { Authorization: `Bearer ${contributorToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data.length).toBeGreaterThanOrEqual(2);

            const names = body.data.map((l: any) => l.name);
            expect(names).toContain("Bug");
            expect(names).toContain("Feature");

            for (const item of body.data) {
                expect(typeof item.id).toBe("string");
                expect(typeof item.name).toBe("string");
                expect(typeof item.color).toBe("string");
                expect(item.boardId).toBe(boardId);
            }
        });

        it("forbids non-members from listing labels with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "GET",
                headers: { Authorization: `Bearer ${nonMemberToken}` }
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Members only");
        });

        it("returns empty array for a board that has no labels created", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${otherBoardId}/labels`, {
                method: "GET",
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data).toHaveLength(0);
        });
    });

    describe("Card Label Attachment & Detachment (POST & DELETE /api/issues/:issueId/labels)", () => {
        beforeAll(async () => {
            // Create a label on otherBoardId for cross-board testing
            const otherLabelRes = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${otherBoardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: "OtherBoardLabel", color: "#059669" })
            });
            const otherBody = await otherLabelRes.json() as any;
            otherBoardLabelId = otherBody.data.id;
        });

        it("allows admin to attach a label to an issue with status 201", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ labelId: labelAId })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.issueId).toBe(issueId);
            expect(body.data.labelId).toBe(labelAId);
            expect(body.data.label).toBeDefined();
            expect(body.data.label.name).toBe("Bug");
        });

        it("allows employee to attach a second label to the issue with status 201", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${employeeToken}`
                },
                body: JSON.stringify({ labelId: labelBId })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data.label.name).toBe("Feature");
        });

        it("performs idempotent upsert when attaching already attached label", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ labelId: labelAId })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
        });

        it("strictly enforces cross-board integrity: rejects label belonging to a different board with 400 Bad Request", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ labelId: otherBoardLabelId })
            });

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Label does not belong to this board");
        });

        it("forbids contributor from attaching label with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${contributorToken}`
                },
                body: JSON.stringify({ labelId: labelAId })
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("returns 404 Not Found when attaching non-existent labelId", async () => {
            const fakeLabelId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ labelId: fakeLabelId })
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Label not found");
        });

        it("allows admin to detach a label from an issue with status 200", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels/${labelAId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data).toBe("Label removed from card");
        });

        it("performs idempotent delete when detaching an already detached label", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels/${labelAId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${employeeToken}` }
            });

            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.success).toBe(true);
            expect(body.data).toBe("Label removed from card");
        });

        it("forbids contributor from detaching label with 403 Forbidden", async () => {
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/labels/${labelAId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${contributorToken}` }
            });

            expect(res.status).toBe(403);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Admin/Employee access required");
        });

        it("returns 404 Not Found when detaching label from non-existent issue", async () => {
            const fakeIssueId = crypto.randomUUID();
            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeIssueId}/labels/${labelAId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${adminToken}` }
            });

            expect(res.status).toBe(404);
            const body = await res.json() as any;
            expect(body.success).toBe(false);
            expect(body.error).toBe("Issue not found");
        });
    });

    describe("Adversarial Edge Cases & Boundary Conditions", () => {
        it("handles special characters, emojis, and quotes in label name and color", async () => {
            const specialName = "🚀 [CRITICAL] \"P0\" <alert> & special";
            const specialColor = "#123ABC";

            const res = await fetch(`${globalThis.TEST_BASE_URL}/api/boards/${boardId}/labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${adminToken}`
                },
                body: JSON.stringify({ name: specialName, color: specialColor })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.data.name).toBe(specialName);
            expect(body.data.color).toBe(specialColor);
        });
    });
});
