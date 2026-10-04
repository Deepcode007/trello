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

export function update_issue_test()
{
    let adminToken: string, employeeToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, section1Id: string, section2Id: string, issueId: string;

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

        const s1 = await create_sections(adminToken, boardId);
        section1Id = s1!.id;

        const s2 = await create_sections(adminToken, boardId);
        section2Id = s2!.id;

        const iss = await create_issue(adminToken, section1Id, boardId);
        issueId = iss!.id;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Updated Title" })
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid issueId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/not-a-uuid`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Updated Title" })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when issue does not exist", async () =>
    {
        const fakeId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ title: "Updated Title" })
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when user is non-member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` },
            body: JSON.stringify({ title: "Updated Title" })
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 403 when user is contributor", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` },
            body: JSON.stringify({ title: "Updated Title" })
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 404 when target section does not exist", async () =>
    {
        const fakeSectionId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${employeeToken}` },
            body: JSON.stringify({ sectionId: fakeSectionId })
        });
        expect(res.status).toBe(404);
    });

    it("Employee updates issue title and gh_url successfully", async () =>
    {
        const newTitle = `Issue-Updated-${crypto.randomUUID()}`;
        const newUrl = "https://github.com/org/repo/pull/42";
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${employeeToken}` },
            body: JSON.stringify({ title: newTitle, gh_url: newUrl })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: { id: string; title: string; gh_url: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.title).toBe(newTitle);
        expect(body.data.gh_url).toBe(newUrl);
    });

    it("Admin moves issue to a new section successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ sectionId: section2Id })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: { id: string; sectionId: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.sectionId).toBe(section2Id);
    });
}
