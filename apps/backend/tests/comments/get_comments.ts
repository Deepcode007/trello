import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function get_comments_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string, issueId: string, emptyIssueId: string;
    let rootCommentId: string;

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

        const iss = await create_issue(adminToken, sectionId, boardId);
        issueId = iss!.id;

        const emptyIss = await create_issue(adminToken, sectionId, boardId);
        emptyIssueId = emptyIss!.id;

        // Add root comment and a nested reply
        const resRoot = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ description: "Root Comment" })
        });
        const rootBody = await resRoot.json() as any;
        rootCommentId = rootBody.data.id;

        await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` },
            body: JSON.stringify({ description: "Nested Reply", parentId: rootCommentId })
        });
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid issueId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/not-a-uuid/comments`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(400);
    });

    it("Returns 200 with empty array when issue has no comments", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${emptyIssueId}/comments`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: any[] };
        expect(body.success).toBe(true);
        expect(body.data).toEqual([]);
    });

    it("Fails with 403 when non-member requests comments", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` }
        });
        expect(res.status).toBe(403);
    });

    it("Returns nested comment tree successfully to member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "GET",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as {
            success: boolean;
            data: {
                id: string;
                description: string;
                parentId: string | null;
                children: any[];
                user: { username: string };
            }[];
        };
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBe(1); // One root
        expect(body.data[0]!.id).toBe(rootCommentId);
        expect(body.data[0]!.description).toBe("Root Comment");
        expect(body.data[0]!.children.length).toBe(1); // One nested child
        expect(body.data[0]!.children[0]!.description).toBe("Nested Reply");
    });
}
