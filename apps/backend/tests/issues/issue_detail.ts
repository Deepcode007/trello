import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function issue_detail_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string, issueId: string;
    let issueTitle: string;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

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

        const createdIssue = await create_issue(adminToken, sectionId, boardId, "https://github.com/repo/issues/100");
        issueId = createdIssue!.id;
        issueTitle = createdIssue!.title;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid issueId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/invalid-uuid`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when issue does not exist", async () =>
    {
        const fakeIssueId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeIssueId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when user is non-member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Member (contributor) gets full issue details successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: {
                id: string;
                title: string;
                gh_url: string | null;
                board: { id: string; title: string };
                section: { id: string; title: string };
                issueMappings: any[];
            };
        };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe(issueId);
        expect(body.data.title).toBe(issueTitle);
        expect(body.data.gh_url).toBe("https://github.com/repo/issues/100");
        expect(body.data.board.id).toBe(boardId);
        expect(body.data.section.id).toBe(sectionId);
        expect(Array.isArray(body.data.issueMappings)).toBe(true);
    });
}
