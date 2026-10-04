import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function get_issues_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string, emptySectionId: string;
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

        const emptySection = await create_sections(adminToken, boardId);
        emptySectionId = emptySection!.id;

        const createdIssue = await create_issue(adminToken, sectionId, boardId, "https://github.com/repo/issues/1");
        issueTitle = createdIssue!.title;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid sectionId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/not-a-uuid/issues`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when section has no issues or does not exist", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${emptySectionId}/issues`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 404/403 when user is non-member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect([403, 404]).toContain(res.status);
    });

    it("Member (contributor) gets issues list successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
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
                section: { title: string };
                board: string;
            }[];
        };
        expect(body.success).toBe(true);
        expect(body.data.length).toBe(1);
        expect(body.data[0]!.title).toBe(issueTitle);
        expect(body.data[0]!.gh_url).toBe("https://github.com/repo/issues/1");
        expect(body.data[0]!.board).toBeDefined();
        expect(body.data[0]!.section.title).toBeDefined();
    });

    it("Admin gets issues list successfully", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/sections/${sectionId}/issues`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: any[];
        };
        expect(body.success).toBe(true);
        expect(body.data.length).toBe(1);
    });
}
