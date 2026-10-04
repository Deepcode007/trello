import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function add_comment_test()
{
    let adminToken: string, contributorToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string, issueId: string;
    let parentCommentId: string;

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
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: "Nice issue" })
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid issueId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/not-a-uuid/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ description: "Nice issue" })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 400 when description is missing", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({})
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when issue does not exist", async () =>
    {
        const fakeId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${fakeId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ description: "Nice issue" })
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when user is non-member", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` },
            body: JSON.stringify({ description: "Nice issue" })
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 404 when parent comment does not exist", async () =>
    {
        const fakeParentId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ description: "Reply to ghost", parentId: fakeParentId })
        });
        expect(res.status).toBe(404);
    });

    it("Adds root comment successfully by contributor", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${contributorToken}` },
            body: JSON.stringify({ description: "First root comment" })
        });
        expect(res.status).toBe(201);
        const body = await res.json() as {
            success: boolean;
            data: { id: string; description: string; issueId: string; parentId: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.description).toBe("First root comment");
        expect(body.data.issueId).toBe(issueId);
        expect(body.data.parentId).toBeNull();
        parentCommentId = body.data.id;
    });

    it("Adds reply comment successfully by admin", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ description: "Reply to first comment", parentId: parentCommentId })
        });
        expect(res.status).toBe(201);
        const body = await res.json() as {
            success: boolean;
            data: { id: string; description: string; issueId: string; parentId: string | null };
        };
        expect(body.success).toBe(true);
        expect(body.data.description).toBe("Reply to first comment");
        expect(body.data.parentId).toBe(parentCommentId);
    });
}
