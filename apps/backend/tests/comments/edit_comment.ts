import { beforeAll, expect, it } from "bun:test";
import { create_user } from "../helpers/create_User";
import { login_user } from "../helpers/login_user";
import { create_org } from "../helpers/create_org";
import { invite_user } from "../helpers/invite_user";
import { accept_invite } from "../helpers/accept_invite";
import { create_boards } from "../helpers/create_board";
import { create_sections } from "../helpers/create_sections";
import { create_issue } from "../helpers/create_issue";

export function edit_comment_test()
{
    let adminToken: string, authorToken: string, otherMemberToken: string, nonMemberToken: string;
    let orgId: string, boardId: string, sectionId: string, issueId: string;
    let commentId: string;

    beforeAll(async () =>
    {
        const adminUser = await create_user();
        adminToken = await login_user(adminUser.email, adminUser.password);

        const org = await create_org(adminToken, `Org-${crypto.randomUUID()}`);
        orgId = org.id;

        const authorUser = await create_user();
        authorToken = await login_user(authorUser.email, authorUser.password);
        await invite_user(orgId, authorUser.email, adminToken);
        await accept_invite(authorToken, orgId);

        const otherMemberUser = await create_user();
        otherMemberToken = await login_user(otherMemberUser.email, otherMemberUser.password);
        await invite_user(orgId, otherMemberUser.email, adminToken);
        await accept_invite(otherMemberToken, orgId);

        const nonMemberUser = await create_user();
        nonMemberToken = await login_user(nonMemberUser.email, nonMemberUser.password);

        const board = await create_boards(adminToken, orgId);
        boardId = board!.id;

        const section = await create_sections(adminToken, boardId);
        sectionId = section!.id;

        const iss = await create_issue(adminToken, sectionId, boardId);
        issueId = iss!.id;

        // Author creates a comment
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/issues/${issueId}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${authorToken}` },
            body: JSON.stringify({ description: "Initial Comment Content" })
        });
        const body = await res.json() as any;
        commentId = body.data.id;
    });

    it("Fails with 401 when unauthenticated", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${commentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: "Updated content" })
        });
        expect(res.status).toBe(401);
    });

    it("Fails with 400 when invalid commentId UUID", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/not-a-uuid`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${authorToken}` },
            body: JSON.stringify({ description: "Updated content" })
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 400 when description is missing", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${commentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${authorToken}` },
            body: JSON.stringify({})
        });
        expect(res.status).toBe(400);
    });

    it("Fails with 404 when comment does not exist", async () =>
    {
        const fakeId = crypto.randomUUID();
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${fakeId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${authorToken}` },
            body: JSON.stringify({ description: "Updated content" })
        });
        expect(res.status).toBe(404);
    });

    it("Fails with 403 when non-member tries to edit comment", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${commentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${nonMemberToken}` },
            body: JSON.stringify({ description: "Updated content" })
        });
        expect(res.status).toBe(403);
    });

    it("Fails with 403 when a non-author member tries to edit comment", async () =>
    {
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${commentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${otherMemberToken}` },
            body: JSON.stringify({ description: "Updated content" })
        });
        expect(res.status).toBe(403);
    });

    it("Author edits comment successfully", async () =>
    {
        const newDesc = `Edited Content - ${crypto.randomUUID()}`;
        const res = await fetch(`${globalThis.TEST_BASE_URL}/api/comments/${commentId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${authorToken}` },
            body: JSON.stringify({ description: newDesc })
        });
        expect(res.status).toBe(201);
        const body = await res.json() as {
            success: boolean;
            data: { id: string; description: string };
        };
        expect(body.success).toBe(true);
        expect(body.data.description).toBe(newDesc);
        expect(body.data.id).toBe(commentId);
    });
}
