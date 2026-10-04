import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { update_user_role } from "../helpers/update_role";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function delete_issue_test()
{
    let adminToken: string, employeeToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

        const employeeUser = await create_user();
        employeeToken = await login_user(employeeUser.email, employeeUser.password);
        await invite_user(orgId, employeeUser.email, adminToken);
        await accept_invite(employeeToken, orgId);
        await update_user_role(orgId, employeeUser.email, adminToken, "employee");

        const contributorUser = await create_user();
        contributorToken = await login_user(contributorUser.email, contributorUser.password);
        await invite_user(orgId, contributorUser.email, adminToken);
        await accept_invite(contributorToken, orgId);

        const nonMemberUser = await create_user();
        nonMemberToken = await login_user(nonMemberUser.email, nonMemberUser.password);

        const board = await create_boards(adminToken, orgId);
        boardId = board!.id;

        const section = await create_sections(adminToken, boardId);
        sectionId = section!.id;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const iss = await create_issue(adminToken, sectionId, boardId);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid issueId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/not-a-uuid`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when issue does not exist", async () =>
    {
        const fakeId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeId}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when non-member tries to delete issue", async () =>
    {
        const iss = await create_issue(adminToken, sectionId, boardId);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 403 when contributor tries to delete issue", async () =>
    {
        const iss = await create_issue(adminToken, sectionId, boardId);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Employee deletes issue successfully", async () =>
    {
        const iss = await create_issue(adminToken, sectionId, boardId);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${employeeToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: string };
        expect(body.success).toBe(true);

        // Verify issue no longer exists
        const checkRes = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
        });
        expect(checkRes.status).toBe(404);
    });

    it("Admin deletes issue successfully", async () =>
    {
        const iss = await create_issue(adminToken, sectionId, boardId);
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${iss!.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: string };
        expect(body.success).toBe(true);
    });
}
